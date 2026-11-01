# ClusterLens — Project Plan

**Status:** Live product slice implemented: discovery, resource correlation, current metrics/log adapters, React dashboard, and Helm packaging; durable telemetry storage remains pending  
**Goal:** A minimalist, self-hosted, Kubernetes-first observability platform that automatically correlates workload, node, storage, log, and event data, with optional AI-assisted investigations.

## 1. Product principles

1. **Install once, discover automatically.** One Helm release should provide a useful cluster overview without manually creating dashboards.
2. **One connected investigation.** Start from cluster health or a workload, then follow pods, containers, nodes, PVCs, events, metrics, and logs without losing identity, scope, time range, or the investigation trail. Separate views are entry points into the same evidence workspace.
3. **Evidence before AI.** Deterministic health checks and anomaly detection produce evidence; LLM analysis is optional and must cite that evidence.
4. **Low overhead.** Bounded memory, CPU, cardinality, log volume, retention, and query cost.
5. **Self-hosted first.** Keep telemetry local; external AI integrations must be opt-in with redaction.
6. **Open standards.** Prefer Kubernetes APIs, OpenTelemetry, and established storage/collection components over proprietary protocols.

## 2. Initial test environment

| Item | Target |
|---|---|
| Host | macOS, 16 GB RAM |
| Docker Desktop | 8 GB memory allocation |
| Kubernetes | k3d / K3s, 1 server + 2 agents |
| Workloads | Scale from 30–50 to 100 synthetic pods |
| Workload mix | 55 normal, 15 log producers, 10 CPU, 10 memory, 10 PVC writers |
| Storage (phase 1) | K3s local-path provisioner; 10 small PVCs |
| Storage (phase 2) | Rook-Ceph in a **separate** Linux VM lab with dedicated virtual disks |
| Failure tests | CrashLoopBackOff, OOMKilled, FailedScheduling, CPU throttling, bounded PVC fill, log spikes |

**Resource guardrails:** 100 pods is a stretch target, not a requirement for the first run. Use low resource requests and finite-duration stress tests. Avoid unbounded writes, host disk filling, and continuous CPU/memory stress. Reserve headroom for Kubernetes and ClusterLens components. Docker Desktop resources are shared across k3d nodes.

## 3. Scope

### MVP (Milestone 1)

- Cluster, namespace, node, workload, pod, and container discovery.
- Pod state, restarts, resource requests/limits, and Kubernetes events.
- Container CPU and memory usage; node resource usage and pressure conditions.
- Container stdout/stderr logs with metadata and bounded ingestion.
- PVC/PV/storage-class inventory and status; capacity/usage where available.
- Minimal UI: Overview, Services, Nodes, Storage, Logs, and a unified resource detail page.
- Historical data for short retention and basic search/filtering.
- Local Helm deployment, tests, and reproducible demo lab.

### Later milestones

- **M2 — Storage and correlation:** Ceph health, OSDs, pools, CSI telemetry, PVC-to-node-to-storage relationships; deployment timeline; rule-based incident grouping.
- **M3 — Intelligence:** baseline/anomaly detection, trend forecasts with confidence bounds, root-cause evidence packages, optional LLM summaries.
- **M4 — Production hardening:** multi-cluster, authentication/RBAC, TLS, tenant isolation, retention controls, alerts, backups, upgrade paths, security review, performance testing.

**Explicitly out of MVP:** Full distributed tracing, arbitrary application instrumentation, automatic remediation, multi-cluster federation, and running Ceph on the 8 GB Docker Desktop lab.

## 4. Architecture

```text
Kubernetes API ----> Cluster discovery controller (Go, Deployment)
                        |   resource inventory + events
Node/kubelet --------> Node telemetry agent (DaemonSet) / metrics adapters
Container logs ------> Node log collector (DaemonSet)
PVC/CSI/Ceph --------> Storage adapters (Ceph in M2)
                        |
                        v
              Normalization + ingestion
                        |
                 Bounded queue / backpressure
                        |
             Metrics store + logs/events store
                        |
                Query / correlation API
                        |
                 React web dashboard
                        |
          Rules / anomaly engine / optional LLM
```

