package cluster

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubefake "k8s.io/client-go/kubernetes/fake"
	clienttesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"
	metricsv1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsfake "k8s.io/metrics/pkg/client/clientset/versioned/fake"
)

func object(kind, name, uid string, extra map[string]interface{}) *unstructured.Unstructured {
	version := "v1"
	if kind == "Deployment" || kind == "ReplicaSet" {
		version = "apps/v1"
	}
	out := map[string]interface{}{"apiVersion": version, "kind": kind, "metadata": map[string]interface{}{"name": name, "namespace": "lab", "uid": uid, "creationTimestamp": "2026-01-01T00:00:00Z"}}
	for k, v := range extra {
		out[k] = v
	}
	return &unstructured.Unstructured{Object: out}
}
func owner(uid string) []interface{} {
	return []interface{}{map[string]interface{}{"apiVersion": "apps/v1", "kind": "Deployment", "name": "owner", "uid": uid, "controller": true}}
}
func fixture() []*unstructured.Unstructured {
	deployment := object("Deployment", "app", "deploy-1", map[string]interface{}{"spec": map[string]interface{}{"replicas": int64(1)}, "status": map[string]interface{}{"readyReplicas": int64(1)}})
	rs := object("ReplicaSet", "rs", "rs-1", nil)
	rs.Object["metadata"].(map[string]interface{})["ownerReferences"] = owner("deploy-1")
	pod := object("Pod", "app-pod", "pod-1", map[string]interface{}{"spec": map[string]interface{}{"nodeName": "worker", "containers": []interface{}{map[string]interface{}{"name": "web", "image": "app:v1", "resources": map[string]interface{}{"requests": map[string]interface{}{"cpu": "10m", "memory": "16Mi"}}}}, "volumes": []interface{}{map[string]interface{}{"persistentVolumeClaim": map[string]interface{}{"claimName": "data"}}}}, "status": map[string]interface{}{"phase": "Running", "containerStatuses": []interface{}{map[string]interface{}{"name": "web", "ready": true, "containerID": "containerd://one", "restartCount": int64(2), "state": map[string]interface{}{"running": map[string]interface{}{"startedAt": "2026-01-01T00:00:01Z"}}}}}})
	pod.Object["metadata"].(map[string]interface{})["ownerReferences"] = owner("rs-1")
	pod.SetLabels(map[string]string{"app": "web"})
	node := object("Node", "worker", "node-1", map[string]interface{}{"status": map[string]interface{}{"capacity": map[string]interface{}{"cpu": "4", "memory": "8Gi"}, "conditions": []interface{}{map[string]interface{}{"type": "Ready", "status": "True"}}}})
	node.SetNamespace("")
	pvc := object("PersistentVolumeClaim", "data", "pvc-1", map[string]interface{}{"spec": map[string]interface{}{"volumeName": "pv", "storageClassName": "local-path"}, "status": map[string]interface{}{"phase": "Bound", "capacity": map[string]interface{}{"storage": "64Mi"}}})
	service := object("Service", "app", "svc-1", map[string]interface{}{"spec": map[string]interface{}{"type": "ClusterIP", "selector": map[string]interface{}{"app": "web"}}})
	return []*unstructured.Unstructured{deployment, rs, pod, node, pvc, service}
}
func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}
func find(rs []Resource, uid string) Resource {
	for _, r := range rs {
		if r.UID == uid {
			return r
		}
	}
	return Resource{}
}
func TestOwnershipUsageAndVolumeCorrelation(t *testing.T) {
	usage := map[string]map[string]Usage{"lab/app-pod": {"web": {CPU: .2, Memory: 20 * 1024 * 1024, Timestamp: time.Now()}}}
	rows := normalize(fixture(), usage, nil, true)
	pod := find(rows, "pod-1")
	workload := find(rows, "deploy-1")
	if pod.WorkloadUID != "deploy-1" || pod.Restarts != 2 || pod.Containers[0].ID != "containerd://one" {
		t.Fatalf("bad pod identity: %+v", pod)
	}
	for _, id := range []string{"pod-1", "pvc-1", "node-1", "svc-1"} {
		if !contains(workload.Related, id) {
			t.Errorf("missing relationship %s", id)
		}
	}
	if workload.Usage == nil || workload.Usage.CPU != .2 {
		t.Fatalf("usage not attributed: %+v", workload)
	}
	if pod.Containers[0].CPURequest != .01 {
		t.Fatal("CPU quantity conversion incorrect")
	}
	// PodMetrics uses names. Never attach a sample predating a replacement pod.
	usage["lab/app-pod"]["web"] = Usage{CPU: 99, Timestamp: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)}
	if find(normalize(fixture(), usage, nil, true), "pod-1").Usage != nil {
		t.Fatal("old metrics attributed to new pod UID")
	}
	if find(normalize(fixture(), usage, nil, false), "pod-1").Usage != nil {
		t.Fatal("unavailable metrics shown as current")
	}
}
func TestSelectorlessServiceDoesNotMatchAllPods(t *testing.T) {
	objects := fixture()
	objects[len(objects)-1].Object["spec"] = map[string]interface{}{"type": "ClusterIP"}
	if len(find(normalize(objects, nil, nil, false), "svc-1").Related) != 0 {
		t.Fatal("selectorless service must not match all pods")
	}
}
func testStore() *Store {
	kinds := map[schema.GroupVersionResource]string{}
	for _, r := range resources {
		kinds[schema.GroupVersionResource{Group: r.group, Version: r.version, Resource: r.resource}] = r.kind + "List"
	}
	return New("test", dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), kinds), kubefake.NewSimpleClientset(&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "kube-system"}}), metricsfake.NewSimpleClientset())
}
func until(t *testing.T, predicate func() bool) {
	t.Helper()
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		if predicate() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("condition did not converge")
}
func TestInformerCreateUpdateDeleteAndWatchReconnect(t *testing.T) {
	s := testStore()
	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{{Version: "v1", Resource: "pods"}: "PodList"})
	// Use just the Pod informer to isolate watch lifecycle from the remaining resources.
	base := New("test", dyn, s.kube, s.metrics)
	for _, w := range base.watches {
		if w.kind == "Pod" {
			s = base
			s.watches = []*watched{w}
			break
		}
	}
	var opens atomic.Int32
	opened := make(chan watch.Interface, 8)
	dyn.PrependWatchReactor("pods", func(action clienttesting.Action) (bool, watch.Interface, error) {
		w, err := dyn.Tracker().Watch(action.GetResource(), action.GetNamespace())
		opens.Add(1)
		opened <- w
		return true, w, err
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Start(ctx)
	until(t, func() bool { return s.watches[0].informer.HasSynced() && opens.Load() > 0 })
	gvr := schema.GroupVersionResource{Version: "v1", Resource: "pods"}
	pod := fixture()[2]
	_, err := dyn.Resource(gvr).Namespace("lab").Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		t.Fatal(err)
	}
	until(t, func() bool { return len(s.Snapshot().Resources) == 1 })
	(<-opened).Stop()
	until(t, func() bool { return opens.Load() > 1 })
	second := <-opened
	if emitter, ok := second.(interface{ Error(runtime.Object) }); ok {
		emitter.Error(&metav1.Status{Status: metav1.StatusFailure, Code: 410, Reason: metav1.StatusReasonExpired, Message: "resource version expired"})
	} else {
		t.Fatal("fake watch does not support error events")
	}
	second.Stop()
	until(t, func() bool { return opens.Load() > 2 })
	pod.SetLabels(map[string]string{"revision": "two"})
	_, err = dyn.Resource(gvr).Namespace("lab").Update(ctx, pod, metav1.UpdateOptions{})
	if err != nil {
		t.Fatal(err)
	}
	until(t, func() bool { return find(s.Snapshot().Resources, "pod-1").Labels["revision"] == "two" })
	err = dyn.Resource(gvr).Namespace("lab").Delete(ctx, pod.GetName(), metav1.DeleteOptions{})
	if err != nil {
		t.Fatal(err)
	}
	until(t, func() bool { return len(s.Snapshot().Resources) == 0 && len(s.Snapshot().DeletedResources) == 1 })
}
func TestHistoryBoundAndExpiry(t *testing.T) {
	s := testStore()
	s.maxPoints = 2
	// Seed node discovery cache and fake metrics, exercising the actual polling path.
	node := fixture()[3]
	for _, w := range s.watches {
		if w.kind == "Node" {
			_ = w.informer.GetStore().Add(node)
		}
	}
	client := s.metrics.(*metricsfake.Clientset)
	for i := 0; i < 3; i++ {
		metric := &metricsv1.NodeMetrics{ObjectMeta: metav1.ObjectMeta{Name: "worker"}, Timestamp: metav1.NewTime(time.Now().Add(time.Duration(i) * time.Second)), Usage: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("100m"), corev1.ResourceMemory: resource.MustParse("32Mi")}}
		if i == 0 {
			_ = client.Tracker().Create(schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "nodes"}, metric, "")
		} else {
			_ = client.Tracker().Update(schema.GroupVersionResource{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "nodes"}, metric, "")
		}
		s.Poll(context.Background())
	}
	if len(s.points) > 2 || s.dropped == 0 {
		t.Fatal("history buffer is not bounded")
	}
	if len(s.History("cluster", time.Now().Add(-time.Minute))) == 0 {
		t.Fatal("cluster metrics not recorded")
	}
	s.points = []Point{{UID: "cluster", Timestamp: time.Now().Add(-25 * time.Hour)}}
	s.Poll(context.Background())
	for _, p := range s.points {
		if p.Timestamp.Before(time.Now().Add(-24 * time.Hour)) {
			t.Fatal("expired point retained")
		}
	}
}
func TestAPIValidationAndReadOnlyRoutes(t *testing.T) {
	s := testStore()
	handler := s.Handler(t.TempDir())
	for _, tc := range []struct {
		method, path string
		code         int
	}{{"GET", "/api/v1/snapshot", 200}, {"GET", "/readyz", 503}, {"GET", "/api/v1/history?since=garbage", 400}, {"GET", "/api/v1/logs", 400}, {"GET", "/api/v1/logs?namespace=lab&pod=no&container=web&uid=no", 404}, {"POST", "/api/v1/snapshot", 405}, {"GET", "/api/v1/missing", 404}} {
		t.Run(tc.path, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, tc.path, nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.code {
				t.Fatalf("got %d: %s", w.Code, w.Body.String())
			}
		})
	}
	r := httptest.NewRequest("GET", "/api/v1/snapshot", nil)
	r.Header.Set("Origin", "https://other.test")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-origin request allowed")
	}
}
func TestDeletedPodNameCannotReadReplacementLogs(t *testing.T) {
	s := testStore()
	pod := fixture()[2]
	for _, w := range s.watches {
		if w.kind == "Pod" {
			_ = w.informer.GetStore().Add(pod)
		}
	}
	_, _ = s.kube.CoreV1().Pods("lab").Create(context.Background(), &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "app-pod", UID: "replacement"}}, metav1.CreateOptions{})
	w := httptest.NewRecorder()
	s.Handler(t.TempDir()).ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/logs?namespace=lab&pod=app-pod&container=web&uid=pod-1", nil))
	if w.Code != 409 {
		t.Fatalf("replacement logs accessible: %d %s", w.Code, w.Body.String())
	}
}
func TestSnapshotDoesNotSerializePodEnvironment(t *testing.T) {
	s := testStore()
	pod := fixture()[2]
	containers, _, _ := unstructured.NestedSlice(pod.Object, "spec", "containers")
	containers[0].(map[string]interface{})["env"] = []interface{}{map[string]interface{}{"name": "PASSWORD", "value": "not-for-ui"}}
	_ = unstructured.SetNestedSlice(pod.Object, containers, "spec", "containers")
	for _, w := range s.watches {
		if w.kind == "Pod" {
			_ = w.informer.GetStore().Add(pod)
		}
	}
	data, _ := json.Marshal(s.Snapshot())
	if strings.Contains(string(data), "not-for-ui") {
		t.Fatal("environment values exposed")
	}
}

