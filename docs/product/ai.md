# Optional AI explanations

Open a resource's details, select **Review evidence for AI**, inspect the bundle and destination, then select the consent checkbox and **Explain this resource**. Explanations contain a summary, findings and suggested read-only checks. Each finding/check cites evidence IDs; click a citation to inspect its actual data and follow its resource without losing investigation context. The feature is disabled unless a backend provider and model are configured. There is no API key field in the browser.

## Ollama on the host

Use an already installed model (`ollama list`) or pull a model suitable for your hardware. Model memory is **additional** to ClusterLens and Docker's allocation; the platform's 1 GB target does not cover LLM inference. Avoid running a large model and an 8 GB Docker VM under memory pressure.

```sh
# Terminal 1. Disable Ollama cloud features for an in-house-only deployment.
OLLAMA_NO_CLOUD=1 OLLAMA_NOPRUNE=1 ollama serve

# Terminal 2. Build after source changes, then start the host backend.
make build
CLUSTERLENS_AI_PROVIDER=ollama \
CLUSTERLENS_AI_MODEL=qwen3.5:9b \
CLUSTERLENS_OLLAMA_URL=http://127.0.0.1:11434 \
./artifacts/clusterlens
```

`qwen3.5:9b` is the model already installed on this development host, not a required model. Replace it with your own installed model that supports JSON-schema responses and disabling thinking. Stop a port forward or another backend using port 8080 first, or add `--listen=127.0.0.1:8081`. Open the corresponding localhost URL. Ctrl-C stops each process.

Ollama receives `/api/chat` with streaming disabled, a constrained JSON schema, thinking disabled, a 16,384-token context, an 1,800-token generation cap and `keep_alive=0` to unload after a request. Reachability is from the **backend**: a pod's localhost does not refer to the Mac. Use an internal Ollama Service, or an explicitly reachable host endpoint for lab use. The chart's `host.k3d.internal` URL requires the host server to listen on an interface reachable from Docker; do not expose an unauthenticated Ollama server publicly. A remote Ollama endpoint or cloud-enabled Ollama is not automatically private merely because it uses the Ollama protocol.

## OpenAI

Set `CLUSTERLENS_AI_PROVIDER=openai`, `CLUSTERLENS_AI_MODEL` to a Responses API model available to your account and `OPENAI_API_KEY` in the backend environment, then run the same binary. Obtain the key through your normal secret management; never commit it, paste it in chat, place it in a URL, or put it in frontend configuration. An explicit model is required; the app does not silently choose a paid model. API access and billing are separate from a Codex/ChatGPT subscription login.