**Implementation choices to validate in a short spike:**

- **Discovery:** Go `client-go` shared informers, Kubernetes API watches, least-privilege RBAC.
- **Metrics:** Prefer kubelet/cAdvisor/metrics-server where supported; distinguish instantaneous usage from cumulative counters and node pressure conditions. Metrics Server is not a historical metrics store.
- **Logs:** Reuse Fluent Bit or OpenTelemetry Collector rather than writing a container-log tailer from scratch. Support multiline stack traces, timestamps, filtering, rate limits, and redaction.
- **Storage:** Begin with a small-footprint local persistence option; evaluate VictoriaMetrics for metrics and ClickHouse for logs/events against the 8 GB Docker budget. Do not require both before first working vertical slice.
- **Backend:** Go for collectors; Go or FastAPI for the query API (choose one after profiling complexity and overhead).
- **UI:** React + TypeScript; accessible, fast, service-first navigation.
- **AI:** Statistical detection first; an LLM receives compact, time-bounded evidence with links to supporting signals.

## 5. Canonical resource identity

Every signal must be correlated through stable identifiers when available:

```json
{
  "cluster_id": "clusterlens-local",
  "namespace": "observability-lab",
  "node_name": "k3d-clusterlens-agent-0",
  "workload_kind": "Deployment",
  "workload_name": "example-api",
  "pod_uid": "<kubernetes-pod-uid>",
  "pod_name": "example-api-abc123",
  "container_name": "api",
  "container_id": "<runtime-container-id>",
  "timestamp": "<RFC3339-UTC>"
}
```

Do not use pod name alone as a permanent identifier. Preserve timestamps, source, severity, and trace/request IDs where available. Track relationships and historical ownership across restarts and redeployments.

## 6. User experience

### Overview

Cluster health, running/pending/failed pods, resource utilization, node pressure, recent events, and high-priority findings.

### Service detail

Replicas and availability, CPU/memory trends, restarts, related logs, events, deployment changes, node placement, and attached volumes in one timeline.

### Node detail

Allocatable/capacity, usage, pressure conditions, running pods, filesystem and network metrics where supported.

### Storage detail

PVC/PV bindings, storage classes, usage where exposed, CSI health; later Ceph cluster/pool/OSD health.

### Logs

Search by time, cluster, namespace, service, pod, container, severity, and free text; live tail with bounded throughput; linked to metric/event timelines.

## 7. Milestones and acceptance criteria

### M0 — Reproducible lab

**Deliverables:** k3d config, Helm/manifests, synthetic workloads, local PVCs, scenario runner, cleanup scripts, README.

**Done when:**
- Cluster creates and destroys reproducibly on the specified Mac.
- 30–50 pods run stably; scale toward 100 while monitoring Docker memory and scheduling.
- At least one PVC binds and is written safely.
- JSON logs are visible with `kubectl logs`.
- CrashLoopBackOff and FailedScheduling scenarios produce inspectable events.

### M1A — Discovery and inventory

**Deliverables:** Go controller, informer caches, typed internal models, read-only APIs.

**Done when:**
- API lists clusters, namespaces, nodes, workloads, pods, containers, PVCs, and recent events.
- Changes appear without restarting the collector.
- Watch reconnect, deletion, and resource-version recovery are tested.
- RBAC excludes secrets and unnecessary write permissions.

### M1B — Metrics and logs

**Deliverables:** metrics adapter, log pipeline, bounded persistence, query endpoints.

**Done when:**
- CPU/memory measurements are timestamped and associated with correct pod/container IDs.
- Restart counts and node conditions are visible.
- Structured and multiline logs are searchable by pod/service and time range.
- Collection recovers from temporary backend unavailability with explicit loss/drop metrics.
- Retention and ingestion limits are configurable.

