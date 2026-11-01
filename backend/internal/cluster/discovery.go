package cluster

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

type watched struct {
	kind     string
	informer cache.SharedIndexInformer
	err      string
}
type Store struct {
	mu              sync.RWMutex
	name            string
	kube            kubernetes.Interface
	metrics         metricsclient.Interface
	watches         []*watched
	podUsage        map[string]map[string]Usage
	nodeUsage       map[string]Usage
	metricStatus    MetricsStatus
	connected       bool
	connectionError string
	points          []Point
	dropped         int64
	maxPoints       int
	retention       time.Duration
	maxResources    int
	deleted         map[string]Resource
}

var resources = []struct{ group, version, resource, kind string }{
	{"", "v1", "namespaces", "Namespace"}, {"", "v1", "nodes", "Node"}, {"", "v1", "pods", "Pod"},
	{"", "v1", "services", "Service"}, {"", "v1", "persistentvolumeclaims", "PersistentVolumeClaim"},
	{"", "v1", "persistentvolumes", "PersistentVolume"}, {"", "v1", "events", "Event"},
	{"apps", "v1", "deployments", "Deployment"}, {"apps", "v1", "statefulsets", "StatefulSet"},
	{"apps", "v1", "daemonsets", "DaemonSet"}, {"apps", "v1", "replicasets", "ReplicaSet"},
	{"batch", "v1", "jobs", "Job"}, {"batch", "v1", "cronjobs", "CronJob"},
	{"storage.k8s.io", "v1", "storageclasses", "StorageClass"},
}

func New(name string, dyn dynamic.Interface, kube kubernetes.Interface, metrics metricsclient.Interface) *Store {
	s := &Store{name: name, kube: kube, metrics: metrics, podUsage: map[string]map[string]Usage{}, nodeUsage: map[string]Usage{}, maxPoints: 60000, retention: 24 * time.Hour, maxResources: 5000, deleted: map[string]Resource{}}
	factory := dynamicinformer.NewDynamicSharedInformerFactory(dyn, 5*time.Minute)
	for _, r := range resources {
		w := &watched{kind: r.kind, informer: factory.ForResource(schema.GroupVersionResource{Group: r.group, Version: r.version, Resource: r.resource}).Informer()}
		_ = w.informer.SetWatchErrorHandler(func(_ *cache.Reflector, err error) { s.mu.Lock(); w.err = err.Error(); s.mu.Unlock() })
		clear := func(interface{}) { s.mu.Lock(); w.err = ""; s.mu.Unlock() }
		_, _ = w.informer.AddEventHandler(cache.ResourceEventHandlerFuncs{AddFunc: clear, UpdateFunc: func(_, obj interface{}) { clear(obj) }, DeleteFunc: func(obj interface{}) { clear(obj); s.archive(w.kind, obj) }})
		// Unneeded metadata (especially managedFields) can dwarf the useful inventory.
		_ = w.informer.SetTransform(func(obj interface{}) (interface{}, error) {
			if u, ok := obj.(*unstructured.Unstructured); ok {
				u.SetManagedFields(nil)
				u.SetAnnotations(nil)
			}
			return obj, nil
		})
		s.watches = append(s.watches, w)
	}
	return s
}
func (s *Store) Start(ctx context.Context) {
	for _, w := range s.watches {
		go w.informer.Run(ctx.Done())
	}
	go func() {
		s.Poll(ctx)
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.Poll(ctx)
			}
		}
	}()
}
func (s *Store) Poll(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	// Namespace GET is an inexpensive connection heartbeat; no writes or Secret reads.
	_, err := s.kube.CoreV1().Namespaces().Get(ctx, "kube-system", metav1.GetOptions{})
	s.mu.Lock()
	s.connected = err == nil
	s.connectionError = ""
	if err != nil {
		s.connectionError = err.Error()
	}
	s.mu.Unlock()
	pods, podErr := s.metrics.MetricsV1beta1().PodMetricses("").List(ctx, metav1.ListOptions{})
	nodes, nodeErr := s.metrics.MetricsV1beta1().NodeMetricses().List(ctx, metav1.ListOptions{})
	s.mu.Lock()
	if podErr != nil || nodeErr != nil {
		s.metricStatus.Available = false
		if podErr != nil {
			s.metricStatus.Error = podErr.Error()
		} else {
			s.metricStatus.Error = nodeErr.Error()
		}
		s.mu.Unlock()
		return
	}
	pmap := map[string]map[string]Usage{}
	for _, p := range pods.Items {
		cs := map[string]Usage{}
		for _, c := range p.Containers {
			cs[c.Name] = Usage{CPU: c.Usage.Cpu().AsApproximateFloat64(), Memory: c.Usage.Memory().AsApproximateFloat64(), Timestamp: p.Timestamp.Time}
		}
		pmap[p.Namespace+"/"+p.Name] = cs
	}
	nmap := map[string]Usage{}
	for _, n := range nodes.Items {
		nmap[n.Name] = Usage{CPU: n.Usage.Cpu().AsApproximateFloat64(), Memory: n.Usage.Memory().AsApproximateFloat64(), Timestamp: n.Timestamp.Time}
	}
	s.podUsage = pmap
	s.nodeUsage = nmap
	s.metricStatus = MetricsStatus{Available: true, LastSuccess: time.Now().UTC()}
	s.mu.Unlock()
	snap := s.Snapshot()
	points := []Point{}
	// Cluster usage is the sum of actual node usage, not double-counted pod usage.
	total := Point{UID: "cluster", Timestamp: time.Time{}}
	for _, r := range snap.Resources {
		if r.Usage != nil {
			p := Point{UID: r.UID, CPU: r.Usage.CPU, Memory: r.Usage.Memory, Timestamp: r.Usage.Timestamp}
			points = append(points, p)
			if r.Kind == "Node" {
				total.CPU += p.CPU
				total.Memory += p.Memory
				if p.Timestamp.After(total.Timestamp) {
					total.Timestamp = p.Timestamp
				}
			}
		}
	}
	if !total.Timestamp.IsZero() {
		points = append(points, total)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().Add(-s.retention)
	kept := s.points[:0]
	for _, p := range s.points {
		if p.Timestamp.After(cutoff) {
			kept = append(kept, p)
		}
	}
	latest := map[string]time.Time{}
	for _, p := range kept {
		if p.Timestamp.After(latest[p.UID]) {
			latest[p.UID] = p.Timestamp
		}
	}
	s.points = kept
	for _, p := range points {
		if p.Timestamp.After(latest[p.UID]) {
			s.points = append(s.points, p)
		}
	}
	if len(s.points) > s.maxPoints {
		excess := len(s.points) - s.maxPoints
		s.dropped += int64(excess)
		copy(s.points, s.points[excess:])
		s.points = s.points[:s.maxPoints]
	}
}
func (s *Store) History(uid string, since time.Time) []Point {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Point{}
	for _, p := range s.points {
		if p.UID == uid && !p.Timestamp.Before(since) {
			out = append(out, p)
		}
	}
	return out
}
func (s *Store) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	snap := Snapshot{Cluster: s.name, Timestamp: time.Now().UTC(), Connected: s.connected, ConnectionError: s.connectionError, Metrics: s.metricStatus, Resources: []Resource{}, DeletedResources: []Resource{}, Events: []Event{}, Sources: []Source{}, HistoryDropped: s.dropped}
	for _, r := range s.deleted {
		if r.DeletedAt != nil && r.DeletedAt.After(time.Now().Add(-s.retention)) {
			snap.DeletedResources = append(snap.DeletedResources, r)
		}
	}
	sort.Slice(snap.DeletedResources, func(i, j int) bool {
		return snap.DeletedResources[i].DeletedAt.After(*snap.DeletedResources[j].DeletedAt)
	})
	objects := []*unstructured.Unstructured{}
	for _, w := range s.watches {
		snap.Sources = append(snap.Sources, Source{Kind: w.kind, Synced: w.informer.HasSynced(), Error: w.err})
		for _, obj := range w.informer.GetStore().List() {
			u, ok := obj.(*unstructured.Unstructured)
			if !ok {
				continue
			}
			if w.kind == "Event" {
				snap.Events = append(snap.Events, normalizeEvent(u))
				continue
			}
			copy := u.DeepCopy()
			copy.SetKind(w.kind)
			objects = append(objects, copy)
		}
	}
	sort.Slice(objects, func(i, j int) bool { return string(objects[i].GetUID()) < string(objects[j].GetUID()) })
	if len(objects) > s.maxResources {
		objects = objects[:s.maxResources]
		snap.Truncated = true
	}
	snap.Resources = normalize(objects, s.podUsage, s.nodeUsage, s.metricStatus.Available)
	sort.Slice(snap.Events, func(i, j int) bool { return snap.Events[i].Timestamp.After(snap.Events[j].Timestamp) })
	if len(snap.Events) > 200 {
		snap.Events = snap.Events[:200]
	}
	return snap
}

