package cluster

import (
	"sort"
	"time"

	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func text(u map[string]interface{}, path ...string) string {
	v, _, _ := unstructured.NestedString(u, path...)
	return v
}
func integer(u map[string]interface{}, path ...string) int64 {
	v, _, _ := unstructured.NestedInt64(u, path...)
	return v
}
func boolean(u map[string]interface{}, path ...string) bool {
	v, _, _ := unstructured.NestedBool(u, path...)
	return v
}
func entries(u map[string]interface{}, path ...string) []interface{} {
	v, _, _ := unstructured.NestedSlice(u, path...)
	return v
}
func quantity(u map[string]interface{}, path ...string) float64 {
	v := text(u, path...)
	q, err := resource.ParseQuantity(v)
	if err != nil {
		return 0
	}
	return q.AsApproximateFloat64()
}
func stamp(v string) time.Time { t, _ := time.Parse(time.RFC3339Nano, v); return t }
func stringsAt(u map[string]interface{}, path ...string) []string {
	v, _, _ := unstructured.NestedStringSlice(u, path...)
	if v == nil {
		return []string{}
	}
	return v
}
func isController(kind string) bool {
	switch kind {
	case "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "ReplicaSet":
		return true
	}
	return false
}
func normalize(objects []*unstructured.Unstructured, podUsage map[string]map[string]Usage, nodeUsage map[string]Usage, metricsOK bool) []Resource {
	out := make([]Resource, 0, len(objects))
	byUID := map[string]int{}
	byName := map[string]string{}
	for _, u := range objects {
		o := u.Object
		r := Resource{UID: string(u.GetUID()), Kind: u.GetKind(), Name: u.GetName(), Namespace: u.GetNamespace(), Created: u.GetCreationTimestamp().Time, Labels: u.GetLabels(), Containers: []Container{}, Related: []string{}, Conditions: []string{}, AccessModes: []string{}}
		if r.Labels == nil {
			r.Labels = map[string]string{}
		}
		for _, owner := range u.GetOwnerReferences() {
			if owner.Controller != nil && *owner.Controller {
				r.OwnerUID = string(owner.UID)
				break
			}
		}
		switch r.Kind {
		case "Pod":
			r.Node = text(o, "spec", "nodeName")
			r.Status = text(o, "status", "phase")
			statuses := map[string]map[string]interface{}{}
			for _, key := range []string{"containerStatuses", "initContainerStatuses"} {
				for _, v := range entries(o, "status", key) {
					if c, ok := v.(map[string]interface{}); ok {
						statuses[text(c, "name")] = c
					}
				}
			}
			for _, key := range []string{"containers", "initContainers"} {
				for _, v := range entries(o, "spec", key) {
					c, ok := v.(map[string]interface{})
					if !ok {
						continue
					}
					name := text(c, "name")
					status := statuses[name]
					state := "Pending"
					if reason := text(status, "state", "waiting", "reason"); reason != "" {
						state = reason
						if r.Status != "Succeeded" {
							r.Status = reason
						}
					} else if reason := text(status, "state", "terminated", "reason"); reason != "" {
						state = reason
						if reason != "Completed" {
							r.Status = reason
						}
					} else if started := text(status, "state", "running", "startedAt"); started != "" {
						state = "Running"
					}
					container := Container{Name: name, Image: text(c, "image"), ID: text(status, "containerID"), State: state, Ready: boolean(status, "ready"), Restarts: integer(status, "restartCount"), CPURequest: quantity(c, "resources", "requests", "cpu"), CPULimit: quantity(c, "resources", "limits", "cpu"), MemoryRequest: quantity(c, "resources", "requests", "memory"), MemoryLimit: quantity(c, "resources", "limits", "memory")}
					if metricsOK {
						if usage, ok := podUsage[r.Namespace+"/"+r.Name][name]; ok && !usage.Timestamp.Before(r.Created) && time.Since(usage.Timestamp) < 90*time.Second {
							start := stamp(text(status, "state", "running", "startedAt"))
							if !usage.Timestamp.Before(start) {
								copy := usage
								container.Usage = &copy
							}
						}
					}
					r.Restarts += container.Restarts
					if key == "containers" {
						r.Desired++
						if container.Ready {
							r.Ready++
						}
					}
					r.Containers = append(r.Containers, container)
				}
			}
			for _, c := range r.Containers {
				if c.Usage != nil {
					if r.Usage == nil {
						r.Usage = &Usage{Timestamp: c.Usage.Timestamp}
					}
					r.Usage.CPU += c.Usage.CPU
					r.Usage.Memory += c.Usage.Memory
				}
			}
		case "Node":
			r.Status = "Unknown"
			r.CPUCapacity = quantity(o, "status", "capacity", "cpu")
			r.MemoryCapacity = quantity(o, "status", "capacity", "memory")
			r.CPUAllocatable = quantity(o, "status", "allocatable", "cpu")
			r.MemoryAllocatable = quantity(o, "status", "allocatable", "memory")
			for _, v := range entries(o, "status", "conditions") {
				c, ok := v.(map[string]interface{})
				if !ok {
					continue
				}
				if text(c, "type") == "Ready" {
					if text(c, "status") == "True" {
						r.Status = "Ready"
					} else {
						r.Status = "NotReady"
					}
				} else if text(c, "status") == "True" {
					r.Conditions = append(r.Conditions, text(c, "type"))
				}
			}
			if metricsOK {
				if usage, ok := nodeUsage[r.Name]; ok && time.Since(usage.Timestamp) < 90*time.Second {
					copy := usage
					r.Usage = &copy
				}
			}
		case "Deployment", "StatefulSet", "ReplicaSet":
			r.Desired = integer(o, "spec", "replicas")
			r.Ready = integer(o, "status", "readyReplicas")
			r.Status = "Healthy"
			if r.Ready < r.Desired {
				r.Status = "Degraded"
			}
			if r.Desired == 0 {
				r.Status = "Scaled to zero"
			}
		case "DaemonSet":
			r.Desired = integer(o, "status", "desiredNumberScheduled")
			r.Ready = integer(o, "status", "numberReady")
			r.Status = "Healthy"
			if r.Ready < r.Desired {
				r.Status = "Degraded"
			}
		case "Job":
			r.Desired = integer(o, "spec", "completions")
			if r.Desired == 0 {
				r.Desired = 1
			}
			r.Ready = integer(o, "status", "succeeded")
			r.Status = "Running"
			if r.Ready >= r.Desired {
				r.Status = "Completed"
			}
			for _, v := range entries(o, "status", "conditions") {
				c, ok := v.(map[string]interface{})
				if ok && text(c, "type") == "Failed" && text(c, "status") == "True" {
					r.Status = "Failed"
				}
			}
		case "CronJob":
			r.Status = "Scheduled"
			if boolean(o, "spec", "suspend") {
				r.Status = "Suspended"
			}
		case "PersistentVolumeClaim":
			r.Status = text(o, "status", "phase")
			r.Capacity = quantity(o, "status", "capacity", "storage")
			r.StorageClass = text(o, "spec", "storageClassName")
			r.Volume = text(o, "spec", "volumeName")
			r.AccessModes = stringsAt(o, "spec", "accessModes")
		case "PersistentVolume":
			r.Status = text(o, "status", "phase")
			r.Capacity = quantity(o, "spec", "capacity", "storage")
			r.StorageClass = text(o, "spec", "storageClassName")
			r.AccessModes = stringsAt(o, "spec", "accessModes")
		case "Namespace":
			r.Status = text(o, "status", "phase")
		case "Service":
			r.Status = "Configured"
		case "StorageClass":
			r.Status = "Available"
			r.Provisioner = text(o, "provisioner")
		}
		byUID[r.UID] = len(out)
		byName[r.Kind+"/"+r.Namespace+"/"+r.Name] = r.UID
		out = append(out, r)
	}
	root := func(uid string) string {
		seen := map[string]bool{}
		for i := 0; i < 10; i++ {
			index, ok := byUID[uid]
			if !ok || seen[uid] {
				return ""
			}
			seen[uid] = true
			r := out[index]
			if r.OwnerUID == "" {
				return uid
			}
			if _, ok := byUID[r.OwnerUID]; !ok {
				return uid
			}
			uid = r.OwnerUID
		}
		return ""
	}
	add := func(a, b string) {
		if a == "" || b == "" || a == b {
			return
		}
		ia, oka := byUID[a]
		ib, okb := byUID[b]
		if !oka || !okb {
			return
		}
		contains := func(xs []string, v string) bool {
			for _, x := range xs {
				if x == v {
					return true
				}
			}
			return false
		}
		if !contains(out[ia].Related, b) {
			out[ia].Related = append(out[ia].Related, b)
		}
		if !contains(out[ib].Related, a) {
			out[ib].Related = append(out[ib].Related, a)
		}
	}
	for i := range out {
		if out[i].Kind == "Pod" {
			out[i].WorkloadUID = root(out[i].UID)
		}
		add(out[i].UID, out[i].OwnerUID)
	}
	for _, u := range objects {
		id := string(u.GetUID())
		index := byUID[id]
		r := out[index]
		if r.Kind == "Pod" {
			add(id, r.WorkloadUID)
			node := byName["Node//"+r.Node]
			if ni, ok := byUID[node]; ok {
				out[ni].Desired++
			}
			add(id, node)
			add(r.WorkloadUID, node)
			for _, v := range entries(u.Object, "spec", "volumes") {
				volume, ok := v.(map[string]interface{})
				if ok {
					claim := byName["PersistentVolumeClaim/"+r.Namespace+"/"+text(volume, "persistentVolumeClaim", "claimName")]
					add(id, claim)
					add(r.WorkloadUID, claim)
					add(node, claim)
				}
			}
		}
		if r.Kind == "PersistentVolumeClaim" {
			add(id, byName["PersistentVolume//"+r.Volume])
			add(id, byName["StorageClass//"+r.StorageClass])
		}
		if r.Kind == "Service" {
			selector, _, _ := unstructured.NestedStringMap(u.Object, "spec", "selector")
			if len(selector) == 0 {
				continue
			}
			for _, pod := range out {
				if pod.Kind != "Pod" || pod.Namespace != r.Namespace {
					continue
				}
				match := true
				for k, v := range selector {
					if pod.Labels[k] != v {
						match = false
						break
					}
				}
				if match {
					add(id, pod.UID)
					add(id, pod.WorkloadUID)
				}
			}
		}
	}
	for i := range out {
		r := &out[i]
		if !isController(r.Kind) {
			continue
		}
		for _, p := range out {
			if p.Kind == "Pod" && p.WorkloadUID == r.UID {
				r.Restarts += p.Restarts
				if p.Usage != nil {
					if r.Usage == nil {
						r.Usage = &Usage{Timestamp: p.Usage.Timestamp}
					}
					r.Usage.CPU += p.Usage.CPU
					r.Usage.Memory += p.Usage.Memory
					if p.Usage.Timestamp.After(r.Usage.Timestamp) {
						r.Usage.Timestamp = p.Usage.Timestamp
					}
				}
			}
		}
		sort.Strings(r.Related)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		return out[i].Name < out[j].Name
	})
	return out
}
func normalizeEvent(u *unstructured.Unstructured) Event {
	o := u.Object
	t := stamp(text(o, "lastTimestamp"))
	if t.IsZero() {
		t = stamp(text(o, "eventTime"))
	}
	if t.IsZero() {
		t = stamp(text(o, "firstTimestamp"))
	}
	if t.IsZero() {
		t = u.GetCreationTimestamp().Time
	}
	return Event{UID: string(u.GetUID()), ResourceUID: text(o, "involvedObject", "uid"), Namespace: u.GetNamespace(), Name: text(o, "involvedObject", "name"), Reason: text(o, "reason"), Message: text(o, "message"), Type: text(o, "type"), Count: integer(o, "count"), Timestamp: t}
}
