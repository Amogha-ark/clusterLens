package cluster

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAIConfiguration(t *testing.T) {
	t.Setenv("CLUSTERLENS_AI_PROVIDER", "")
	if a, err := AIFromEnv(); err != nil || a != nil {
		t.Fatal(a, err)
	}
	t.Setenv("CLUSTERLENS_AI_PROVIDER", "ollama")
	t.Setenv("CLUSTERLENS_AI_MODEL", "")
	if _, err := AIFromEnv(); err == nil {
		t.Fatal("accepted missing model")
	}
	t.Setenv("CLUSTERLENS_AI_MODEL", "local-model")
	t.Setenv("CLUSTERLENS_OLLAMA_URL", "http://localhost:11434")
	a, err := AIFromEnv()
	if err != nil || a.Endpoint != "http://localhost:11434" {
		t.Fatal(a, err)
	}
	for _, url := range []string{"file:///tmp/model", "http://user:pass@localhost", "http://localhost?key=secret", "http://localhost/api/chat"} {
		t.Setenv("CLUSTERLENS_OLLAMA_URL", url)
		if _, err := AIFromEnv(); err == nil {
			t.Fatal("accepted", url)
		}
	}
	t.Setenv("CLUSTERLENS_AI_PROVIDER", "openai")
	t.Setenv("OPENAI_API_KEY", "")
	if _, err := AIFromEnv(); err == nil {
		t.Fatal("accepted missing key")
	}
}
func evidenceStore() *Store {
	s := testStore()
	for _, o := range fixture() {
		for _, w := range s.watches {
			if w.kind == o.GetKind() {
				_ = w.informer.GetStore().Add(o)
			}
		}
	}
	return s
}
func TestAIEvidenceAllowlistWindowAndBounds(t *testing.T) {
	s := evidenceStore()
	now := time.Now()
	s.points = []Point{{UID: "deploy-1", Timestamp: now.Add(-2 * time.Hour)}, {UID: "deploy-1", Timestamp: now}}
	// No labels, pod images or raw source errors should leave the evidence builder.
	s.watches[0].err = "Bearer supersecret"
	pack, err := s.evidence("deploy-1", 900)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(pack)
	for _, forbidden := range []string{"supersecret", "app:v1", "containerd://one", "\"labels\"", "\"annotations\""} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatal("leaked", forbidden)
		}
	}
	if len(pack.Items) < 3 {
		t.Fatal("missing related evidence")
	}
	for _, e := range pack.Items {
		if points, ok := e.Data.([]Point); ok && len(points) != 1 {
			t.Fatal("ignored window", points)
		}
	}
	if _, err = s.evidence("replaced", 900); err == nil {
		t.Fatal("accepted stale UID")
	}
	secret := "password=hunter2 token=abc Bearer private sk-123456 https://name:pass@service/path eyJabc.eyJdef.sig"
	redacted := redact(secret)
	for _, v := range []string{"hunter2", "abc", "private", "sk-123456", "name:pass", "eyJdef"} {
		if strings.Contains(redacted, v) {
			t.Fatal("not redacted", v, redacted)
		}
	}
}
func TestAIProvidersAndCitations(t *testing.T) {
	for _, provider := range []string{"ollama", "openai"} {
		t.Run(provider, func(t *testing.T) {
			for _, invalid := range []bool{false, true} {
				answer := Explanation{Summary: "Observed restarts", Findings: []Finding{{Text: "Cumulative restarts are nonzero", EvidenceIDs: []string{"E1"}}}, NextChecks: []Finding{}}
				if invalid {
					answer.Findings[0].EvidenceIDs = []string{"invented"}
				}
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var body map[string]interface{}
					_ = json.NewDecoder(r.Body).Decode(&body)
					if body["model"] != "test-model" {
						t.Error("missing model")
					}
					raw, _ := json.Marshal(answer)
					if provider == "openai" {
						if r.URL.Path != "/v1/responses" || body["store"] != false || r.Header.Get("Authorization") != "Bearer private" {
							t.Error("OpenAI contract")
						}
						_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "completed", "output": []interface{}{map[string]interface{}{"type": "message", "content": []interface{}{map[string]string{"type": "output_text", "text": string(raw)}}}}})
					} else {
						if r.URL.Path != "/api/chat" || body["stream"] != false || r.Header.Get("Authorization") != "" {
							t.Error("Ollama contract")
						}
						_ = json.NewEncoder(w).Encode(map[string]interface{}{"done": true, "message": map[string]string{"content": string(raw)}})
					}
				}))
				a := &AI{Provider: provider, Model: "test-model", Endpoint: server.URL, key: "private", client: server.Client()}
				_, err := a.explain(context.Background(), EvidencePack{Items: []Evidence{{ID: "E1"}}})
				if (err != nil) != invalid {
					t.Fatal("citation validation", err)
				}
				server.Close()
			}
		})
	}
}
func TestAIProviderFailuresAreSanitized(t *testing.T) {
	for _, mode := range []string{"error", "oversized", "incomplete", "malformed"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch mode {
				case "error":
					w.WriteHeader(401)
					_, _ = w.Write([]byte("secret-key-from-provider"))
				case "oversized":
					_, _ = w.Write([]byte(strings.Repeat("x", 65537)))
				case "incomplete":
					_, _ = w.Write([]byte(`{"done":false}`))
				default:
					_, _ = w.Write([]byte(`{"done":true,"message":{"content":"not json"}}`))
				}
			}))
			defer server.Close()
			a := &AI{Provider: "ollama", Endpoint: server.URL, client: server.Client()}
			_, err := a.explain(context.Background(), EvidencePack{})
			if err == nil || strings.Contains(err.Error(), "secret-key") {
				t.Fatal(err)
			}
		})
	}
}
func TestAIRoutesConsentDisabledAndOrigin(t *testing.T) {
	s := evidenceStore()
	a := &AI{Provider: "ollama", Model: "test", slots: make(chan struct{}, 1)}
	for _, tc := range []struct {
		body, origin, header string
		disabled             bool
		want                 int
	}{
		{`{"uid":"deploy-1","range":900,"consent":false}`, "", "1", false, 400},
		{`{"uid":"deploy-1","range":900,"consent":true}`, "", "", false, 400},
		{`{"uid":"deploy-1","range":900,"consent":true}`, "https://evil.invalid", "1", false, 403},
		{`{"uid":"deploy-1","range":900,"consent":true}`, "", "1", true, 503},
		{`{"uid":"missing","range":900,"consent":true}`, "", "1", false, 404},
		{`{"uid":"deploy-1","range":999999,"consent":true}`, "", "1", false, 400},
		{strings.Repeat("x", 2050), "", "1", false, 400},
	} {
		h := s.Handler("", a)
		if tc.disabled {
			h = s.Handler("")
		}
		req := httptest.NewRequest("POST", "http://localhost/api/v1/ai/explain", strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-ClusterLens-AI", tc.header)
		req.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Fatal(w.Code, tc.want, w.Body.String())
		}
	}
	// A request already running must not issue a second provider call.
	a.slots <- struct{}{}
	a.next = time.Time{}
	req := httptest.NewRequest("POST", "/api/v1/ai/explain", strings.NewReader(`{"uid":"deploy-1","range":900,"consent":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ClusterLens-AI", "1")
	w := httptest.NewRecorder()
	s.Handler("", a).ServeHTTP(w, req)
	if w.Code != 429 {
		t.Fatal(w.Code)
	}
}

func TestAIEvidenceKeepsSelectedIdentityWhenSorting(t *testing.T) {
	s := evidenceStore()
	snap := s.Snapshot()
	for _, selected := range snap.Resources {
		pack, err := s.evidence(selected.UID, 900)
		if err != nil {
			t.Fatal(err)
		}
		if pack.Items[0].ResourceUID != selected.UID {
			t.Fatal("selected identity changed")
		}
		for _, e := range pack.Items[1 : len(pack.Items)-2] {
			r := find(snap.Resources, e.ResourceUID)
			if !containsID(selected.Related, r.UID) && !containsID(r.Related, selected.UID) {
				t.Fatalf("%s received unrelated %s", selected.Name, e.Title)
			}
		}
	}
}
func TestAIEvidenceSizeAndSampleBounds(t *testing.T) {
	s := evidenceStore()
	now := time.Now()
	for i := 0; i < 1000; i++ {
		s.points = append(s.points, Point{UID: "deploy-1", Timestamp: now.Add(-time.Duration(i) * time.Millisecond), CPU: 0.2, Memory: 1000000})
	}
	pack, err := s.evidence("deploy-1", 900)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(pack)
	if len(raw) > 10000 {
		t.Fatal("exceeded model context budget")
	}
	for _, e := range pack.Items {
		if p, ok := e.Data.([]Point); ok && len(p) > 30 {
			t.Fatal("unbounded history")
		}
	}
}
