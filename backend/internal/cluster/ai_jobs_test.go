package cluster

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func jobRequest(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("X-ClusterLens-AI", "1")
	req.Header.Set("Content-Type", "application/json")
	out := httptest.NewRecorder()
	h.ServeHTTP(out, req)
	return out
}
func TestAIJobSurvivesRequestCancellationAndDeduplicates(t *testing.T) {
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		entered <- struct{}{}
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		answer := `{"summary":"Observed health","findings":[{"text":"Current snapshot","evidenceIds":["E1"]}],"nextChecks":[]}`
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"done": true, "message": map[string]string{"content": answer}})
	}))
	defer provider.Close()
	a := &AI{Provider: "ollama", Model: "local", Endpoint: provider.URL, client: provider.Client(), slots: make(chan struct{}, 1)}
	defer a.Close()
	s := evidenceStore()
	h := s.Handler("", a)
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest("POST", "/api/v1/ai/jobs", strings.NewReader(`{"uid":"deploy-1","range":900,"consent":true}`)).WithContext(ctx)
	req.Header.Set("X-ClusterLens-AI", "1")
	req.Header.Set("Content-Type", "application/json")
	out := httptest.NewRecorder()
	h.ServeHTTP(out, req)
	if out.Code != 202 {
		t.Fatal(out.Code, out.Body.String())
	}
	var j AIJob
	_ = json.Unmarshal(out.Body.Bytes(), &j)
	cancel()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("provider did not start")
	}
	duplicate := jobRequest(h, "POST", "/api/v1/ai/jobs", `{"uid":"deploy-1","range":900,"consent":true}`)
	var again AIJob
	_ = json.Unmarshal(duplicate.Body.Bytes(), &again)
	if duplicate.Code != 202 || again.ID != j.ID {
		t.Fatal("not deduplicated", duplicate.Body.String())
	}
	latest := jobRequest(h, "GET", "/api/v1/ai/jobs?uid=deploy-1&range=900", "")
	if !strings.Contains(latest.Body.String(), j.ID) {
		t.Fatal("job not recoverable")
	}
	close(release)
	until(t, func() bool {
		r := jobRequest(h, "GET", "/api/v1/ai/jobs/"+j.ID, "")
		_ = json.Unmarshal(r.Body.Bytes(), &again)
		return again.State == "completed"
	})
	if calls.Load() != 1 || again.Result == nil || again.Result.Evidence.UID != "deploy-1" {
		t.Fatal("missing or duplicate result")
	}
}
func TestAIJobCancellationAndConsent(t *testing.T) {
	entered := make(chan struct{}, 1)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entered <- struct{}{}
		select {
		case <-r.Context().Done():
		case <-time.After(3 * time.Second):
		}
	}))
	defer provider.Close()
	a := &AI{Provider: "ollama", Model: "local", Endpoint: provider.URL, client: provider.Client(), slots: make(chan struct{}, 1)}
	defer a.Close()
	h := evidenceStore().Handler("", a)
	bad := jobRequest(h, "POST", "/api/v1/ai/jobs", `{"uid":"deploy-1","range":900,"consent":false}`)
	if bad.Code != 400 {
		t.Fatal(bad.Code)
	}
	out := jobRequest(h, "POST", "/api/v1/ai/jobs", `{"uid":"deploy-1","range":900,"consent":true}`)
	var j AIJob
	_ = json.Unmarshal(out.Body.Bytes(), &j)
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("provider did not start")
	}
	stopped := jobRequest(h, "DELETE", "/api/v1/ai/jobs/"+j.ID, "")
	if stopped.Code != 200 || !strings.Contains(stopped.Body.String(), `"state":"canceled"`) {
		t.Fatal(stopped.Body.String())
	}
	until(t, func() bool { return len(a.slots) == 0 })
	if out = jobRequest(h, "GET", "/api/v1/ai/jobs/unknown", ""); out.Code != 404 {
		t.Fatal(out.Code)
	}
}
func TestAIJobRetentionBounds(t *testing.T) {
	a := &AI{jobs: map[string]*AIJob{}}
	for i := 0; i < 25; i++ {
		id := time.Now().Add(time.Duration(i) * time.Second).String()
		a.jobs[id] = &AIJob{ID: id, State: "completed", Started: time.Now().Add(-time.Duration(i) * time.Minute)}
	}
	a.jobs["expired"] = &AIJob{ID: "expired", State: "completed", Started: time.Now().Add(-25 * time.Hour)}
	a.pruneJobsLocked()
	if len(a.jobs) > 19 || a.jobs["expired"] != nil {
		t.Fatal("unbounded job retention", len(a.jobs))
	}
}
