package cluster

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func problem(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]interface{}{"error": message})
}
func (s *Store) Handler(static string, providers ...*AI) http.Handler {
	mux := http.NewServeMux()
	var ai *AI
	if len(providers) > 0 {
		ai = providers[0]
	}
	s.aiRoutes(mux, ai)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]bool{"alive": true}) })
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := s.Ready(); err != nil {
			problem(w, 503, err.Error())
			return
		}
		writeJSON(w, 200, map[string]bool{"ready": true})
	})
	mux.HandleFunc("GET /api/v1/snapshot", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.Snapshot()) })
	mux.HandleFunc("GET /api/v1/history", func(w http.ResponseWriter, r *http.Request) {
		uid := r.URL.Query().Get("uid")
		if uid == "" {
			uid = "cluster"
		}
		since := time.Now().Add(-15 * time.Minute)
		if v := r.URL.Query().Get("since"); v != "" {
			var err error
			since, err = time.Parse(time.RFC3339, v)
			if err != nil {
				problem(w, 400, "since must be RFC3339")
				return
			}
		}
		if since.Before(time.Now().Add(-24 * time.Hour)) {
			since = time.Now().Add(-24 * time.Hour)
		}
		writeJSON(w, 200, map[string]interface{}{"points": s.History(uid, since), "volatile": true, "maxPoints": s.maxPoints, "retentionHours": 24})
	})
	logSlots := make(chan struct{}, 4)
	mux.HandleFunc("GET /api/v1/logs", func(w http.ResponseWriter, r *http.Request) {
		select {
		case logSlots <- struct{}{}:
			defer func() { <-logSlots }()
			s.logs(w, r)
		default:
			problem(w, 429, "Four log queries are already running; try again shortly")
		}
	})
	mux.HandleFunc("GET /api/", func(w http.ResponseWriter, r *http.Request) { problem(w, 404, "API route not found") })
	files := http.FileServer(http.Dir(static))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Clean("/" + r.URL.Path)
		if strings.Contains(clean, "..") {
			http.NotFound(w, r)
			return
		}
		if info, err := os.Stat(filepath.Join(static, clean)); err == nil && !info.IsDir() {
			files.ServeHTTP(w, r)
			return
		}
		if strings.Contains(filepath.Base(clean), ".") {
			http.NotFound(w, r)
			return
		}
		if _, err := os.Stat(filepath.Join(static, "index.html")); err != nil {
			problem(w, 503, "Dashboard is not built. Run npm ci && npm run build in frontend.")
			return
		}
		http.ServeFile(w, r, filepath.Join(static, "index.html"))
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
		// Local unauthenticated application: refuse cross-origin browser reads.
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host && origin != "https://"+r.Host {
			problem(w, 403, "Cross-origin access is disabled")
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func (s *Store) logs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	namespace, pod, container, uid := q.Get("namespace"), q.Get("pod"), q.Get("container"), q.Get("uid")
	if namespace == "" || pod == "" || container == "" || uid == "" {
		problem(w, 400, "namespace, pod, container and uid are required")
		return
	}
	var found *Resource
	snap := s.Snapshot()
	for i := range snap.Resources {
		v := &snap.Resources[i]
		if v.Kind == "Pod" && v.Namespace == namespace && v.Name == pod && v.UID == uid {
			found = v
			break
		}
	}
	if found == nil {
		problem(w, 404, "Pod identity is no longer in inventory. Refresh before querying logs.")
		return
	}
	exists := false
	for _, c := range found.Containers {
		if c.Name == container {
			exists = true
		}
	}
	if !exists {
		problem(w, 400, "Container is not part of the selected pod")
		return
	}
	since := int64(900)
	if value := q.Get("sinceSeconds"); value != "" {
		n, err := strconv.ParseInt(value, 10, 64)
		if err != nil || n < 1 || n > 21600 {
			problem(w, 400, "sinceSeconds must be between 1 and 21600")
			return
		}
		since = n
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	// Check the live UID as well: the pod name may have been reused since the watch snapshot.
	actual, err := s.kube.CoreV1().Pods(namespace).Get(ctx, pod, metav1.GetOptions{})
	if err != nil {
		status := 502
		if apierrors.IsForbidden(err) {
			status = 403
		}
		if apierrors.IsNotFound(err) {
			status = 404
		}
		problem(w, status, err.Error())
		return
	}
	if string(actual.UID) != uid {
		problem(w, 409, "Pod was replaced; refresh inventory")
		return
	}
	tail, limit := int64(500), int64(262144)
	stream, err := s.kube.CoreV1().Pods(namespace).GetLogs(pod, &corev1.PodLogOptions{Container: container, Timestamps: true, TailLines: &tail, SinceSeconds: &since, LimitBytes: &limit, Previous: q.Get("previous") == "true"}).Stream(ctx)
	if err != nil {
		status := 502
		if apierrors.IsForbidden(err) {
			status = 403
		}
		problem(w, status, err.Error())
		return
	}
	defer stream.Close()
	data, err := io.ReadAll(io.LimitReader(stream, limit+1))
	if err != nil {
		problem(w, 502, "Log stream interrupted")
		return
	}
	truncated := int64(len(data)) >= limit
	if int64(len(data)) > limit {
		data = data[:limit]
	}
	writeJSON(w, 200, map[string]interface{}{"text": string(data), "timestamp": time.Now().UTC(), "source": "kubernetes-pod-log-api", "truncated": truncated, "maxLines": tail, "maxBytes": limit, "persisted": false})
}