func TestDeletedIdentityRetentionIsBounded(t *testing.T) {
	s := testStore()
	for i := 0; i < 505; i++ {
		pod := object("Pod", "same-name", fmt.Sprintf("uid-%d", i), map[string]interface{}{"spec": map[string]interface{}{}, "status": map[string]interface{}{"phase": "Running"}})
		s.archive("Pod", cache.DeletedFinalStateUnknown{Obj: pod})
	}
	if len(s.deleted) != 500 {
		t.Fatalf("tombstones not bounded: %d", len(s.deleted))
	}
	snap := s.Snapshot()
	if len(snap.Resources) != 0 || len(snap.DeletedResources) != 500 {
		t.Fatal("deleted resources mixed into current inventory")
	}
	for _, r := range snap.DeletedResources {
		if r.Status != "Deleted" || r.DeletedAt == nil {
			t.Fatal("missing deletion marker")
		}
	}
	old := time.Now().Add(-25 * time.Hour)
	s.deleted["expired"] = Resource{UID: "expired", DeletedAt: &old}
	for _, r := range s.Snapshot().DeletedResources {
		if r.UID == "expired" {
			t.Fatal("expired identity exposed")
		}
	}
}
func TestMetricsFailureAndRecovery(t *testing.T) {
	s := testStore()
	client := s.metrics.(*metricsfake.Clientset)
	client.PrependReactor("list", "pods", func(clienttesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("metrics API unavailable")
	})
	s.Poll(context.Background())
	if s.Snapshot().Metrics.Available || s.Snapshot().Metrics.Error == "" {
		t.Fatal("metrics outage not exposed")
	}
	client.ReactionChain = client.ReactionChain[1:]
	s.Poll(context.Background())
	if !s.Snapshot().Metrics.Available || s.Snapshot().Metrics.Error != "" {
		t.Fatal("metrics did not recover")
	}
}
