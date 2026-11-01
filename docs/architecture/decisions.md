# Accepted implementation decisions

## In-memory Forecasts milestone — 2026-11-01

- Add a dedicated Forecasts page using the existing UID-scoped 24-hour history API. Compute CPU/memory trend projections in the browser with 1h/3h/6h horizons and conservative history/freshness eligibility checks.
- Show an explicitly heuristic uncertainty envelope, never a claimed probability or calibrated confidence level. Unknown, sparse, stale, incomplete or highly variable telemetry suppresses predictions.
- Keep forecast history independent from the dashboard lookback and label that difference. Use native keyboard/touch controls and existing resource investigation entry points. No provider calls or persistent storage are introduced. See `docs/product/forecasts.md`.

## Reviewed health-card redesign — 2026-11-01

- Overview uses a spacious health card with native typography, state-aware tint, cluster-wide node/workload/claim counts and observation context. Claims are described as bound, not as proof of disk health.
- Multiple issues appear in a five-row attention queue grouped by workload ownership, sorted with zero-ready workloads first. Expand/search stays in the overview; investigation actions reuse the existing resource UID and evidence workspace. Unknown statuses have a separate filter.
- Health-card navigation explicitly opens all namespaces to match its cluster-wide counts. Workload rankings and storage summaries continue to honor the selected namespace.
- Disconnected/stale snapshots and invalid or older-than-90-second node metrics cannot supply current usage. Partial measured-node coverage and truncated inventory are labeled. No telemetry, forecasts, model calls or cluster permissions are added by this milestone.

- Audience: local, single-cluster demo. API/UI stay local via port forwarding. Shared access controls remain later work.
- Navigation: workloads are primary entities; link Kubernetes Services to selected workloads, including explicit handling of workloads without Services.
- Platform budget: target 1 GB steady-state RAM and 0.5 CPU core average at baseline load. Measure, do not assume compliance.
- Delivery order: M0 lab, M1A Go shared-informer discovery and read-only inventory APIs, M1B telemetry spike/pipeline, M1C UI and platform Helm release. Live M0 validation gates platform work.
- Starting workload mix: 20 normal, 5 logs, 3 CPU, 2 memory, 10 PVC writers. Stress runs once per container start; scenarios are opt-in.
- Telemetry spike: evaluate metrics availability (including CPU throttling), identity attribution, storage overhead, ingestion/drop behavior, and disk limits before choosing persistence engines.
- Retention targets: metrics/events 24 hours, logs 6 hours, with explicit byte/ingestion bounds determined by the spike. Retain deleted resource identity and ownership for corresponding telemetry history.
- Installation: one platform Helm release includes selected collectors and persistence dependencies; lab workloads stay separate.
- UI: React/TypeScript; calm mission control, dark surfaces, crisp type, restrained status color, clear hierarchy, progressive disclosure, contextual details, command search, and keyboard navigation. Brief interruptible motion honors reduced-motion preferences. Loading, stale, empty, unavailable, and permission-denied states remain explicit. No dashboard mock is substituted for live telemetry.
- M2 acceptance must cover relationship correlation, deployment timelines, and rule-based incident grouping in addition to Ceph health, as specified in the roadmap.

- First product slice: live informer/API/dashboard flows are implemented with bounded volatile metrics and on-demand pod logs. This is an explicit bridge to the M1B persistence spike, not a durable 24h/6h retention implementation. See `docs/product/README.md`.

## Management-friendly UI revision

- Landing-page order: cluster health verdict, highest measured workload resource contributors, interactive resource trend, then compact PVC-use summary. Raw events and topology stay in dedicated views/details.
- Default new sessions to all namespaces. Health and node trends are always cluster-wide; workload rankings and PVC lists honor the namespace filter.
- Use self-hosted Inter, more readable sizes, generous spacing, and rounded cards/controls. Avoid fabricated health scores, cost estimates, or utilization percentages based on shared k3d capacities.
- Rank workloads by observed CPU/memory. Percentages use the measured workload total in the selected scope, exclude owned child workloads from double-counting, and expose measurement coverage.
- PVC usage is inferred from current non-completed pod references. Distinguish In use, Unattached, Waiting for storage, Needs attention, and Unknown. Missing or truncated discovery cannot establish that a claim is unattached.
- Suggest human review for unattached claims created at least seven days ago. Creation age is not last-use age; do not label these as proven stale, physically unmounted, or safe to delete.
- Charts support pointer/touch inspection and keyboard arrows, Home/End, Escape; show actual timestamps/values and leave gaps for missing measurements.

