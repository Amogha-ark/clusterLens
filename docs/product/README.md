# ClusterLens product — live first slice

## Run locally

Prerequisites: the M0 lab is running, Go 1.24+, Node 22+, and npm. No Helm installation is required for host development.

```sh
make build
make run
```

Open http://127.0.0.1:8080. The binary serves the built React application and read-only API from one origin. It uses only `artifacts/clusterlens.kubeconfig` with the explicit `k3d-clusterlens` context by default. Stop it with Ctrl-C. AI is disabled by default; explicitly configured, user-triggered AI explanations can send selected evidence to the configured provider (see [AI setup](ai.md)); fonts, icons, CSS, and JavaScript are served locally.

For frontend iteration, use `make dev` in one terminal and `cd frontend && npm run dev` in another. Vite proxies `/api` to the backend. Open the Vite URL printed in that terminal. Run `npm ci` in frontend first when dependencies are missing.

## What works

- **Overview:** cluster-wide health verdict, namespace-scoped top workload contributors, current cluster CPU/memory, interactive collected history, and compact PVC-use summary. Nodes and events remain in dedicated views/details.
- **Workloads:** Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, standalone ReplicaSets/pods. Owner UIDs resolve pods through ReplicaSets to Deployments. Workloads without Kubernetes Services remain visible.
- **Resource explorer:** resource details, pod/container identities, resource requests/limits, metrics, matching events, node placement, PVC attachments, selector-matched Services, and links to connected resources.
- **Nodes:** readiness/pressure, capacity/allocatable in the API, current usage, and connected pods/volumes. Node CPU/memory in the dashboard is cluster-wide even when a namespace is selected. The k3d nodes share one Docker VM; capacities must not be treated as independent physical hosts.
- **Storage:** PVCs/PVs, storage classes, bindings, capacity, access modes, and attached pods/nodes/workloads. Capacity is not filesystem utilization or a local-path quota. CSI/Ceph health and used bytes are explicitly unavailable.
- **Logs:** on-demand pod log API, explicit pod UID/container selection, timestamped raw multiline output, previous-container option, returned-line text filtering, and optional five-second refresh. At most four concurrent queries, 500 lines and 256 KiB/query, a 10-second deadline, and a six-hour query lookback subject to kubelet retention. No node log collector, durable ingestion, or redaction pipeline is claimed.
- **Events:** filtered from the latest 200 Kubernetes events across the cluster, correlated by involved-object UID and workload relationships. Kubernetes controls event expiry; this slice does not durably retain them.
- **Navigation:** namespace/search filters, time windows for chart/events/logs, URL-addressable views/resource drawers, browser history, command search (Cmd/Ctrl-K, arrow keys, Enter), Escape-to-close dialogs, keyboard focus indicators, reduced motion, and a compact mobile navigation layout. Time windows do not rewind the current inventory.
- **Deletions:** at most 500 resource tombstones retain identity/ownership relationships for up to 24 hours in memory. Deleted resource details can be reached from retained events. Logs cannot be read after deletion. All volatile history disappears on process restart.

## Bounded telemetry spike

Metrics come from `metrics.k8s.io/v1beta1`, collected every 15 seconds. CPU is cores, memory is bytes, and sample timestamps come from Metrics Server rather than the UI clock. Missing/stale (>90s) container/node samples are not substituted with zero. Samples predating a pod's creation or running container's start are excluded. The cluster series sums actual node readings rather than adding node and pod usage together.

History has a 24-hour age ceiling and a global 60,000-point ceiling. The latter may evict samples well before 24 hours at higher resource counts; eviction counts are exposed. Repeated source timestamps are not new measurements. Current inventory responses cap at 5,000 resources; informer cache memory still scales with actual cluster inventory. This is a local-lab product slice, not a proven large-cluster storage system.

Metrics Server does not provide CPU throttling, storage filesystem usage, or historical data. A durable metrics/log store and an established node collector are intentionally deferred to a measured M1B persistence spike, as required by the architecture plan. This slice establishes working real data flows and UI without claiming complete M1B retention or log ingestion.

## Helm deployment

The chart installs one Deployment and ClusterIP Service with a dedicated read-only service account. It grants get/list/watch only for supported inventory, get for pod logs, and get/list for resource metrics. It has no Secret permissions and no Kubernetes write permissions. No ingress or public listener is created. The Go process in a container listens on the pod interface; use a loopback port forward to access it.

```sh
# Docker Desktop CLI must be on PATH for these direct CLI commands.
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker build -t clusterlens:dev .
k3d image import clusterlens:dev -c clusterlens
helm upgrade --install clusterlens deploy/helm/clusterlens \
  --kubeconfig artifacts/clusterlens.kubeconfig --kube-context k3d-clusterlens \
  --namespace observability-lab --wait --timeout 180s
kubectl --kubeconfig artifacts/clusterlens.kubeconfig --context k3d-clusterlens \
  -n observability-lab port-forward service/clusterlens 8080:8080 --address=127.0.0.1
```