The adapter uses the [OpenAI Responses API](https://developers.openai.com/api/docs/guides/text), [structured output](https://developers.openai.com/api/docs/guides/structured-outputs), a 2,200-token output cap, no tools and `store:false`. This disables application-state storage of the response; it is not a promise of zero provider retention. Inspect your provider's data controls before enabling external transmission. Hosted requests are only made after the per-request UI consent.

## Helm

The default chart sets `ai.provider=disabled`. Configure `ai.provider`, `ai.model`, and `ai.ollamaUrl` for an internally reachable Ollama endpoint. For OpenAI, set `ai.provider=openai`, `ai.model`, and `ai.existingSecret` to a pre-provisioned Kubernetes Secret in the release namespace; its `OPENAI_API_KEY` entry (or `ai.apiKeySecretKey`) is injected with `secretKeyRef`. The chart never renders API key values and does not grant the service account permission to read Secrets through the Kubernetes API. Rebuild/import a new image tag before upgrading; the previously deployed image does not contain this feature.

## Evidence, bounds and limitations

- Backend-generated allowlist: current resource identity/status, cumulative restart counts, container requests/limits, current usage with timestamps, up to 20 related resources, 20 recent related events, 30 sampled metric points in the selected window, and collection coverage. History is volatile; inventory is current, not a reconstruction of the selected past window.
- Logs, labels, annotations, images, environment values, Kubernetes Secrets and raw source errors are excluded. Event/condition/name text is bounded and known credential patterns, URLs, JWTs and private-key blocks are redacted. This is best effort, not comprehensive data-loss prevention or name anonymization. Review the preview before sending externally.
- Preview is local; it makes no model call. Evidence is regenerated when requesting the explanation, and the exact final bundle is returned alongside it. Completed answers and their evidence are saved in bounded browser storage for reopening; the backend also keeps bounded, process-local investigation jobs. See Reopening investigations below.
- Maximum 10 KB evidence (additional related resources/events are omitted when necessary), 2 KB request body, 64 KB provider response, one active AI request, five seconds between requests, 60-second provider deadline. Oversized evidence, invalid output, unknown citation IDs, rate limits, incomplete generation, and outages produce explicit errors. No automatic paid retries or provider fallback.
- Request endpoint/model/key are server-owned, never supplied by the browser. Redirects are refused. Cross-origin requests are rejected. AI has no tools, cluster-write API or execution path. Output renders as text rather than HTML/Markdown.
- Citations establish which evidence was referenced, **not** that a model's interpretation is correct. Prompt injection in event text remains a model reliability risk; verify every claim and proposed check. There is no automated root-cause determination or remediation.
- This remains a local, unauthenticated application. Authentication, tenant isolation, durable retention, chat, AI log analysis and Ceph health are separate work.

## API

| Route | Purpose |
|---|---|
| `GET /api/v1/ai/status` | Enabled flag and non-secret provider/model/destination |
| `GET /api/v1/ai/evidence?uid=...&range=900` | Local evidence preview; range 60–86400 seconds |
| `POST /api/v1/ai/explain` | Legacy synchronous endpoint (browser uses background jobs); JSON `{ "uid": "...", "range": 900, "consent": true }`, `Content-Type: application/json`, `X-ClusterLens-AI: 1` |

Tests use mock HTTP providers for both protocols and failure modes, plus UI tests for disabled state, consent, citations, errors and cancellation. These do not establish model quality or actual OpenAI account access.

## Waiting experience

Explanation requests show a compact waiting card with elapsed time, model/provider identity and a gentle animated connection. The copy acknowledges longer waits after 20 and 45 seconds; these are elapsed-time messages, not inferred model stages or completion estimates. The evidence preview is available in a disclosure panel while the answer is pending. Raw JSON and consent controls collapse during the request. Overview/Metrics/Logs/Events remain usable for the same resource/window; leaving the resource or closing the tab stops browser polling, while an accepted investigation continues on the backend.

A previous explanation remains visible during regeneration. Cancel explicitly stops the backend job and preserves the previous answer. The model request retains its 60-second backend deadline. Reopening attaches to the existing job instead of starting another model call; late responses from a previous view cannot replace the current investigation. No automatic retries or extra model calls are introduced. The timer is excluded from live announcements, status messages use polite announcements, and reduced-motion preferences disable decorative animation.

Completed answers now appear at the top of the resource popup: an 18 px **At a glance** summary, expandable findings/checks and inspectable citations. Evidence preview, consent and regeneration remain under **Evidence and explanation options**. Resource details use a wider centered popup with one main scroll surface and larger supporting text. No second popup or additional inference is needed to read an answer.


## Reopening investigations and new tabs

The resource popup has **Open in new tab**. It uses the same origin and preserves namespace/view, resource UID, evidence tab, rolling time window, trail and pod/container selection. It never includes credentials or model output in the URL. The new tab retrieves an existing job or browser-saved answer; opening it does not initiate inference.

The browser starts jobs with `POST /api/v1/ai/jobs`, receiving HTTP 202 and an opaque job ID. It polls the job every two seconds. Closing details, navigating away or closing the browser tab stops polling, **not** the accepted job. Reopen the same resource/time window to recover progress or the completed answer. Explicit **Cancel request** sends a DELETE and cancels the provider context. Concurrent starts for the same resource/window attach to the running job; the one-active-request limit still applies globally.

| Route | Purpose |
|---|---|
| `POST /api/v1/ai/jobs` | Same bounded JSON consent payload and custom header as the legacy explanation endpoint; starts or attaches to a job |
| `GET /api/v1/ai/jobs?uid=...&range=900` | Latest job for this backend's cluster/resource/window, without inference |
| `GET /api/v1/ai/jobs/{id}` | Job state, evidence, and result/error when available |
| `DELETE /api/v1/ai/jobs/{id}` | Explicit cancellation; requires `X-ClusterLens-AI: 1` |

Completed answers are saved under `clusterlens.ai.investigations.v1` in this origin's browser localStorage, scoped by cluster ID + resource UID + window. Keep up to 20 latest scoped answers and at most 1,000,000 serialized characters. Restore eligibility expires after 24 hours; expired entries are discarded on the next save rather than physically erased on a timer. Browser storage contains the selected redacted evidence and model response, not credentials. Clearing this site's browser data removes its local copies. When browser writes are blocked, the UI identifies the session-only fallback; it cannot promise survival after closing the browser.

The backend retains at most 20 jobs, with 24-hour lookup eligibility and lazy expiry/eviction on new starts. These jobs are in RAM: **restarting ClusterLens loses active jobs and its server-side result cache**. Answers already saved in the browser remain available after a restart. Closing the tab before completion and then restarting the backend before reopening can lose that result; there is no disk-backed job queue in this increment. The app remains local and unauthenticated; the cache is not a multi-user private archive.

Saved answers show their original full timestamp and are labelled snapshots, not live diagnoses. Viewing/reopening them never sends evidence to a provider. A new explanation still requires evidence review and explicit consent. Reading spacing now includes paragraph margins and larger separation between provider details, consent and action buttons.