## Native typography and appearance

- Native system UI fonts replace bundled Inter. macOS uses its native system font via `-apple-system`/`BlinkMacSystemFont`; other platforms use Segoe UI or their platform sans-serif. No font files or font CDN requests are needed.
- The header offers Light, Dark, and System modes. System is the default, follows OS appearance changes, and explicit selections persist in browser localStorage under `clusterlens.theme`. Blocked storage does not prevent switching themes.
- An external same-origin initialization script sets appearance before the application paints, compatible with the backend's self-only script CSP. Selection is also synchronized between tabs on the same origin.
- Storage explicitly states that backend disk utilization, Ceph health, and OSD telemetry are not connected. Existing capabilities are Kubernetes resource states, capacity, pod mappings, and node conditions (including reported DiskPressure), not physical disk or Ceph health.

## One connected investigation

- The core product differentiator is continuity of investigation, not a larger collection of monitoring pages. Health/rankings, events, and storage mappings are entry points into one evidence workspace.
- Preserve resource UID, namespace context, evidence tab, rolling time range, investigation trail, and pod/container selection through related-resource pivots. Give relationships meaningful labels and show where each event originated.
- Test whole journeys, not only individual panels. Required examples: workload → pod → node → workload with tab/window continuity; log selection → metrics → logs → PVC with UID/container continuity.
- Suggested checks use observed readiness/restarts/conditions/references. Shared placement or storage is association, not proof of root cause. Do not silently change signal time ranges to accommodate source limits.
- Exact pinned-time incident replay and durable evidence packages remain separate incomplete capabilities; see `docs/product/investigation-review.md`.

## Optional AI resource explanations

- User-requested early AI slice: configurable Ollama and OpenAI adapters, disabled by default, user-triggered explanations within resource details. No cluster-write tools or automatic remediation.
- Backend builds a bounded, allowlisted evidence bundle scoped to UID/window. UI previews destination/evidence and requires consent per resource/window. Findings/checks cite validated evidence IDs. Citations do not prove correctness.
- Logs and sensitive metadata are excluded from this slice. Known credential patterns are redacted from allowed free text; names remain visible. Model response and provider errors cannot expose server credentials.
- Provider/model are explicit backend configuration. OpenAI keys use environment injection or an existing Helm Secret reference; no Secret-read RBAC added. Ollama model memory is outside the platform process budget. See docs/product/ai.md.

- AI waits use elapsed time and honest pending-response language, never fabricated model stages or progress percentages. Keep evidence accessible and prior answers visible during regeneration; provide manual cancellation/retry, a 65-second browser deadline, keyboard focus restoration and reduced-motion support.

## Readable resource popup

- Resource details use one centered native dialog, up to 1080 px wide, with rounded edges and responsive viewport margins. The resource identity and tabs remain connected to the same UID/window/trail; there is no second nested AI modal.
- One main scroll surface replaces the fixed-height header plus cramped inner scroller. Header/section tabs stay reachable; relationship and time controls live within the reading surface.
- Reading sizes: 16 px content, 18 px AI summaries, 14–15 px supporting controls and metadata. Explicit pixel sizes avoid inheriting the dashboard's smaller root rem size. Keep native typography and both themes.
- Completed AI answers appear first with an At a glance summary; findings, suggested checks and technical/permission options use progressive disclosure. Focus moves to the answer on completion; consent requirements and the waiting/cancel behavior remain intact.


## Investigation continuity across tabs

- Resource details expose a native new-tab link preserving the full investigation route and no credentials. Do not auto-run AI in the destination tab.
- User-requested background explanation jobs survive browser disconnects with a 60-second provider deadline, explicit cancellation, same-resource/window deduplication, one global active inference and at most 20 process-local job records. Backend restarts lose active jobs; disk-backed job recovery remains separate work.
- Completed answers and their exact redacted evidence can be restored from bounded browser localStorage (cluster/UID/window identity, 20 entries, 1,000,000 serialized characters, 24-hour eligibility). Mark saved timestamps and snapshot semantics. Browser storage failure uses an explicitly labelled session fallback.
- Reading rhythm uses paragraph margins plus 1.9 line spacing, with visible separation between endpoint text, consent and actions.