### M1C — Minimal dashboard

**Deliverables:** React UI and Helm chart for the platform.

**Done when:**
- A user can move from cluster overview to service, pod, node, PVC, logs, and events.
- A single service page shows correlated metrics, logs, and events.
- Empty, unavailable, stale, and permission-denied states are explicit.
- No custom dashboard or PromQL is required.

### M2 — Storage integration

**Done when:**
- A separate Linux Rook-Ceph lab reports health, OSD status, pool capacity, and relevant CSI metrics.
- A test OSD failure is visible and linked to affected storage resources where evidence supports the relationship.

### M3 — AI-assisted investigation

**Done when:**
- A deterministic anomaly rule identifies a reproducible memory-growth or restart incident.
- The analysis links to exact source time windows and logs/events.
- Predictions include uncertainty and avoid asserting a root cause without evidence.
- LLM usage is opt-in, rate-limited, and redacts sensitive data.

## 8. Repository layout

```text
clusterlens/
  AGENTS.md
  plan.md
  README.md
  agent/
    cmd/
    internal/discovery/
    internal/metrics/
    internal/models/
  backend/
    api/
    ingestion/
    storage/
  frontend/
  deploy/helm/
  lab/
    k3d/
    workloads/
    scenarios/
    scripts/
  docs/architecture/
  tests/integration/
```

## 9. Codex execution workflow

Implement one reviewable change at a time. For each task, require: code, tests, local verification commands, resource-impact notes, and documentation changes. Do not invent telemetry or silently mock real integrations in production paths.

**Suggested first Codex task:**

> Read `plan.md`. Implement only M0: a reproducible k3d lab for macOS with 8 GB Docker Desktop memory. Provide 1 server + 2 agents, 30–50 low-resource pods initially and a documented scale-up to 100 pods, JSON log generators, 10 bounded local-path PVC writers, controlled CrashLoopBackOff and FailedScheduling scenarios, and safe cleanup. Validate all manifests, provide exact commands and a README. Do not install Ceph or build the monitoring backend yet.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| 8 GB Docker memory exhausted | Ramp pods gradually; resource requests/limits; observe actual usage |
| Excessive log volume | Per-pod caps, filtering, retention, drop counters |
| High-cardinality metrics | Stable label schema, limits on arbitrary labels |
| Metrics missing on some runtimes | Capability detection and explicit unsupported states |
| PVC size not enforced by local-path | Bounded writes; do not assume requested capacity is a hard quota |
| Ceph resource/device complexity | Separate Linux VM with dedicated virtual disks |
| Sensitive data in logs | Redaction, RBAC, encryption, opt-in LLM forwarding |
| AI false conclusions | Evidence links, uncertainty, deterministic checks first |

## 11. Immediate next steps

1. Commit this `plan.md` and create `AGENTS.md` with repository-specific coding and testing rules.
2. Ask Codex to implement M0 only.
3. Run the lab on the Mac; record pod readiness, node utilization, and Docker memory.
4. Implement M1A discovery before adding log storage or AI.
5. Review the resource budget before choosing persistence engines.

## 12. Accepted implementation decisions and current progress