Stop a host-running ClusterLens before binding the same port. Open http://127.0.0.1:8080. Remove only the platform with `helm uninstall clusterlens --kubeconfig artifacts/clusterlens.kubeconfig --kube-context k3d-clusterlens --namespace observability-lab`; deleting the lab cluster also removes the platform.

The deployment requests 100m CPU/128 MiB and limits 500m/512 MiB; GOMEMLIMIT is 384 MiB. These are scheduling/GC controls, not measurements or proof of the 1 GB/0.5-core average budget. Cluster-scoped RBAC resource names include the release namespace/name to avoid collisions.

## API

| Route | Response / behavior |
|---|---|
| `GET /healthz` | Process liveness |
| `GET /readyz` | 200 only when the API heartbeat and all inventory sources are synchronized; otherwise 503 |
| `GET /api/v1/snapshot` | Cluster ID, server timestamp, connection state, individual informer sync/errors, metric capability state, typed current resources, deleted resources, latest 200 events, and truncation/drop indicators |
| `GET /api/v1/history?uid=...&since=<RFC3339>` | Bounded volatile CPU/memory points; UID defaults to `cluster`; lookback clamped to 24h |
| `GET /api/v1/logs?namespace=...&pod=...&uid=...&container=...&sinceSeconds=900&previous=false` | Bounded raw logs plus source, timestamp and truncation information; validates cached and live pod UID to prevent name-reuse misattribution |

Signals use Kubernetes UIDs; a stable cluster ID scopes the single-cluster server. Models live in `backend/internal/cluster/models.go`. Errors are JSON `{ "error": "..." }` with appropriate HTTP status. Cross-origin browser requests are rejected; there is no permissive CORS. APIs expose selected normalized fields, not pod environment values, annotations, Secrets, or raw Kubernetes object dumps. Log contents remain visible to local users. The optional AI evidence adapter excludes logs and redacts known credential patterns in allowed free-text fields; it is not a general log-redaction pipeline.

## Checks

```sh
make test
make helm-check
python3 lab/scripts/lab.py validate
# Validate the rendered chart against the lab without installing it:
helm template clusterlens deploy/helm/clusterlens --namespace observability-lab > artifacts/platform.yaml
kubectl --kubeconfig artifacts/clusterlens.kubeconfig --context k3d-clusterlens \
  -n observability-lab apply --dry-run=server -f artifacts/platform.yaml
```

Run `python3 tests/integration/product_smoke.py` against a running instance connected to the baseline lab for read-only live API checks. See `docs/verification.md` for actual execution results and verification limits.

## Simplified management overview

The landing page leads with a plain-language cluster health verdict, followed by the largest measured CPU/memory contributors, an interactive trend, and a compact storage summary. No synthetic health score is shown. Rankings are percentages of measured workload usage in the selected namespace scope, not percentages of physical cluster capacity. Missing measurements remain missing; coverage is shown.

Storage now presents each PVC alongside its workload, referencing pods, and node placement. Filter by In use, Unattached, or Review suggested; raw PV/storage-class objects are under Technical inventory. These states describe pod references, not proven CSI attachment. Older unreferenced claims (creation age >=7 days) are review candidates; last-use time is unknown. Waiting claims and incomplete discovery have separate states.

Charts show exact timestamps and values on hover/touch, with arrow-key/Home/End inspection and Escape dismissal. The current native system font stack requires no bundled font files or font service.

## Typography, themes, and storage-health scope

The UI uses native system typography (the macOS system UI font on a Mac). Appearance controls in the header select Light, Dark, or System; System follows the operating system and is the default. Choices persist locally in this browser when storage is available and are shared with other tabs on the same origin. No font download or external appearance service is used.

Current storage monitoring covers PVC/PV status and capacity, pod references, storage classes, and Kubernetes node pressure conditions including reported DiskPressure. It does not measure disk utilization, SMART/device failures, Ceph cluster health, OSD status, pool health, or storage latency. These require the later storage telemetry integration and a suitable separate Ceph lab. The Storage page displays this limitation explicitly.

Ceph integration should use its supported monitoring endpoints: cluster-level metrics from the manager Prometheus module and daemon performance metrics from ceph-exporter where applicable to the deployed Ceph version. See [Ceph's monitoring documentation](https://docs.ceph.com/en/latest/mgr/prometheus/). No Ceph components or new cluster permissions are added by the appearance change.

## Connected investigation

Health/rankings, events, and storage mappings open the same investigation workspace. A named trail keeps the starting resource visible while you follow pods, node placement, storage bindings, Services, and controller ownership. Use Follow a connection from any evidence tab or return through the trail/Previous resource; the active evidence tab and rolling lookback stay selected.

The URL preserves namespace, resource UID, evidence tab, lookback, trail, and pod/container selection. Log choices survive evidence-tab changes and compatible resource pivots. Logs for an unrelated pod are not silently substituted. A 24-hour investigation explicitly offers a shared-window change before querying six-hour logs. Grouped relationship labels and event provenance distinguish association from a proven root cause.

See [the connected-investigation review](investigation-review.md) for findings, implemented fixes, journey acceptance criteria, and remaining incident-replay limitations. Exact frozen time windows, durable evidence, and saved investigation packages are not implemented yet.
