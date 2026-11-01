# ClusterLens repository guidance

- Read plan.md and docs/architecture/decisions.md before implementation.
- Implement one reviewable milestone at a time. M0 live acceptance precedes platform work.
- Never fabricate telemetry in production paths. Report unavailable capabilities explicitly.
- Kubernetes operations must use the explicit k3d-clusterlens context and observability-lab namespace; never infer the current context.
- Lab stress and writes must be bounded. Do not rely on local-path PVC capacity as a quota.
- Do not access Secrets or add cluster write permissions to the future discovery controller.
- Keep cleanup scoped to this lab; never prune Docker or delete unrelated Kubernetes resources.
- Product: Go backend in `backend/`, React/TypeScript in `frontend/`, Helm in `deploy/helm/clusterlens`. Run `go test -race ./backend/...`, `cd frontend && npm test && npm run build`, and `helm lint deploy/helm/clusterlens` for affected product changes. The live read-only smoke check is `python3 tests/integration/product_smoke.py`.
- Keep volatile history/on-demand logs distinct from durable retention and ingestion; do not claim full M1B before persistence and collector validation.
- Use standard-library Python for lab tooling. Run python3 -m unittest discover -s tests -v and python3 lab/scripts/lab.py validate after changes.
- Document verification commands, actual results, and resource implications. Never mark live checks passed without a running cluster.
- UI: React/TypeScript, workload-first calm mission control, keyboard access and reduced motion. No autoplay or distracting animation.

- Primary UX differentiator: one connected investigation. Preserve UID/scope/evidence tab/window/trail and pod/container selection during pivots; test workload → pod → node/PVC journeys. Do not equate graph links with root cause or silently use inconsistent signal windows. See `docs/product/investigation-review.md`.
