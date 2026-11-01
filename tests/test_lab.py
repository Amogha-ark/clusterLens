import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("lab", ROOT / "lab/scripts/lab.py")
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)


class LabSafetyTests(unittest.TestCase):
    def test_docker_desktop_fallback_reaches_child_processes(self):
        with tempfile.TemporaryDirectory() as folder:
            docker = Path(folder) / "docker"
            docker.write_text("#!/bin/sh\nexit 0\n")
            docker.chmod(0o755)
            with patch.object(lab.sys, "platform", "darwin"), patch.object(lab, "DOCKER_DESKTOP_BIN", Path(folder)), patch.dict(os.environ, {"PATH": "/nonexistent"}):
                lab.require("docker")
                self.assertEqual(os.environ["PATH"].split(os.pathsep)[0], folder)
                result = subprocess.run(["docker"], check=True)
                self.assertEqual(result.returncode, 0)

    def test_profiles_and_persistent_writers(self):
        for profile, expected in (("baseline", 40), ("stretch", 100)):
            objects = lab.workloads.manifests(profile)["items"]
            controllers = [o for o in objects if o["kind"] in ("Deployment", "StatefulSet")]
            self.assertEqual(sum(o["spec"]["replicas"] for o in controllers), expected)
            writer = next(o for o in controllers if o["kind"] == "StatefulSet")
            self.assertEqual(writer["spec"]["replicas"], 10)
            self.assertEqual(writer["spec"]["volumeClaimTemplates"][0]["spec"]["storageClassName"], "local-path")
            for obj in controllers:
                pod = obj["spec"]["template"]["spec"]
                self.assertFalse(pod["automountServiceAccountToken"])
                self.assertTrue(pod["securityContext"]["runAsNonRoot"])
                self.assertIn("memory", pod["containers"][0]["resources"]["limits"])

    def test_writer_restarts_overwrite_four_mib(self):
        # Exercise the actual embedded container program, ending at idle sleep.
        program = lab.workloads.PROGRAM.replace('"/data/bounded.bin"', 'target')
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "bounded.bin"
            with patch.dict("os.environ", {"WORKLOAD_KIND": "pvc", "HOSTNAME": "test"}), patch("time.sleep", side_effect=InterruptedError), patch("builtins.print"):
                for _ in range(2):
                    with self.assertRaises(InterruptedError):
                        exec(program, {"target": str(target)})
                    self.assertEqual(target.stat().st_size, 4 * 1024 * 1024)

    def test_failure_deadlines_and_isolation(self):
        for name in ("crash", "scheduling"):
            pod = lab.scenario_manifest(name, 60)
            self.assertEqual(pod["spec"]["activeDeadlineSeconds"], 60)
            self.assertEqual(pod["metadata"]["namespace"], "observability-lab")
            self.assertNotEqual(pod["metadata"]["labels"]["app.kubernetes.io/part-of"], "clusterlens-lab")

    def test_kube_refuses_current_context_fallback(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(lab, "KUBECONFIG", Path(folder) / "missing"), patch.object(lab, "require"), patch.object(lab, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "No owned lab"):
                lab.kube("get", "pods")
            run.assert_not_called()

    def test_kube_always_selects_private_context(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "config"
            marker = Path(folder) / "marker"
            path.touch()
            marker.touch()
            with patch.object(lab, "KUBECONFIG", path), patch.object(lab, "MARKER", marker), patch.object(lab, "require"), patch.object(lab, "run") as run:
                lab.kube("get", "nodes")
                command = run.call_args.args[0]
                self.assertEqual(command[1:5], ["--kubeconfig", str(path), "--context", "k3d-clusterlens"])

    def test_cleanup_refuses_unowned_cluster(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(lab, "MARKER", Path(folder) / "missing"), patch.object(lab, "require"), patch.object(lab, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "ownership marker"):
                lab.cleanup()
            run.assert_not_called()

    def test_existing_unowned_cluster_is_not_adopted(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(lab, "MARKER", Path(folder) / "missing"), patch.object(lab, "require"), patch.object(lab, "clusters", return_value=[{"name": "clusterlens"}]), patch.object(lab, "run", return_value=subprocess.CompletedProcess([], 0, str(8 * 1024**3))) as run:
            with self.assertRaisesRegex(RuntimeError, "Refusing to adopt"):
                lab.setup()
            self.assertEqual(run.call_count, 1)

    def test_scenario_cleans_up_on_poll_failure(self):
        with patch.object(lab, "apply"), patch.object(lab, "kube", side_effect=[RuntimeError("API down"), None]) as kube:
            with self.assertRaisesRegex(RuntimeError, "API down"):
                lab.scenario("crash", 30)
            self.assertIn("delete", kube.call_args.args)
            self.assertIn("scenario-crash", kube.call_args.args)

    def test_generator_cli_emits_valid_json(self):
        result = subprocess.run(["python3", str(ROOT / "lab/workloads/generate.py")], capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout)["kind"], "List")


if __name__ == "__main__":
    unittest.main()
