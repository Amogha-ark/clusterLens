package cluster

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

type AIResult struct {
	Explanation Explanation  `json:"explanation"`
	Evidence    EvidencePack `json:"evidence"`
	Provider    string       `json:"provider"`
	Model       string       `json:"model"`
}
type AIJob struct {
	ID       string       `json:"id"`
	Cluster  string       `json:"cluster"`
	UID      string       `json:"uid"`
	Range    int          `json:"range"`
	State    string       `json:"state"`
	Started  time.Time    `json:"started"`
	Evidence EvidencePack `json:"evidence"`
	Result   *AIResult    `json:"result,omitempty"`
	Error    string       `json:"error,omitempty"`
	cancel   context.CancelFunc
}

// Jobs intentionally outlive browser requests, but remain bounded and process-local.
func (a *AI) pruneJobsLocked() {
	for id, j := range a.jobs {
		if j.State != "running" && time.Since(j.Started) > 24*time.Hour {
			delete(a.jobs, id)
		}
	}
	for len(a.jobs) >= 20 {
		var oldest *AIJob
		for _, j := range a.jobs {
			if j.State != "running" && (oldest == nil || j.Started.Before(oldest.Started)) {
				oldest = j
			}
		}
		if oldest == nil {
			break
		}
		delete(a.jobs, oldest.ID)
	}
}
func (a *AI) Close() {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, j := range a.jobs {
		if j.cancel != nil {
			j.cancel()
		}
	}
}

func (s *Store) aiJobRoutes(mux *http.ServeMux, a *AI) {
	mux.HandleFunc("GET /api/v1/ai/jobs", func(w http.ResponseWriter, r *http.Request) {
		if a == nil {
			problem(w, 503, "AI is disabled")
			return
		}
		seconds, err := parseAIRange(r.URL.Query().Get("range"))
		if err != nil {
			problem(w, 400, err.Error())
			return
		}
		uid := r.URL.Query().Get("uid")
		a.mu.Lock()
		defer a.mu.Unlock()
		var latest *AIJob
		for _, j := range a.jobs {
			if j.Cluster == s.name && j.UID == uid && j.Range == seconds && time.Since(j.Started) < 24*time.Hour && (latest == nil || j.Started.After(latest.Started)) {
				latest = j
			}
		}
		if latest == nil {
			problem(w, 404, "No saved investigation for this resource and window")
			return
		}
		writeJSON(w, 200, latest)
	})
	mux.HandleFunc("GET /api/v1/ai/jobs/{id}", func(w http.ResponseWriter, r *http.Request) {
		if a == nil {
			problem(w, 503, "AI is disabled")
			return
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		j := a.jobs[r.PathValue("id")]
		if j == nil || j.Cluster != s.name || time.Since(j.Started) > 24*time.Hour {
			problem(w, 404, "Investigation expired or backend restarted")
			return
		}
		writeJSON(w, 200, j)
	})
	mux.HandleFunc("DELETE /api/v1/ai/jobs/{id}", func(w http.ResponseWriter, r *http.Request) {
		if a == nil {
			problem(w, 503, "AI is disabled")
			return
		}
		if r.Header.Get("X-ClusterLens-AI") != "1" {
			problem(w, 400, "An explicit cancellation request is required")
			return
		}
		a.mu.Lock()
		defer a.mu.Unlock()
		j := a.jobs[r.PathValue("id")]
		if j == nil || j.Cluster != s.name {
			problem(w, 404, "Investigation not found")
			return
		}
		if j.State == "running" {
			j.State = "canceled"
			j.cancel()
		}
		writeJSON(w, 200, j)
	})
	mux.HandleFunc("POST /api/v1/ai/jobs", func(w http.ResponseWriter, r *http.Request) {
		if a == nil {
			problem(w, 503, "AI is disabled. Configure Ollama or OpenAI on the backend.")
			return
		}
		if r.Header.Get("X-ClusterLens-AI") != "1" || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			problem(w, 400, "An explicit JSON explanation request is required")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 2048)
		var input struct {
			UID     string `json:"uid"`
			Range   int    `json:"range"`
			Consent bool   `json:"consent"`
		}
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if dec.Decode(&input) != nil || dec.Decode(&struct{}{}) != io.EOF || !input.Consent || input.UID == "" || len(input.UID) > 256 || input.Range < 60 || input.Range > 86400 {
			problem(w, 400, "uid, range (60–86400 seconds) and explicit consent are required")
			return
		}
		// Serialize acceptance so simultaneous tabs attach to one active job.
		a.mu.Lock()
		defer a.mu.Unlock()
		for _, j := range a.jobs {
			if j.State == "running" && j.Cluster == s.name && j.UID == input.UID && j.Range == input.Range {
				writeJSON(w, 202, j)
				return
			}
		}
		select {
		case a.slots <- struct{}{}:
		default:
			problem(w, 429, "An explanation is already running. Try again shortly.")
			return
		}
		release := true
		defer func() {
			if release {
				<-a.slots
			}
		}()
		if time.Now().Before(a.next) {
			problem(w, 429, "Wait five seconds between AI requests")
			return
		}
		pack, err := s.evidence(input.UID, input.Range)
		if err != nil {
			problem(w, 404, err.Error())
			return
		}
		id := make([]byte, 16)
		if _, err = rand.Read(id); err != nil {
			problem(w, 500, "Could not create investigation")
			return
		}
		a.pruneJobsLocked()
		if a.jobs == nil {
			a.jobs = map[string]*AIJob{}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		j := &AIJob{ID: hex.EncodeToString(id), Cluster: s.name, UID: input.UID, Range: input.Range, State: "running", Started: time.Now().UTC(), Evidence: pack, cancel: cancel}
		a.jobs[j.ID] = j
		a.next = time.Now().Add(5 * time.Second)
		release = false
		go func() {
			defer cancel()
			defer func() { <-a.slots }()
			result, err := a.explain(ctx, pack)
			a.mu.Lock()
			defer a.mu.Unlock()
			if j.State == "canceled" {
				return
			}
			if err != nil {
				j.State = "failed"
				j.Error = err.Error()
				return
			}
			j.State = "completed"
			j.Result = &AIResult{Explanation: result, Evidence: pack, Provider: a.Provider, Model: a.Model}
		}()
		writeJSON(w, 202, j)
	})
}
