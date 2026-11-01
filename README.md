# ClusterLens

A self-hosted, Kubernetes-first observability platform. **The first live product slice is implemented:** Go informer discovery, real CPU/memory, Kubernetes events, bounded on-demand logs, resource correlation, and a React/TypeScript dashboard.

## License

ClusterLens is available under the [MIT License](LICENSE).

## Local setup (macOS)

Run the Kubernetes lab in Docker and the latest ClusterLens UI/backend directly on your Mac. Use separate terminals for Ollama and ClusterLens. In addition to the lab prerequisites below, install Go 1.24+, Node 22+ with npm, and optionally Ollama for local AI.

### 1. Start Docker and the lab

```sh
cd ~/Documents/coding-projects/clusterLens
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
open -a Docker
```

Wait for Docker Desktop to finish starting, then confirm the engine is ready:

```sh
docker info
```

For an existing lab, start its nodes first:

```sh
k3d cluster start clusterlens --wait --timeout 180s
```

For a first-time setup with no `clusterlens` cluster, skip the start command. The setup runner creates it. In either case, run:

```sh
python3 lab/scripts/lab.py setup
python3 lab/scripts/lab.py status
```

`setup` refreshes the private kubeconfig, restores the **40-pod baseline**, and verifies readiness, bounded PVC writes and structured logs. It does not change your default Kubernetes context. Keep `artifacts/lab-owned` and `artifacts/clusterlens.kubeconfig` for subsequent runs.

### 2. Start Ollama (optional, separate terminal)

For local AI explanations:

```sh
OLLAMA_NO_CLOUD=1 OLLAMA_NOPRUNE=1 ollama serve
```

Leave this terminal running. If Ollama is already running, use that instance; the cloud-disabled flags apply when starting a new server. Check installed models from another terminal:

```sh
ollama list
```

The command below uses `qwen3.5:9b`, already installed on this development host. Substitute your own installed model if needed. Model inference memory is additional to Docker and ClusterLens; this 9B model has measured substantial memory use on the 16 GB host. See [AI setup and limits](docs/product/ai.md).

### 3. Build and start ClusterLens (separate terminal)

```sh
cd ~/Documents/coding-projects/clusterLens
make build
```

With local Ollama AI enabled:

```sh
CLUSTERLENS_AI_PROVIDER=ollama \
CLUSTERLENS_AI_MODEL=qwen3.5:9b \
CLUSTERLENS_OLLAMA_URL=http://127.0.0.1:11434 \
./artifacts/clusterlens
```

Or run without AI:

```sh
CLUSTERLENS_AI_PROVIDER=disabled ./artifacts/clusterlens
```

