# ClusterLens verification record

## Short-interval forecast preview — 2026-11-01

- Added 5m/15m/30m horizons with a 5m default, proportional 10m/30m/60m history gates, 30-second aggregation and shorter recent lookbacks. Short-history warnings and method/coverage labels reflect the active mode.
- All 70 frontend tests and the production build passed, including new known-trend, ten-minute eligibility, short-gap rejection and recent-lookback checks. Ten Python tests, offline lab validation and Helm lint passed. The change adds no polling, model calls, cluster writes or dependencies; calculations reuse the existing history request.

## In-memory Forecasts page — 2026-11-01

- Chrome confirmed the production Forecasts page, resource/signal selectors and horizon controls against live data. The selected coredns CPU series had about 0.1 hours of history, so the page correctly withheld a one-hour projection and explained the two-hour minimum. Live projected bands await sufficient history; model and band behavior were exercised with synthetic test data only.

- Frontend suite passed all 68 tests, including eight new model/page checks: known-trend recovery, minimum horizon coverage, stale/sparse/gapped history rejection, UID isolation/deduplication, noisy-series envelopes, nonnegative projections, route persistence, horizon interactions and offline suppression. TypeScript/Vite build passed after correcting the test mock's argument type.
- Go race suite passed (cached); Helm lint passed; ten Python tests and offline lab validation passed. Live product smoke passed against the running localhost backend: synchronized inventory, forty lab pods, UID ownership, real metrics/history, bounded logs and UI delivery.
- No model inference or cluster mutation was performed. Long-horizon model accuracy and statistical coverage are not validated by synthetic tests; the bands remain labeled heuristic. Resource cost is a selected-resource history GET per snapshot refresh and a browser-side linear fit over the available bounded points. No new dependency or backend storage was added.

## Health card and attention queue — 2026-11-01

- Frontend: 60 tests passed on rerun, including six new checks for pod ownership grouping, availability ordering, unknown states, stale/disconnected/partial node usage, expanding/searching eight issues and opening the exact UID. Existing connected-investigation journeys passed. One earlier run hit the existing AI polling test's timing failure; it passed unchanged on rerun.
- TypeScript/Vite production build passed. Go race tests passed after granting access to the Go build cache. Helm lint passed; ten Python lab tests and offline lab validation passed.
- Live smoke attempted against localhost:8080 but stopped at `/readyz` HTTP 503. Chrome confirmed the Kubernetes API on port 6550 refused the backend's connection; live cluster acceptance is not claimed.
- Chrome opened the rebuilt product overview and visually confirmed the redesigned incomplete-data card, last-observed counts, and unavailable CPU/memory values. Healthy and multi-issue states are covered by component tests; no cluster failures were injected for this change. Mobile visual inspection remains unperformed.
- Frontend-only resource impact: no new dependencies, collectors, inference, persistence, network polling or cluster writes. The attention list is computed from the existing bounded snapshot; only five rows render initially. Forecast prototypes remain separate from production functionality.

## Local checks

Run `python3 -m unittest discover -s tests -v` and `python3 lab/scripts/lab.py validate`.
Implementation verification: all 10 unit tests passed (including Docker Desktop PATH fallback); offline generation/safety checks passed for baseline and stretch. Tests exercised actual bounded PVC writes twice to confirm restart overwrite behavior, ownership refusal, private-context routing, and scenario cleanup on API failure. Kubernetes server-side validation subsequently passed, as recorded below.

## Live acceptance — baseline verified

Initial verification lacked Docker/k3d/kubectl. On the subsequent run, Docker Desktop was installed but its CLI was absent from PATH. The runner now detects the standard macOS Docker Desktop CLI directory and passes it to k3d child processes without editing shell settings. Live baseline checks below passed on the target Mac.

On the target Mac, record:

