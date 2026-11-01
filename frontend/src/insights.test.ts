import { describe, expect, it } from "vitest";
import type { Resource, Snapshot } from "./types";
import {
  clusterHealth,
  contributors,
  nearestPointIndex,
  storageComplete,
  volumeMappings,
} from "./insights";
const now = new Date().toISOString();
function resource(p: Partial<Resource> = {}): Resource {
  return {
    uid: "w",
    kind: "Deployment",
    name: "api",
    namespace: "lab",
    created: now,
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
    ...p,
  };
}
const snapshot = (resources: Resource[]): Snapshot => ({
  cluster: "test",
  timestamp: now,
  connected: true,
  connectionError: "",
  sources: ["Pod", "PersistentVolumeClaim", "Node"].map((kind) => ({
    kind,
    synced: true,
    error: "",
  })),
  metrics: { available: true, error: "", lastSuccess: now },
  resources,
  deletedResources: [],
  events: [],
  truncated: false,
  historyDropped: 0,
});
const claim = resource({
  uid: "claim",
  kind: "PersistentVolumeClaim",
  name: "data",
  status: "Bound",
  created: new Date(Date.now() - 10 * 86400000).toISOString(),
});
const pod = resource({
  uid: "pod",
  kind: "Pod",
  status: "Running",
  workloadUid: "w",
  node: "worker-1",
  related: ["claim"],
});
describe("workload contribution", () => {
  it("ranks measured usage and gives the denominator explicitly", () => {
    const rows = [
      resource({ uid: "one", usage: { cpu: 1, memory: 100, timestamp: now } }),
      resource({ uid: "two", usage: { cpu: 3, memory: 50, timestamp: now } }),
      resource({ uid: "missing" }),
    ];
    const result = contributors(rows, "cpu");
    expect(result.rows[0].resource.uid).toBe("two");
    expect(result.rows[0].share).toBe(0.75);
    expect(result.measured).toBe(2);
    expect(result.count).toBe(3);
  });
  it("does not double-count owned workloads or count missing usage as zero", () => {
    const rows = [
      resource({ usage: { cpu: 1, memory: 5, timestamp: now } }),
      resource({
        uid: "job",
        kind: "Job",
        ownerUid: "w",
        usage: { cpu: 1, memory: 5, timestamp: now },
      }),
    ];
    expect(contributors(rows, "cpu").total).toBe(1);
    expect(contributors([resource()], "cpu").rows).toEqual([]);
  });
  it("handles observed zero without NaN percentages", () =>
    expect(
      contributors(
        [resource({ usage: { cpu: 0, memory: 0, timestamp: now } })],
        "cpu",
      ).rows[0].share,
    ).toBe(0));
});
describe("volume mapping", () => {
  it("maps a claim to its active pod, workload and node", () => {
    const result = volumeMappings([claim, pod, resource()], true)[0];
    expect(result.state).toBe("In use");
    expect(result.pods[0].uid).toBe("pod");
    expect(result.workloads[0].uid).toBe("w");
    expect(result.nodes).toEqual(["worker-1"]);
    expect(result.review).toBe(false);
  });
  it("does not count completed pods or other namespaces as active use", () => {
    const result = volumeMappings(
      [
        claim,
        { ...pod, status: "Succeeded" },
        { ...pod, uid: "other", namespace: "other" },
      ],
      true,
    )[0];
    expect(result.state).toBe("Unattached");
    expect(result.review).toBe(true);
  });
  it("does not assert unattached when discovery is incomplete", () => {
    const result = volumeMappings([claim], false)[0];
    expect(result.state).toBe("Unknown");
    expect(result.review).toBe(false);
  });
  it("keeps Pending distinct from unused bound storage", () =>
    expect(
      volumeMappings([{ ...claim, status: "Pending" }], true)[0].state,
    ).toBe("Waiting for storage"));
  it("only suggests review for older unattached claims; does not call them stale", () => {
    const result = volumeMappings([{ ...claim, created: now }], true)[0];
    expect(result.review).toBe(false);
    expect(result.state).toBe("Unattached");
  });
  it("requires complete pod and PVC sources and a fresh snapshot", () => {
    const s = snapshot([claim]);
    expect(storageComplete(s)).toBe(true);
    expect(storageComplete({ ...s, truncated: true })).toBe(false);
    expect(
      storageComplete({
        ...s,
        sources: s.sources.filter((s) => s.kind !== "Pod"),
      }),
    ).toBe(false);
    expect(storageComplete({ ...s, timestamp: "2020-01-01T00:00:00Z" })).toBe(
      false,
    );
  });
});
describe("management health verdict", () => {
  const node = resource({
    uid: "n",
    kind: "Node",
    namespace: "",
    status: "Ready",
  });
  it("summarizes health without a fabricated score", () =>
    expect(clusterHealth(snapshot([node, resource()])).level).toBe("healthy"));
  it("does not show green for unready pods, pressure, or missing sources", () => {
    expect(clusterHealth(snapshot([node, { ...pod, ready: 0 }])).level).toBe(
      "attention",
    );
    expect(
      clusterHealth(snapshot([{ ...node, conditions: ["MemoryPressure"] }]))
        .level,
    ).toBe("attention");
    expect(clusterHealth({ ...snapshot([node]), connected: false }).level).toBe(
      "unknown",
    );
  });
  it("separates missing telemetry from a resource failure", () =>
    expect(
      clusterHealth({
        ...snapshot([node]),
        metrics: { available: false, error: "Unavailable", lastSuccess: now },
      }).level,
    ).toBe("limited"));
});
describe("chart selection", () => {
  const points = [0, 10, 100].map((n) => ({
    timestamp: new Date(n * 1000).toISOString(),
  }));
  it("finds the nearest timestamp rather than assuming evenly spaced points", () => {
    expect(nearestPointIndex(points, 0.11)).toBe(1);
    expect(nearestPointIndex(points, 0.9)).toBe(2);
    expect(nearestPointIndex(points, -3)).toBe(0);
  });
  it("handles empty data", () => expect(nearestPointIndex([], 0)).toBe(-1));
});
