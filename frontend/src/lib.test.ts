import { describe, it, expect } from "vitest";
import {
  bytes,
  cpu,
  filtered,
  healthy,
  isWorkload,
  relatedEvents,
} from "./lib";
import type { KEvent, Resource } from "./types";
const resource = (patch: Partial<Resource> = {}): Resource => ({
  uid: "w1",
  kind: "Deployment",
  name: "api",
  namespace: "lab",
  created: "2026-01-01T00:00:00Z",
  labels: {},
  ownerUid: "",
  workloadUid: "",
  status: "Healthy",
  ready: 1,
  desired: 1,
  restarts: 0,
  node: "",
  containers: [],
  related: [],
  usage: null,
  cpuCapacity: 0,
  memoryCapacity: 0,
  cpuAllocatable: 0,
  memoryAllocatable: 0,
  capacity: 0,
  storageClass: "",
  volume: "",
  accessModes: [],
  conditions: [],
  ...patch,
});
describe("resource presentation", () => {
  it("shows scaled workloads and standalone pods without duplicating owned pods", () => {
    expect(isWorkload(resource())).toBe(true);
    expect(
      isWorkload(
        resource({ kind: "Pod", uid: "p", ownerUid: "rs", workloadUid: "w1" }),
      ),
    ).toBe(false);
    expect(
      isWorkload(resource({ kind: "Pod", uid: "p", workloadUid: "p" })),
    ).toBe(true);
  });
  it("does not call an unready running pod healthy", () =>
    expect(
      healthy(resource({ kind: "Pod", status: "Running", ready: 0 })),
    ).toBe(false));
  it("treats node pressure as unhealthy", () =>
    expect(
      healthy(
        resource({
          kind: "Node",
          status: "Ready",
          conditions: ["MemoryPressure"],
        }),
      ),
    ).toBe(false));
  it("formats quantities without invented measurements", () => {
    expect(bytes(1024 ** 3)).toBe("1.0 GiB");
    expect(cpu(0.025)).toBe("25m");
  });
  it("keeps cluster resources when filtering namespaces", () => {
    const rows = [
      resource(),
      resource({ uid: "node", kind: "Node", namespace: "" }),
      resource({ uid: "other", namespace: "other" }),
    ];
    expect(filtered(rows, "lab").map((r) => r.uid)).toEqual(["w1", "node"]);
    expect(filtered(rows, "lab", "node")).toHaveLength(1);
  });
  it("correlates pod events through workload UID rather than names", () => {
    const workload = resource();
    const pod = resource({ uid: "pod-new", kind: "Pod", workloadUid: "w1" });
    const events = [
      { uid: "e1", resourceUid: "pod-new" },
      { uid: "e2", resourceUid: "pod-old" },
    ] as KEvent[];
    expect(
      relatedEvents(workload, [workload, pod], events).map((e) => e.uid),
    ).toEqual(["e1"]);
  });
});