| Check | Command | Result |
|---|---|---|
| Creation and 40 ready pods | `python3 lab/scripts/lab.py setup` | Passed: 3 Ready nodes, 40 Ready pods, zero restarts at snapshot |
| API schema validation | `python3 lab/scripts/lab.py validate --server` | Passed for both profiles and both failure pods |
| 10 bound PVCs, 4 MiB each; JSON logs | `python3 lab/scripts/lab.py verify` | Passed within setup: ten bound PVCs, each file exactly 4,194,304 bytes, timestamped JSON logs |
| Baseline node/pod/Docker memory and CPU | `python3 lab/scripts/lab.py status` | Passed; startup snapshot detailed below |
| Crash symptom and events, cleanup | `python3 lab/scripts/lab.py scenario crash --seconds 60` | Passed: CrashLoopBackOff / BackOff event observed; pod deleted |
| Scheduling symptom and events, cleanup | `python3 lab/scripts/lab.py scenario scheduling --seconds 60` | Passed: FailedScheduling / Unschedulable observed; pod deleted |
| Optional 100-pod readiness/resource use | `python3 lab/scripts/lab.py scale --profile stretch` | Not run |
| Return to baseline | `python3 lab/scripts/lab.py scale --profile baseline` | Not run |
| Delete and recreate reproducibly | `python3 lab/scripts/lab.py cleanup`, then `setup` | Not run |

Also record Mac architecture, Docker/k3d/kubectl versions, Docker memory allocation and disk usage, warm/cold image pull behavior, failed pods/events, host memory pressure, and any changes needed. Do not proceed to platform resource selection until baseline measurements are available.

## Baseline startup snapshot

- Platform: darwin/arm64, k3d v5.9.0, kubectl v1.37.2, pinned server K3s v1.31.5+k3s1. The installed kubectl is outside the recommended matching minor range; these observed successful commands do not establish supported version compatibility. Use matching kubectl as described in README for reproducible acceptance.
- Docker engine memory: 8,319,504,384 bytes.
- Metrics Server node readings: agent-0 83m CPU / 387 MiB, agent-1 65m / 370 MiB, server 125m / 820 MiB. These report a common Docker VM capacity, not dedicated per-node capacity.
- Docker snapshot: agents 393.6 / 370.8 MiB, server 831.5 MiB, tools 5.32 MiB (about 1.56 GiB combined). This excludes other Docker Desktop/host overhead.
- Sample is shortly after startup with finite stress workers completing; it is not a sustained baseline, host memory-pressure observation, or platform budget measurement. Optional stretch and destructive recreation checks remain outstanding.

## First live product slice — verified

Executed on the target Mac after M0 baseline acceptance:

- Installed Go; built the Go backend and React/TypeScript UI. Locked npm and Go dependency manifests are included.
- `go test -race ./backend/...`: passed. Nine top-level backend tests cover ownership/metrics correlation, selectorless Services, informer create/update/delete, watch close and simulated HTTP-410 recovery, history count/age bounds, read-only API validation, pod-name replacement protection, environment-field exclusion, tombstone bounds, and metrics failure/recovery. API tests include table-driven subcases.
- `cd frontend && npm test`: six presentation/correlation tests passed. `npm run build`: TypeScript and Vite production build passed. Production JS is approximately 278 kB (84 kB gzip); CSS approximately 35 kB (8 kB gzip).
- `python3 -m unittest discover -s tests -v`: all ten existing lab tests passed.
- Helm lint, Helm rendering, and Kubernetes server-side dry-run of the chart passed.
- The multi-stage Docker image built successfully using Node 22, Go 1.24, and a nonroot distroless runtime. Imported `clusterlens:dev` into the local k3d cluster.
- Installed Helm release `clusterlens`, revision 1, namespace `observability-lab`; Deployment became ready. Service is ClusterIP only. The user-facing preview is a loopback-only port forward at http://127.0.0.1:8080.
- `python3 tests/integration/product_smoke.py`: passed against both the host binary and Helm-deployed service. Validated health/readiness, all 14 synchronized informer sources, 40 baseline lab pods, UID ownership, ten workload/PVC links, current metrics, nonduplicate real history samples, bounded timestamped JSON logs, invalid-query/identity guards, rejected writes/cross-origin requests, and built UI delivery.
- Service-account checks: listing pods and reading pod logs allowed; reading Secrets, creating pods, and creating pod exec sessions denied. The deployed app performs no Kubernetes writes.
- Kubernetes Metrics Server snapshot for the deployed product pod: **4m CPU, 19 MiB memory**. This is one early sample, not a sustained-load or 24-hour retention benchmark. It excludes browser/port-forward overhead and does not establish the 0.5-core average or 1 GB steady-state budget.
- Chrome visual inspection confirmed the live overview with five workloads, 40 pods, three-node topology, real CPU/memory charts, and event cards. The Storage page also rendered with ten bound claims and ten bound volumes. The browser integration host was unavailable; native Chrome inspection worked, but later automated interactions were interrupted by concurrent user activity/timeouts. Mobile layout, reduced-motion behavior, command-palette focus, and all drawer/log interactions are implemented but not comprehensively browser-verified. Do not treat the pure TypeScript tests as browser interaction tests.