- Git is initialized. Repository guidance, lab lifecycle tooling, offline tests, and setup documentation are present.
- M0 baseline: 40 pods (20 normal, 5 logs, 3 CPU, 2 memory, 10 PVC writers). The optional stretch profile uses the original 100-pod mix. Failure scenarios are opt-in, time-bounded, and cleaned up explicitly.
- M0 baseline live checks passed: three ready nodes, 40 ready pods, ten verified bounded PVC files, JSON logs, and server-side manifest validation. Docker Desktop CLI PATH detection is included. See `docs/verification.md` for measured startup resource use and remaining acceptance checks.
- M1 targets a local demo, exposed locally. ClusterLens itself targets 1 GB steady-state memory and 0.5 CPU core average under baseline load, measured during the telemetry spike.
- Navigation is workload-first, with links to Kubernetes Services and explicit support for workloads without Services.
- React/TypeScript UI direction: **calm mission control** — dark surfaces, crisp typography, restrained colors, progressive disclosure, contextual panels, keyboard navigation, command search, and brief interruptible transitions honoring reduced motion. Every view must expose loading, empty, stale, unavailable, and permission-denied states.
- Initial retention targets: 24 hours of metrics/events and 6 hours of logs, subject to measured byte/ingestion limits. Deleted-resource identity and ownership remain available for the associated telemetry window.
- The platform Helm release includes selected collectors and storage; synthetic lab workloads remain separate.
- CPU throttling availability is an explicit telemetry-spike capability check. Select persistence engines only after baseline measurement.
- M2 acceptance must additionally cover the roadmap's correlation relationships, deployment timeline, and rule-based incident grouping.
- Next: run and record M0 live acceptance, then implement M1A discovery. See `docs/architecture/decisions.md` for the accepted sequence.

---

**North star:** Open any Kubernetes service and immediately understand its health, resource usage, logs, events, placement, and storage dependencies—without manually assembling dashboards.

## 13. First live product slice

- Implemented Go shared-informer discovery for 14 resource types, stable UID/ownership correlation, read-only inventory/metrics/history/log APIs, bounded volatile history, and deletion tombstones.
- Implemented the React/TypeScript calm mission-control dashboard: Overview, Workloads, Nodes, Storage, Logs, Events, resource explorer, filters, actual metric charts, command search, and reduced-motion/mobile layouts.
- Added a multi-stage product container and Helm release with a dedicated read-only service account. No public ingress, Secret access, or remediation actions.
- This completes the first usable M1A/M1C vertical slice with real telemetry adapters, not the full M1B storage milestone. Metrics history and deleted identity are volatile; logs are queried on demand from Kubernetes. Durable 24h/6h retention, an established node log collector, ingestion loss counters, CPU throttling, and filesystem utilization remain explicit follow-up work.
- The telemetry/persistence spike must measure baseline/steady-state overhead and select durable engines before those retention guarantees are claimed. See `docs/product/README.md` and `docs/verification.md`.

## 14. UI redesign — management-first clarity

- Initial view prioritizes one cluster-health verdict, top CPU/memory workload contributors, an interactive trend, and a compact storage-use summary. Dense topology and raw events are moved out of the landing page.
- New sessions start at all namespaces; cluster health remains cluster-wide while workload rankings and PVC mappings follow the chosen scope.
- Self-hosted Inter, readable text, generous spacing, and rounded cards/controls replace the earlier dense presentation.
- Charts expose actual values/timestamps via hover/touch and keyboard interaction, with visible gaps for missing measurements.
- PVCs show their workload and active pod references, with In use, Unattached, Waiting for storage, Needs attention, and Unknown states. Claims created >=7 days ago with no active references are review candidates; neither staleness nor physical CSI attachment is asserted.

## 15. Native typography and themes

- Use native system UI fonts with an Apple-like feel on macOS; bundled Inter is removed.
- Provide persistent Light, Dark, and System appearance controls, with System as the default. Apply appearance before paint and respect OS changes in System mode.
- Keep storage capability boundaries visible: PVC/PV inventory and pod mappings plus Kubernetes disk-pressure conditions are available; Ceph/OSD/disk-utilization and physical disk-health telemetry are still pending M2 integration.

## Optional AI slice (user-requested)

Resource-scoped, read-only explanations are implemented with configurable Ollama/OpenAI providers, evidence preview, explicit consent, bounded payloads, credential-pattern redaction and validated citations. Logs are excluded. This does not complete M3 anomaly detection, forecasts, durable evidence or automated root-cause analysis. See docs/product/ai.md for setup and verification limits.


User-requested investigation continuity now includes route-preserving new-tab links, bounded browser-saved AI snapshots and process-local background AI jobs. Browser closure does not cancel an accepted job; explicit cancellation does. This does not establish durable backend job/evidence persistence across restarts.
