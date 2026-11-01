#!/usr/bin/env python3
"""ClusterLens M0 lifecycle. All Kubernetes commands use a private kubeconfig."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("workloads", ROOT / "lab/workloads/generate.py")
workloads = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workloads)
ARTIFACTS = ROOT / "artifacts"
KUBECONFIG = ARTIFACTS / "clusterlens.kubeconfig"
MARKER = ARTIFACTS / "lab-owned"
CONTEXT = "k3d-clusterlens"
NS = workloads.NAMESPACE
DOCKER_DESKTOP_BIN = Path("/Applications/Docker.app/Contents/Resources/bin")


def run(args, *, data=None, capture=False, timeout=300):
    return subprocess.run(args, input=data, text=True, check=True, capture_output=capture, timeout=timeout)


def require(*commands):
    # k3d also launches docker by name, so make it available to child processes.
    if "docker" in commands and not shutil.which("docker") and sys.platform == "darwin":
        executable = DOCKER_DESKTOP_BIN / "docker"
        if executable.is_file() and os.access(executable, os.X_OK):
            os.environ["PATH"] = str(DOCKER_DESKTOP_BIN) + os.pathsep + os.environ.get("PATH", "")
    missing = [command for command in commands if not shutil.which(command)]
    if missing:
        raise RuntimeError("Missing prerequisites: " + ", ".join(missing) + ". See README.md.")


def kube(*args, data=None, capture=False):
    require("kubectl")
    if not KUBECONFIG.exists() or not MARKER.exists():
        raise RuntimeError("No owned lab kubeconfig. Run setup first; never fall back to your current context.")
    return run(["kubectl", "--kubeconfig", str(KUBECONFIG), "--context", CONTEXT, "--request-timeout=20s", *args], data=data, capture=capture)


def apply(manifest, dry_run=False):
    flags = ["--dry-run=server"] if dry_run else []
    kube("apply", *flags, "-f", "-", data=json.dumps(manifest))


def clusters():
    return json.loads(run(["k3d", "cluster", "list", "-o", "json"], capture=True).stdout)


def setup():
    require("docker", "k3d", "kubectl")
    memory = int(run(["docker", "info", "--format", "{{.MemTotal}}"], capture=True).stdout.strip())
    if memory < 7 * 1024**3:
        raise RuntimeError("Allocate 8 GB to Docker Desktop before setup.")
    exists = any(cluster["name"] == "clusterlens" for cluster in clusters())
    if exists and not MARKER.exists():
        raise RuntimeError("A cluster named clusterlens already exists without this repo's ownership marker. Refusing to adopt it.")
    ARTIFACTS.mkdir(exist_ok=True)
    if not exists:
        # Mark intent before creation so a partial cluster can be cleaned up.
        MARKER.write_text("clusterlens\n")
        run(["k3d", "cluster", "create", "--config", str(ROOT / "lab/k3d/config.yaml")])
    config = run(["k3d", "kubeconfig", "get", "clusterlens"], capture=True).stdout
    fd = os.open(KUBECONFIG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write(config)
    os.chmod(KUBECONFIG, 0o600)
    kube("wait", "--for=condition=Ready", "nodes", "--all", "--timeout=180s")
    apply(workloads.manifests())
    verify("baseline")


def verify(profile):
    for kind in workloads.PROFILES[profile]:
        resource = "statefulset" if kind == "pvc" else "deployment"
        kube("-n", NS, "rollout", "status", resource + "/lab-" + kind, "--timeout=180s")
    pods = json.loads(kube("-n", NS, "get", "pods", "-l", "app.kubernetes.io/part-of=clusterlens-lab", "-o", "json", capture=True).stdout)["items"]
    expected = sum(workloads.PROFILES[profile].values())
    active = [pod for pod in pods if not pod["metadata"].get("deletionTimestamp")]
    if len(active) != expected or any(not any(c["type"] == "Ready" and c["status"] == "True" for c in p.get("status", {}).get("conditions", [])) for p in active):
        raise RuntimeError("Expected exactly %d ready pods; inspect status." % expected)
    claims = json.loads(kube("-n", NS, "get", "pvc", "-o", "json", capture=True).stdout)["items"]
    owned = [p for p in claims if p["metadata"].get("labels", {}).get("app.kubernetes.io/part-of") == "clusterlens-lab"]
    if len(owned) != 10 or any(p.get("status", {}).get("phase") != "Bound" for p in owned):
        raise RuntimeError("Expected 10 bound lab PVCs.")
    for i in range(10):
        kube("-n", NS, "exec", "lab-pvc-" + str(i), "--", "python3", "-c", "import os; assert os.path.getsize('/data/bounded.bin') == 4194304")
    lines = kube("-n", NS, "logs", "deployment/lab-logs", "--tail=2", capture=True).stdout.splitlines()
    if not lines or any("timestamp" not in json.loads(line) for line in lines):
        raise RuntimeError("Expected timestamped JSON logs.")
    print("PASS: %d ready pods, 10 bound PVCs with 4 MiB files, timestamped JSON logs." % expected)


def scenario_manifest(name, duration):
    pod = {"apiVersion": "v1", "kind": "Pod", "metadata": {"name": "scenario-" + name, "namespace": NS, "labels": {"app.kubernetes.io/part-of": "clusterlens-scenarios"}}, "spec": {"automountServiceAccountToken": False, "activeDeadlineSeconds": duration, "terminationGracePeriodSeconds": 1, "restartPolicy": "Always", "securityContext": {"runAsNonRoot": True, "runAsUser": 1000, "seccompProfile": {"type": "RuntimeDefault"}}, "containers": [workloads.container("normal")]}}
    pod["spec"]["containers"][0].pop("readinessProbe")
    if name == "crash":
        pod["spec"]["containers"][0]["command"] = ["python3", "-u", "-c", 'import json; print(json.dumps({"severity":"ERROR","message":"intentional lab crash"}), flush=True); raise SystemExit(1)']
    else:
        pod["spec"]["nodeSelector"] = {"clusterlens.io/scenario-unschedulable": "true"}
    return pod


def scenario(name, duration):
    pod = "scenario-" + name
    try:
        apply(scenario_manifest(name, duration))
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline:
            obj = json.loads(kube("-n", NS, "get", "pod", pod, "-o", "json", capture=True).stdout)
            status = obj.get("status", {})
            crash = any(c.get("state", {}).get("waiting", {}).get("reason") == "CrashLoopBackOff" for c in status.get("containerStatuses", []))
            unscheduled = any(c["type"] == "PodScheduled" and c.get("reason") == "Unschedulable" for c in status.get("conditions", []))
            if (name == "crash" and crash) or (name == "scheduling" and unscheduled):
                kube("-n", NS, "get", "events", "--field-selector", "involvedObject.name=" + pod, "--sort-by=.metadata.creationTimestamp")
                print("PASS: observed " + ("CrashLoopBackOff" if name == "crash" else "FailedScheduling / Unschedulable"))
                return
            time.sleep(2)
        raise RuntimeError("Scenario timed out before expected symptom; inspect image pulls and events.")
    finally:
        kube("-n", NS, "delete", "pod", pod, "--ignore-not-found", "--wait=false")


def validate():
    for profile, counts in workloads.PROFILES.items():
        manifest = workloads.manifests(profile)
        assert sum(counts.values()) == (40 if profile == "baseline" else 100)
        for item in manifest["items"]:
            assert item["metadata"]["name"]
            if "template" in item.get("spec", {}):
                pod = item["spec"]["template"]["spec"]
                assert not pod["automountServiceAccountToken"]
                for container in pod["containers"]:
                    assert container["resources"]["limits"]
                    compile(container["command"][-1], "container-program", "exec")
        print("PASS: offline generation and safety checks for " + profile)
    print("Offline checks do not replace Kubernetes API schema validation. Run validate --server after setup.")


def status():
    kube("get", "nodes", "-o", "wide")
    kube("-n", NS, "get", "pods,pvc", "-o", "wide")
    kube("top", "nodes")
    kube("-n", NS, "top", "pods")
    require("docker")
    ids = run(["docker", "ps", "--filter", "label=k3d.cluster=clusterlens", "--format", "{{.ID}}"], capture=True).stdout.split()
    if ids:
        run(["docker", "stats", "--no-stream", *ids])
    run(["docker", "info", "--format", "Docker total memory: {{.MemTotal}} bytes"])


def cleanup(scenarios_only=False):
    if scenarios_only:
        kube("-n", NS, "delete", "pods", "-l", "app.kubernetes.io/part-of=clusterlens-scenarios", "--ignore-not-found", "--wait=false")
        return
    require("k3d")
    if not MARKER.exists():
        raise RuntimeError("No ownership marker: refusing cluster deletion.")
    if any(c["name"] == "clusterlens" for c in clusters()):
        run(["k3d", "cluster", "delete", "clusterlens"])
    KUBECONFIG.unlink(missing_ok=True)
    MARKER.unlink()
    print("Deleted the owned clusterlens lab and its kubeconfig. Other clusters were not targeted.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("setup")
    check = commands.add_parser("validate")
    check.add_argument("--server", action="store_true")
    for name in ("scale", "verify"):
        sub = commands.add_parser(name)
        sub.add_argument("--profile", choices=workloads.PROFILES, default="baseline")
    fail = commands.add_parser("scenario")
    fail.add_argument("name", choices=("crash", "scheduling"))
    fail.add_argument("--seconds", type=int, choices=range(30, 301), default=180, metavar="30..300")
    commands.add_parser("status")
    clean = commands.add_parser("cleanup")
    clean.add_argument("--scenarios-only", action="store_true")
    args = parser.parse_args()
    if args.command == "setup":
        setup()
    elif args.command == "validate":
        validate()
        if args.server:
            for profile in workloads.PROFILES:
                apply(workloads.manifests(profile), dry_run=True)
            for name in ("crash", "scheduling"):
                apply(scenario_manifest(name, 180), dry_run=True)
    elif args.command == "scale":
        apply(workloads.manifests(args.profile))
        verify(args.profile)
    elif args.command == "verify":
        verify(args.profile)
    elif args.command == "scenario":
        scenario(args.name, args.seconds)
    elif args.command == "status":
        status()
    else:
        cleanup(args.scenarios_only)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, ValueError) as exc:
        print("ERROR: " + str(exc), file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("Interrupted. Run cleanup --scenarios-only if a scenario remains.", file=sys.stderr)
        sys.exit(130)