### Explicit product boundaries

This is a functioning first product slice, not completion of every M1 requirement. History (60,000 points / 24-hour ceiling) and deleted identity (500 resources / 24-hour ceiling) are volatile and count-bounded. Logs are on-demand pod API queries; events remain Kubernetes-retained and response-limited to the latest 200 cluster events. Durable retention, established node log ingestion, redaction/drop counters for an ingestion pipeline, CPU throttling, filesystem usage, Ceph and authentication are not implemented. Optional user-triggered AI resource explanations were subsequently added; see the AI verification entry below. No synthetic production telemetry is used. See `docs/product/README.md` for interfaces and follow-up work.

## Management-friendly UI redesign

- Replaced the dense overview with a cluster health verdict, top-five workload contribution ranking, interactive trend, and compact storage summary. All namespaces is the default for new sessions; health remains cluster-wide under namespace filtering.
- Rebuilt storage presentation as rounded PVC-to-workload/pod mapping cards with usage filters. Active pod references establish In use; absent references establish Unattached only when discovery is complete. Older unattached claims receive a review suggestion, not a definitive stale or delete recommendation. No CSI mount or last-use measurement is fabricated.
- Added locally served Inter variable font, larger text, rounded surfaces/controls, reduced visual clutter, and navigation scroll reset while preserving resource-drawer context.
- Frontend production build passed. All 24 tests passed, including 14 new insight/classification tests and four DOM interaction tests for real-value hover, keyboard inspection, unique gradients, and insufficient history.
- Chrome inspection confirmed the new live overview, measured CPU ranking, interactive chart tooltip/keyboard values, all ten PVC-to-pod mappings, and the zero-unattached empty filter state.
- Backend/API contracts are unchanged. Existing backend tests are not repeated for this frontend-only revision. The redesigned image built successfully and was deployed as Helm revision 2 using image `clusterlens:ui-redesign-1`. The localhost port forward was reconnected to the replacement pod.

- Post-upgrade `python3 tests/integration/product_smoke.py` passed against the redesigned Helm service on localhost:8080, verifying real cluster inventory/ownership, metrics/history, bounded logs, API guards, and UI delivery.

## Native typography and appearance modes

