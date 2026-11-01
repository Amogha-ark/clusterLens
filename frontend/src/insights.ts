import type { Resource, Snapshot } from "./types";
import { healthy, isWorkload } from "./lib";

export function workloadRoots(resources: Resource[]) {
  const ids = new Set(resources.filter(isWorkload).map((r) => r.uid));
  return resources.filter((r) => isWorkload(r) && !ids.has(r.ownerUid));
}
export function contributors(resources: Resource[], field: "cpu" | "memory") {
  const workloads = workloadRoots(resources);
  const measured = workloads.filter(
    (r) => r.usage !== null && Number.isFinite(r.usage[field]),
  );
  const total = measured.reduce((sum, r) => sum + r.usage![field], 0);
  return {
    total,
    measured: measured.length,
    count: workloads.length,
    rows: [...measured]
      .sort(
        (a, b) =>
          b.usage![field] - a.usage![field] || a.name.localeCompare(b.name),
      )
      .map((resource) => ({
        resource,
        value: resource.usage![field],
        share: total > 0 ? resource.usage![field] / total : 0,
      })),
  };
}
export function clusterHealth(snapshot: Snapshot, connectionError = "") {
  const nodes = snapshot.resources.filter((r) => r.kind === "Node");
  const workloads = workloadRoots(snapshot.resources);
  const pods = snapshot.resources.filter((r) => r.kind === "Pod");
  const needsAttention = [
    ...nodes,
    ...workloads,
    ...pods.filter((r) => !r.ownerUid),
    ...snapshot.resources.filter((r) => r.kind === "PersistentVolumeClaim"),
  ].filter((r) => !healthy(r));
  const incomplete =
    !snapshot.connected ||
    !!connectionError ||
    snapshot.truncated ||
    !snapshot.sources.length ||
    snapshot.sources.some((s) => !s.synced || !!s.error) ||
    !nodes.length ||
    !Number.isFinite(Date.parse(snapshot.timestamp)) ||
    Date.now() - new Date(snapshot.timestamp).getTime() > 30000;
  const degradedPods = pods.filter(
    (p) => !healthy(p) && !["Succeeded", "Completed"].includes(p.status),
  );
  const level = incomplete
    ? "unknown"
    : needsAttention.length || degradedPods.length
      ? "attention"
      : !snapshot.metrics.available
        ? "limited"
        : "healthy";
  return {
    level,
    nodes,
    workloads,
    pods,
    needsAttention,
    degradedPods,
    title:
      level === "healthy"
        ? "Your cluster looks healthy."
        : level === "attention"
          ? "A few things need attention."
          : level === "limited"
            ? "Health looks good. Metrics are missing."
            : "We’re checking your cluster.",
    description:
      level === "healthy"
        ? "All observed nodes, workloads, and storage claims are ready."
        : level === "attention"
          ? "Start with the affected resources below. Nothing is changed automatically."
          : level === "limited"
            ? "Resource states are available. Usage and contribution rankings need fresh metrics."
            : "Some signals are missing or out of date. We’ll show a verdict when discovery is complete.",
  };
}
export type VolumeMapping = {
  claim: Resource;
  pods: Resource[];
  workloads: Resource[];
  nodes: string[];
  state:
    | "In use"
    | "Unattached"
    | "Waiting for storage"
    | "Needs attention"
    | "Unknown";
  review: boolean;
};
export function volumeMappings(
  resources: Resource[],
  complete: boolean,
  now = Date.now(),
): VolumeMapping[] {
  const active = resources.filter(
    (r) =>
      r.kind === "Pod" &&
      !r.deletedAt &&
      !["Succeeded", "Completed", "Failed", "Deleted"].includes(r.status),
  );
  return resources
    .filter((r) => r.kind === "PersistentVolumeClaim")
    .map((claim) => {
      const pods = active.filter(
        (p) =>
          p.namespace === claim.namespace &&
          (p.related.includes(claim.uid) || claim.related.includes(p.uid)),
      );
      const workloadIds = new Set(pods.map((p) => p.workloadUid));
      const workloads = resources.filter((r) => workloadIds.has(r.uid));
      const state = !complete
        ? "Unknown"
        : claim.status === "Pending"
          ? "Waiting for storage"
          : claim.status !== "Bound"
            ? "Needs attention"
            : pods.length
              ? "In use"
              : "Unattached";
      // Creation age does not establish last-use age. Flag only for human review.
      const review =
        state === "Unattached" &&
        now - new Date(claim.created).getTime() >= 7 * 86400000;
      return {
        claim,
        pods,
        workloads,
        nodes: [...new Set(pods.map((p) => p.node).filter(Boolean))],
        state,
        review,
      };
    });
}
export function storageComplete(snapshot: Snapshot) {
  return (
    snapshot.connected &&
    !snapshot.truncated &&
    Date.now() - new Date(snapshot.timestamp).getTime() <= 30000 &&
    ["Pod", "PersistentVolumeClaim"].every((kind) =>
      snapshot.sources.some((s) => s.kind === kind && s.synced && !s.error),
    )
  );
}
export function nearestPointIndex(
  points: { timestamp: string }[],
  ratio: number,
) {
  if (!points.length) return -1;
  const first = new Date(points[0].timestamp).getTime(),
    last = new Date(points[points.length - 1].timestamp).getTime();
  const target = first + Math.min(1, Math.max(0, ratio)) * (last - first);
  let best = 0;
  for (let i = 1; i < points.length; i++)
    if (
      Math.abs(new Date(points[i].timestamp).getTime() - target) <
      Math.abs(new Date(points[best].timestamp).getTime() - target)
    )
      best = i;
  return best;
}