// Keep bounded tombstones so an event or metric cannot silently attach to a reused name.
func (s *Store) archive(kind string, obj interface{}) {
	if kind == "Event" {
		return
	}
	if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		obj = tombstone.Obj
	}
	u, ok := obj.(*unstructured.Unstructured)
	if !ok {
		return
	}
	u = u.DeepCopy()
	u.SetKind(kind)
	objects := []*unstructured.Unstructured{u}
	for _, w := range s.watches {
		if w.kind == "Event" {
			continue
		}
		for _, raw := range w.informer.GetStore().List() {
			if item, ok := raw.(*unstructured.Unstructured); ok && item.GetUID() != u.GetUID() {
				copy := item.DeepCopy()
				copy.SetKind(w.kind)
				objects = append(objects, copy)
			}
		}
	}
	rows := normalize(objects, nil, nil, false)
	for _, r := range rows {
		if r.UID == string(u.GetUID()) {
			now := time.Now().UTC()
			r.DeletedAt = &now
			r.Status = "Deleted"
			s.mu.Lock()
			defer s.mu.Unlock()
			s.deleted[r.UID] = r
			for id, item := range s.deleted {
				if item.DeletedAt.Before(now.Add(-s.retention)) {
					delete(s.deleted, id)
				}
			}
			if len(s.deleted) > 500 {
				oldestID := ""
				oldest := now
				for id, item := range s.deleted {
					if !item.DeletedAt.After(oldest) {
						oldest, oldestID = *item.DeletedAt, id
					}
				}
				delete(s.deleted, oldestID)
			}
			return
		}
	}
}
func (s *Store) Ready() error {
	snap := s.Snapshot()
	if !snap.Connected {
		return fmt.Errorf("Kubernetes API unavailable")
	}
	for _, source := range snap.Sources {
		if !source.Synced || source.Error != "" {
			return fmt.Errorf("%s discovery unavailable", source.Kind)
		}
	}
	return nil
}
