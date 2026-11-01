"""Deterministic Kubernetes manifests. JSON is accepted directly by kubectl."""
import json

NAMESPACE = "observability-lab"
IMAGE = "python:3.12.9-alpine3.21"
PROFILES = {
    "baseline": {"normal": 20, "logs": 5, "cpu": 3, "memory": 2, "pvc": 10},
    "stretch": {"normal": 55, "logs": 15, "cpu": 10, "memory": 10, "pvc": 10},
}
# Every process emits structured JSON and then idles when finite work finishes.
PROGRAM = '''import json, os, time
kind = os.environ["WORKLOAD_KIND"]
name = os.environ["HOSTNAME"]
def emit(message, **fields):
    print(json.dumps(dict(timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), severity="INFO", pod=name, workload=kind, message=message, **fields)), flush=True)
emit("started")
if kind == "cpu":
    end = time.monotonic() + 30
    while time.monotonic() < end:
        until = time.monotonic() + 0.01
        while time.monotonic() < until:
            pass
        time.sleep(0.09)
    emit("cpu work finished", duration_seconds=30)
elif kind == "memory":
    data = bytearray(8 * 1024 * 1024)
    time.sleep(30)
    del data
    emit("memory work finished", allocated_bytes=8388608)
elif kind == "pvc":
    # Replace the same file on every restart: no append, no growing collection.
    with open("/data/bounded.bin", "wb") as output:
        for _ in range(4):
            output.write(bytes(1024 * 1024))
        output.flush()
        os.fsync(output.fileno())
    emit("bounded write finished", bytes=4194304)
count = 0
while True:
    emit("heartbeat", sequence=count)
    count += 1
    time.sleep(2 if kind == "logs" else 60)
'''


def labels(kind):
    return {"app.kubernetes.io/part-of": "clusterlens-lab", "app.kubernetes.io/name": "lab-" + kind}


def container(kind):
    limits = {"cpu": "200m" if kind == "cpu" else "50m", "memory": "40Mi" if kind == "memory" else "24Mi", "ephemeral-storage": "32Mi"}
    result = {
        "name": kind, "image": IMAGE, "imagePullPolicy": "IfNotPresent",
        "command": ["python3", "-u", "-c", PROGRAM],
        "env": [{"name": "WORKLOAD_KIND", "value": kind}, {"name": "PYTHONDONTWRITEBYTECODE", "value": "1"}],
        "resources": {"requests": {"cpu": "5m", "memory": "12Mi", "ephemeral-storage": "4Mi"}, "limits": limits},
        "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}},
        "readinessProbe": {"exec": {"command": ["python3", "-c", "import os; os.kill(1, 0)"]}, "initialDelaySeconds": 2, "periodSeconds": 30},
    }
    if kind == "pvc":
        result["volumeMounts"] = [{"name": "data", "mountPath": "/data"}]
    return result


def workload(kind, count):
    spec = {
        "automountServiceAccountToken": False, "terminationGracePeriodSeconds": 5,
        "securityContext": {"runAsNonRoot": True, "runAsUser": 1000, "runAsGroup": 1000, "fsGroup": 1000, "seccompProfile": {"type": "RuntimeDefault"}},
        "containers": [container(kind)],
    }
    result = {
        "apiVersion": "apps/v1", "kind": "StatefulSet" if kind == "pvc" else "Deployment",
        "metadata": {"name": "lab-" + kind, "namespace": NAMESPACE, "labels": labels(kind)},
        "spec": {"replicas": count, "selector": {"matchLabels": labels(kind)}, "template": {"metadata": {"labels": labels(kind)}, "spec": spec}},
    }
    if kind == "pvc":
        result["spec"].update(serviceName="lab-pvc", podManagementPolicy="Parallel", volumeClaimTemplates=[{
            "metadata": {"name": "data", "labels": labels(kind)},
            "spec": {"accessModes": ["ReadWriteOnce"], "storageClassName": "local-path", "resources": {"requests": {"storage": "64Mi"}}},
        }])
    else:
        result["spec"]["strategy"] = {"type": "Recreate"}
    return result


def manifests(profile="baseline"):
    items = [{"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": NAMESPACE, "labels": {"app.kubernetes.io/part-of": "clusterlens-lab"}}}]
    items.append({"apiVersion": "v1", "kind": "Service", "metadata": {"name": "lab-pvc", "namespace": NAMESPACE, "labels": labels("pvc")}, "spec": {"clusterIP": "None", "selector": labels("pvc"), "ports": [{"name": "unused", "port": 8080}]}})
    items.extend(workload(kind, count) for kind, count in PROFILES[profile].items())
    return {"apiVersion": "v1", "kind": "List", "items": items}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=PROFILES, default="baseline")
    print(json.dumps(manifests(parser.parse_args().profile), indent=2))
