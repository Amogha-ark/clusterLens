package cluster

import "time"

type Usage struct {
	CPU       float64   `json:"cpu"`    // cores, never a cumulative counter
	Memory    float64   `json:"memory"` // bytes
	Timestamp time.Time `json:"timestamp"`
}
type Container struct {
	Name          string  `json:"name"`
	ID            string  `json:"id"`
	Image         string  `json:"image"`
	Ready         bool    `json:"ready"`
	Restarts      int64   `json:"restarts"`
	State         string  `json:"state"`
	CPURequest    float64 `json:"cpuRequest"`
	CPULimit      float64 `json:"cpuLimit"`
	MemoryRequest float64 `json:"memoryRequest"`
	MemoryLimit   float64 `json:"memoryLimit"`
	Usage         *Usage  `json:"usage"`
}
type Resource struct {
	DeletedAt         *time.Time        `json:"deletedAt,omitempty"`
	UID               string            `json:"uid"`
	Kind              string            `json:"kind"`
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace"`
	Created           time.Time         `json:"created"`
	Labels            map[string]string `json:"labels"`
	OwnerUID          string            `json:"ownerUid"`
	WorkloadUID       string            `json:"workloadUid"`
	Status            string            `json:"status"`
	Ready             int64             `json:"ready"`
	Desired           int64             `json:"desired"`
	Restarts          int64             `json:"restarts"`
	Node              string            `json:"node"`
	Containers        []Container       `json:"containers"`
	Related           []string          `json:"related"`
	Usage             *Usage            `json:"usage"`
	CPUCapacity       float64           `json:"cpuCapacity"`
	MemoryCapacity    float64           `json:"memoryCapacity"`
	CPUAllocatable    float64           `json:"cpuAllocatable"`
	MemoryAllocatable float64           `json:"memoryAllocatable"`
	Capacity          float64           `json:"capacity"`
	StorageClass      string            `json:"storageClass"`
	Provisioner       string            `json:"provisioner"`
	Volume            string            `json:"volume"`
	AccessModes       []string          `json:"accessModes"`
	Conditions        []string          `json:"conditions"`
}
type Event struct {
	UID         string    `json:"uid"`
	ResourceUID string    `json:"resourceUid"`
	Namespace   string    `json:"namespace"`
	Name        string    `json:"name"`
	Reason      string    `json:"reason"`
	Message     string    `json:"message"`
	Type        string    `json:"type"`
	Count       int64     `json:"count"`
	Timestamp   time.Time `json:"timestamp"`
}
type Source struct {
	Kind   string `json:"kind"`
	Synced bool   `json:"synced"`
	Error  string `json:"error"`
}
type MetricsStatus struct {
	Available   bool      `json:"available"`
	Error       string    `json:"error"`
	LastSuccess time.Time `json:"lastSuccess"`
}
type Snapshot struct {
	Cluster          string        `json:"cluster"`
	Timestamp        time.Time     `json:"timestamp"`
	Connected        bool          `json:"connected"`
	ConnectionError  string        `json:"connectionError"`
	Sources          []Source      `json:"sources"`
	Metrics          MetricsStatus `json:"metrics"`
	Resources        []Resource    `json:"resources"`
	DeletedResources []Resource    `json:"deletedResources"`
	Events           []Event       `json:"events"`
	Truncated        bool          `json:"truncated"`
	HistoryDropped   int64         `json:"historyDropped"`
}
type Point struct {
	UID       string    `json:"uid"`
	CPU       float64   `json:"cpu"`
	Memory    float64   `json:"memory"`
	Timestamp time.Time `json:"timestamp"`
}