- Removed the bundled Inter dependency; the product now uses native system UI fonts, with macOS system typography on a Mac and platform fallbacks elsewhere.
- Implemented Light, Dark, and System controls in the top-right header. Preferences persist under `clusterlens.theme`, synchronize between same-origin tabs, follow OS changes in System mode, and still work when localStorage is blocked. A same-origin script initializes the theme before paint without requiring inline-script CSP exceptions.
- All 30 frontend tests passed, including six appearance tests covering persisted preference restoration, switching, selected-state accessibility, system changes, blocked storage, cross-tab synchronization, and listener cleanup. Production TypeScript/Vite build passed.
- Chrome inspection verified native typography, the light Storage palette, readable PVC mappings, and the light resource drawer with CPU/memory charts. Broader mobile/theme interaction QA remains outside these checks; automated DOM tests are not a full visual regression suite.
- The Storage page now explicitly states that disk utilization, Ceph health, and OSD status are not connected. No Ceph or physical-drive telemetry integration was added. Kubernetes DiskPressure conditions and PVC/PV inventory/mappings remain the actual supported signals.
- Deployed image `clusterlens:appearance-1` as Helm revision 3 and reconnected the loopback port forward. The live product smoke test passed after the upgrade. Additional HTTP checks confirmed the delivered HTML references `/theme-init.js`, the bootstrap contains persisted/system appearance initialization, the deployed CSS contains the native font stack and light palette, and the self-only script CSP remains present.

## Connected investigation review and continuity fixes

- Reviewed health/workload → pod → node/PVC → metrics/log/events flows. Found context loss from remounted detail drawers, non-URL time ranges, flat unlabeled relationships, reset log selections, and a silent 24h-versus-6h log-window mismatch. See `docs/product/investigation-review.md`.
- Added a persistent investigation workspace with a named trail, related-resource pivot from any tab, shared URL-addressable evidence/window state, scope-aware pod/container selection, grouped relationship meanings, deterministic suggested checks, and explicit event provenance. History values/errors are keyed to resource/window to avoid carrying another subject's state into a new resource.
- Browser inspection on a fresh Chrome preview tab confirmed entering from a real workload ranking, keeping Metrics selected through a pod pivot, displaying the named root/pod trail with actual pod metrics, and returning to the workload without resetting Metrics or the lookback. A pre-existing dev tab required a fresh page after the app-entry refactor; fresh preview entry and production builds passed.
- Time remains a rolling lookback. Exact absolute-window incident replay, durable evidence, saved evidence packages, and storage-backend telemetry remain incomplete and are not claimed by this navigation work.
- Final frontend verification: all 42 tests passed across six files, including four complete App-level journey tests and eight navigation/scope helper tests. Production TypeScript/Vite build and container build passed. The App-level regression suite also verifies that a previous resource's history failure is not shown for the next resource.
- Packaged the final UI as `clusterlens:investigation-1`, imported it into the local lab, and deployed Helm revision 4 with existing release settings preserved. Reconnected the loopback preview to the replacement pod. No backend contracts, data collectors, or Kubernetes write permissions were added by this frontend continuity change.
- Post-deployment live smoke passed against localhost:8080: synchronized discovery, UID ownership, forty lab pods, ten volume relationships, real metrics/history, bounded logs, API guards, and built UI delivery remain working.

## Optional AI explanations — 2026-11-01

- Go race suite passed with provider contract tests for OpenAI Responses and Ollama, evidence identity/window/size limits, credential-pattern redaction, unknown-citation rejection, invalid/incomplete/oversized/provider-error handling, consent, origin protection, request body limits and concurrency rejection.
- Frontend: 46 tests passed, including four AI tests covering disabled state, evidence preview/consent/citation navigation, provider errors and cancellation when unmounting. TypeScript and production build passed. Existing investigation journey tests passed.
- Helm lint and template rendering passed for disabled defaults and an OpenAI configuration using an existing Secret reference. No API key was put in chart values, browser code or generated manifests. The new chart/image was not installed into the cluster during this increment.
- Live baseline product smoke passed against the rebuilt host backend: 14 discovery sources, 40 lab pods, 3 nodes, 10 PVC mappings, actual metrics/history, bounded structured pod logs and built UI.
- Live AI: used the already-installed `qwen3.5:9b` through host Ollama with `OLLAMA_NO_CLOUD=1`, no model download or external API call. Final resource-scoped explanation completed in 30.9 seconds with 15 evidence entries, five findings and validated evidence references. An earlier model response failing citation limits was rejected; constrained JSON schemas were added and retested.
- An earlier inference measured 8.62 GiB peak / 7.40 GiB held in Ollama's model-runner log. This is model inference memory, outside the platform target; it is substantial on the 16 GB development host. `keep_alive=0` unloads the runner after a request. These observations do not establish the overall steady-state platform CPU/memory budget.
- Active preview is the rebuilt **host** backend at http://127.0.0.1:8080, configured for local Ollama. The previous service port forward was stopped to free that port. The previously deployed Helm pod remains on its previous image and does not yet include AI.
- Not completed: a real paid OpenAI request (no key supplied), deployed-pod-to-Ollama networking, visual browser inspection (computer-use browser host unavailable), model-quality benchmarking, prompt-injection robustness evaluation, AI log analysis, durable evidence storage or authentication. Citation validation checks references, not the truth of model interpretations.