Open **[http://127.0.0.1:8080](http://127.0.0.1:8080)**. The binary serves both the built UI and backend using the private lab kubeconfig and explicit `k3d-clusterlens` context. No separate frontend server, Helm installation or port-forward is needed for this host setup. The UI includes Overview, Workloads, Nodes, Storage, Logs, Events, connected resource details, namespace/time filters and Cmd/Ctrl-K search.

On later starts, skip `make build` unless the source changed. If port 8080 is occupied, stop your earlier backend/port-forward, or append `--listen=127.0.0.1:8081` to the binary command and open port 8081 instead.

### 4. Verify the setup

From the repository root in another terminal:

```sh
python3 tests/integration/product_smoke.py
```

If using port 8081:

```sh
python3 tests/integration/product_smoke.py --url http://127.0.0.1:8081
```

The smoke check requires the baseline lab and a ready backend; it checks live inventory, metrics/history, PVC relationships, structured logs and built UI. It does not initiate AI inference.

### 5. Stop without deleting lab data

Press **Ctrl-C** in the ClusterLens and Ollama terminals you started, then:

```sh
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
k3d cluster stop clusterlens
```

Stopping preserves lab volumes. `python3 lab/scripts/lab.py cleanup` deletes the cluster and its PVC data; use it only when you intend to remove the lab. Backend shutdown also interrupts active AI jobs; completed answers already saved in the browser remain available within their restore window.

See [product setup, Helm deployment, API and current limits](docs/product/README.md) for deployment inside Kubernetes. Metrics history is bounded and volatile; logs are queried directly from Kubernetes. Durable storage and node log collection remain the next telemetry milestone.

## Prerequisites

- macOS with 16 GB RAM; running Docker Desktop with **8 GB memory allocated**, and several GB of free Docker disk space for node/container images.
- Python 3.9+, k3d 5.8.x, and kubectl 1.31.x for the pinned K3s 1.31.5 lab. The pinned versions form a reproducibility baseline for a disposable local lab, not a production deployment recommendation.
- Install Docker Desktop from its official distribution. With Homebrew available, install k3d and Python using `brew install k3d python`. Install the matching kubectl using the [official Kubernetes instructions](https://kubernetes.io/docs/tasks/tools/install-kubectl-macos/) and select the v1.31.5 binary for your Mac architecture.
- Helm and Go are not required for the lab alone. Internet access is needed for initial image pulls. Port 6550 must be free.

On macOS the lab runner automatically detects Docker Desktop's CLI in `/Applications/Docker.app/Contents/Resources/bin` if `docker` is absent from PATH, including for k3d child processes. Docker Desktop must still be running. This does not modify your shell configuration.

The [k3d configuration](https://k3d.io/v5.8.3/usage/configfile/) creates one server and two agents, keeps the API on loopback, disables Traefik and ServiceLB, and retains local-path provisioning and Metrics Server. All nodes share Docker Desktop's memory; they are not separate 8 GB machines.

## Run the lab

Run commands from the repository root:

```sh
python3 -m unittest discover -s tests -v
python3 lab/scripts/lab.py validate
python3 lab/scripts/lab.py setup
python3 lab/scripts/lab.py validate --server
python3 lab/scripts/lab.py verify --profile baseline
python3 lab/scripts/lab.py status
```

`setup` refuses to adopt an existing unowned `clusterlens` cluster, creates an ignored `artifacts/clusterlens.kubeconfig` with mode 0600, waits for nodes, applies the baseline, and verifies readiness, PVC writes, and JSON logs. It can be rerun for its owned cluster; rerunning restores baseline replica counts. It never changes your default kubeconfig or current context. Setup failure leaves the owned cluster for inspection or explicit cleanup.

`validate` performs offline manifest invariants and Python syntax checks, **not Kubernetes schema validation**. `validate --server` asks the live Kubernetes API to dry-run both workload profiles and both scenarios. The baseline namespace must already exist.

For manual inspection, always specify the private config and context:

```sh
kubectl --kubeconfig artifacts/clusterlens.kubeconfig --context k3d-clusterlens -n observability-lab logs deployment/lab-logs --tail=10
kubectl --kubeconfig artifacts/clusterlens.kubeconfig --context k3d-clusterlens -n observability-lab get events --sort-by=.metadata.creationTimestamp
```

## Workload budget

| Profile | Normal | Logs | CPU | Memory | PVC | Total |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 20 | 5 | 3 | 2 | 10 | 40 |
| stretch | 55 | 15 | 10 | 10 | 10 | 100 |

Every container requests 5m CPU and 12 MiB memory. Baseline requests total 200m CPU and 480 MiB memory; memory limits total 992 MiB. Stretch requests total 500m CPU and 1200 MiB memory; memory limits total 2560 MiB. These figures exclude Kubernetes, probes, images, filesystem caches, and Docker overhead. Limits are not observed use. The future ClusterLens platform targets a separate 1 GB steady-state memory and 0.5-core average budget within the same shared allocation.

- CPU workers run approximately 10% duty-cycle work for 30 seconds, limited to 200m each, then idle. Memory workers allocate 8 MiB for 30 seconds then release it (40 MiB container limit). These run once per container start, including restarts; they are not continuous stress loops.
- Other containers have 50m CPU / 24 MiB memory limits. Python/readiness probe overhead must be measured during live validation; adjust only from recorded evidence.
- Log producers emit one short JSON record every two seconds; other workloads emit one per minute. Kubelet stdout rotation is configured at 1 MiB per file and two files per container (a rotation target, not an instantaneous hard quota). Verify Docker disk growth during long runs; M0 does not implement telemetry retention or log-spike tests.
- Ten StatefulSet replicas each write exactly 4 MiB to one local-path PVC. Restarts overwrite that same file. Total payload is 40 MiB; requested capacity is 640 MiB. Local-path capacity is **not a filesystem quota**. These are synthetic files, not application storage guarantees.
- The headless PVC service exists for StatefulSet identity and has no serving application endpoint. There are no exposed application ports or privileged workload containers.

## Scale deliberately

After baseline validation, check `status` for node/pod usage and Docker node-container memory. Docker node stats do not account for every Docker Desktop overhead; also inspect Docker Desktop's dashboard and host memory pressure. Capture baseline and stretch results in `docs/verification.md`.

```sh
python3 lab/scripts/lab.py scale --profile stretch
python3 lab/scripts/lab.py status
python3 lab/scripts/lab.py scale --profile baseline
```

100 pods is optional. Stop the scale-up if memory pressure, evictions, scheduling failures, or poor host responsiveness appear. Scaling changes controller replica counts; PVC count remains ten. `status` fails explicitly if Metrics Server is unavailable; inspect node conditions/events rather than assuming zero usage.

## Opt-in failure scenarios

```sh
python3 lab/scripts/lab.py scenario crash --seconds 180
python3 lab/scripts/lab.py scenario scheduling --seconds 180
python3 lab/scripts/lab.py cleanup --scenarios-only
```

The crash pod intentionally exits with code 1. The scheduling pod requires an absent `clusterlens.io/scenario-unschedulable=true` node label; do not add that label to lab nodes. The runner polls for CrashLoopBackOff or Unschedulable and prints related events, then deletes the pod in a `finally` block. Image pull delays can cause a timeout. Each pod also has an active deadline, though an unscheduled pod's deadline is not a substitute for explicit deletion. If the runner is killed or the API is unreachable, run scenario cleanup after recovery. Failure pods are excluded from baseline counts.

## Cleanup

```sh
python3 lab/scripts/lab.py cleanup
```

Deletes only the named `clusterlens` cluster when this repository has its ownership marker, and removes the private kubeconfig/marker after successful deletion. This destroys the lab PVC data. It does not run Docker prune, delete other clusters, or edit your default kubeconfig. Downloaded images may remain cached. Keep the ignored ownership marker while the lab exists; a manually replaced cluster with the same name cannot be distinguished from the original, so do not replace/adopt that name outside this tooling.

## Next milestones

See [plan.md](plan.md) and [architecture decisions](docs/architecture/decisions.md). M1A discovery and the first live React dashboard are implemented. Durable telemetry/storage selection follows measurements; see the product guide for the current volatile-history and on-demand-log boundaries.

## Optional AI explanations

Resource details support user-triggered, evidence-cited explanations through Ollama or OpenAI. Disabled by default; credentials stay on the backend. See [provider setup and limits](docs/product/ai.md).
