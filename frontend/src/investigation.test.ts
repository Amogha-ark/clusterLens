import { describe, expect, it } from "vitest";
import type { Resource } from "./types";
import {
  followResource,
  investigationPods,
  readInvestigation,
  relationshipGroups,
  suggestedChecks,
  writeInvestigation,
} from "./investigation";
function r(p: Partial<Resource>): Resource {
  return {
    uid: "w",
    kind: "Deployment",
    name: "api",
    namespace: "lab",
    created: new Date().toISOString(),
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
const workload = r({ related: ["p", "n", "c", "s"] }),
  pod = r({
    uid: "p",
    kind: "Pod",
    name: "api-pod",
    ownerUid: "rs",
    workloadUid: "w",
    node: "worker",
    status: "CrashLoopBackOff",
    restarts: 3,
    related: ["w", "n", "c"],
  }),
  node = r({
    uid: "n",
    kind: "Node",
    name: "worker",
    namespace: "",
    status: "Ready",
    related: ["w", "p", "c"],
  }),
  claim = r({
    uid: "c",
    kind: "PersistentVolumeClaim",
    name: "data",
    status: "Bound",
    related: ["p", "w", "n", "pv"],
  }),
  pv = r({
    uid: "pv",
    kind: "PersistentVolume",
    name: "disk",
    namespace: "",
    related: ["c"],
  }),
  otherPod = r({
    uid: "other",
    kind: "Pod",
    name: "neighbor",
    ownerUid: "other-workload",
    workloadUid: "other-workload",
    node: "worker",
    related: ["n"],
  });
const resources = [workload, pod, node, claim, pv, otherPod];
describe("investigation navigation", () => {
  it("round trips a shareable scope, trail, evidence tab, window and log selection", () => {
    const route = {
      ...readInvestigation("#view=Storage&namespace=lab"),
      resource: "p",
      trail: ["w", "p"],
      tab: "Logs" as const,
      range: 3600,
      pod: "p",
      container: "web",
    };
    expect(readInvestigation(writeInvestigation(route))).toEqual(route);
  });
  it("keeps the current tab and time range when following a dependency and returning", () => {
    let route = { ...readInvestigation(""), range: 3600 };
    route = followResource(route, workload);
    route = { ...route, tab: "Metrics" };
    route = followResource(route, pod);
    route = followResource(route, node);
    expect(route.trail).toEqual(["w", "p", "n"]);
    expect(route.tab).toBe("Metrics");
    expect(route.range).toBe(3600);
    route = followResource(route, workload);
    expect(route.trail).toEqual(["w"]);
    expect(route.tab).toBe("Metrics");
  });
  it("uses explicit event entry tabs and safe defaults for malformed links", () => {
    expect(followResource(readInvestigation(""), pod, "Events").tab).toBe(
      "Events",
    );
    const route = readInvestigation("#view=nope&range=-1&tab=nope&resource=p");
    expect(route.view).toBe("Overview");
    expect(route.range).toBe(900);
    expect(route.tab).toBe("Overview");
    expect(route.trail).toEqual(["p"]);
  });
  it("bounds long trails while retaining the original investigation root", () => {
    let route = followResource(readInvestigation(""), workload);
    for (let i = 0; i < 15; i++)
      route = followResource(route, r({ uid: "r" + i }));
    expect(route.trail.length).toBe(8);
    expect(route.trail[0]).toBe("w");
    expect(readInvestigation(writeInvestigation(route)).trail).toEqual(
      route.trail,
    );
  });
});
describe("evidence scope and connections", () => {
  it("keeps workload and PVC logs restricted to their referencing pods", () => {
    expect(investigationPods(workload, resources).map((p) => p.uid)).toEqual([
      "p",
    ]);
    expect(investigationPods(claim, resources).map((p) => p.uid)).toEqual([
      "p",
    ]);
    expect(investigationPods(pv, resources).map((p) => p.uid)).toEqual(["p"]);
  });
  it("shows neighboring workloads only when investigating node context", () => {
    expect(
      investigationPods(node, resources)
        .map((p) => p.uid)
        .sort(),
    ).toEqual(["other", "p"]);
    expect(
      relationshipGroups(workload, resources)
        .find((g) => g.key === "pods")
        ?.items.map((p) => p.uid),
    ).toEqual(["p"]);
  });
  it("does not select a deleted pod for live logs", () =>
    expect(
      investigationPods(workload, [
        workload,
        { ...pod, deletedAt: new Date().toISOString() },
      ]),
    ).toEqual([]));
  it("prioritizes affected pods and labels infrastructure checks without inferring causality", () => {
    const checks = suggestedChecks(workload, resources);
    expect(checks[0].resource.uid).toBe("p");
    expect(checks[0].reason).toContain("3 restarts");
    expect(checks.map((c) => c.resource.uid)).toEqual(["p", "n", "c"]);
  });
});