## AI waiting experience — 2026-11-01

- Frontend suite: 50 tests passed; TypeScript/production build passed. New checks cover elapsed-time copy at 21/45 seconds, provider-specific messages, interval cleanup, absence of simulated percentage progress, focus placement, cancel/previous-answer preservation and client-deadline recovery with late-response rejection.
- Rebuilt assets are served by the existing localhost:8080 host backend; verified HTTP 200 for the index, new JS/CSS bundles, health and AI status. No backend or Helm change and no additional live model request were needed.
- Native Chrome accessibility was reachable, but after refreshing the page its content and screenshot could not be captured reliably. Visual inspection of the new waiting card remains unconfirmed; automated component and connected-investigation tests passed. Reduced-motion behavior is implemented through an explicit media query; no OS preference was changed.

## Resource popup readability — 2026-11-01

- Frontend: 51 tests passed, including connected workload/pod/node/PVC journeys and a new answer-first disclosure/focus check. TypeScript and production build passed.
- Verified HTTP 200 for the rebuilt JS/CSS assets from the existing localhost:8080 host backend. No backend/Helm change and no additional AI inference were required.
- Resource dialog now uses a centered responsive layout, a single main scroll area, larger typography, sticky close/header and tabs, and answer-first AI content. Reduced-motion and light/dark tokens remain supported.
- Native Chrome accessibility showed the user's existing pre-refresh resource view. It was left intact to preserve the currently displayed AI answer; visual validation of the new layout at desktop/mobile/zoom sizes remains unconfirmed. Component and navigation tests do not establish pixel layout or contrast compliance.

## Spacing, new tabs and AI continuity — 2026-11-01

- Go race suite passed, including new real-loopback mock-provider tests proving a job survives initiating-request cancellation, same-resource starts deduplicate to one provider call, a fresh client can recover completion, explicit cancellation releases the provider slot, and retention remains bounded.
- Frontend: 54 tests passed; TypeScript and production build passed. Coverage includes route-equivalent safe new-tab URLs, browser answer restoration when the backend is offline, reattachment to an accepted background job, no second inference on reattachment, explicit cancellation with previous-answer preservation, polling completion, scoped cache identity/expiry/bounds, blocked storage fallback and existing connected navigation journeys.
- Helm lint passed (chart unchanged). Existing live product smoke passed for all inventory sources, 40 baseline pods, UID/PVC ownership, real metrics/history, bounded logs, API guards and UI.
- Live local Ollama job accepted with HTTP 202, original connection closed, duplicate start attached to the same ID, and a fresh-client lookup recovered its completed explanation after 24.2 seconds. Result/evidence recorded in ignored artifacts/ai-background-check.json. No external model/key was used.
- Local backend rebuilt/restarted with existing Ollama configuration at localhost:8080. Browser storage persists completed answers; background jobs remain bounded RAM state and are lost on backend restart. No durable queue, multi-user access controls or paid OpenAI validation is claimed.
- Spacing/new-tab styling is covered by source/build checks; native browser visual/mobile layout confirmation remains outstanding. Prior verification notes describing cancellation on unmount and a 65-second browser inference deadline describe the earlier synchronous version and are superseded by this entry.
