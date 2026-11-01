# Connected investigation review

## Assessment

The initial product linked resource identities correctly but still felt like separate monitoring views. A resource pivot remounted the drawer and reset its evidence tab, the selected time range disappeared on reload, the flat relationship list did not describe why entities were connected, and a log selection was lost when changing tabs. A 24-hour selection silently queried only six hours of logs. These are continuity failures even though each individual dashboard works.

The investigation drawer is now the primary evidence workspace. Overview/rankings, events, and storage mappings are entry points; they lead to the same resource context and connected evidence rather than requiring the user to manually reconstruct scope in another dashboard.

## Changes implemented

- Reviewed health-card redesign: the overview now groups failing pods under their owning workload and displays a bounded, expandable/searchable attention queue. Each Investigate action passes the original resource object/UID into the existing workspace. Healthy, degraded, missing-metrics and incomplete-discovery states use distinct copy; node/workload/storage links match the all-namespace health scope.

- A named investigation trail preserves the starting resource and visited path. Follow a connected resource from any evidence tab, return through the trail or Previous resource, and keep the evidence tab and rolling lookback. Trails are capped at eight entries while retaining the start; revisiting an ancestor truncates a cycle.
- URL state includes view, namespace, resource UID, evidence tab, time range, trail, selected pod UID, and container. Links/bookmarks and browser navigation restore those fields. Closing the investigation explicitly returns to the original discovery view; existing list search state is preserved in-session.
- The drawer stays mounted through resource pivots. The resource content scroll resets for the new subject, while its investigation controls remain available. History is keyed by UID/window so another resource's previous chart cannot flash into the new subject.
- Connections are grouped by Kubernetes meaning: owning/connected workloads, pods, node placement, claims/bindings, matching Services, and intermediate controllers. Node context explicitly includes neighbors and does not imply all workloads there caused an incident.
- Continue the investigation offers deterministic next checks based on pod readiness/restarts, reported node conditions, and volume references. They are prompts to inspect evidence, not root-cause claims.
- Logs stay scoped to eligible pods for the current workload/node/Service/volume, including PV-to-PVC-to-pod traversal. Pod/container selection survives tab changes and compatible resource pivots. An out-of-scope pod is not silently substituted; API queries still validate UID identity.
- Related events include retained deleted-pod ownership and distinguish the current subject from a related resource. Global event links enter the Events evidence tab directly.
- A 24-hour investigation cannot silently use a six-hour log query: it offers a shared-window change to the last six hours instead.

## Acceptance and evidence

- Frontend journey tests exercise workload → pod → node → workload while preserving Metrics and a one-hour lookback; Logs → Metrics → Logs → PVC while preserving the selected pod/container; and explicit shared-window adjustment at the log lookback limit.
- Helper tests cover URL round trips, malformed links/defaults, bounded trails, revisit behavior, event entry tabs, UID-based pod scoping, neighboring node pods, deleted pod exclusion, and evidence-grounded next checks.
- Existing metrics/log APIs and backend read-only permissions are unchanged. These are navigation/correlation improvements, not a storage engine or anomaly engine.

## Remaining limits

The current window is a rolling lookback, not a frozen absolute incident interval. Selecting an event/metric point does not yet pin all signals to one exact time interval. Durable historical evidence, cross-signal timeline brushing, saved investigation notes/evidence packages, deployment-change timelines, and Ceph/device-health evidence remain future work. Kubernetes events are retained by Kubernetes and capped in API responses; logs are bounded on-demand reads and metrics history is volatile. Correlation establishes association, not causality.

The next acceptance bar should be an actual failure investigation: start from one reported symptom, follow the linked workload/pod/node/PVC, compare exact retained time windows, and produce a source-cited evidence package without re-entering filters. Do not claim this entire incident-replay workflow is complete from resource-link navigation alone.
