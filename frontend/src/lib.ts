import type { Resource, KEvent } from "./types";
export const workloadKinds = new Set([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
]);
export function isWorkload(r: Resource) {
  return (
    workloadKinds.has(r.kind) ||
    (r.kind === "ReplicaSet" && !r.ownerUid) ||
    (r.kind === "Pod" && (!r.ownerUid || r.workloadUid === r.uid))
  );
}
export function healthy(r: Resource) {
  return (
    [
      "Healthy",
      "Running",
      "Ready",
      "Bound",
      "Active",
      "Completed",
      "Succeeded",
      "Scheduled",
      "Scaled to zero",
      "Suspended",
      "Available",
      "Configured",
    ].includes(r.status) &&
    (r.kind !== "Pod" || r.status === "Succeeded" || r.ready >= r.desired) &&
    r.conditions.length === 0
  );
}
export function bytes(n: number, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.min(4, Math.max(0, Math.floor(Math.log(n) / Math.log(1024))));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}
export function cpu(n: number) {
  return n < 1 ? `${Math.round(n * 1000)}m` : `${n.toFixed(2)}`;
}
export function age(date: string) {
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "—";
  return seconds < 60
    ? "just now"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ago`
        : `${Math.floor(seconds / 86400)}d ago`;
}
export function filtered(
  resources: Resource[],
  namespace: string,
  search = "",
) {
  const q = search.toLowerCase();
  return resources.filter(
    (r) =>
      (namespace === "all" || !r.namespace || r.namespace === namespace) &&
      `${r.name} ${r.kind} ${r.namespace} ${r.status}`
        .toLowerCase()
        .includes(q),
  );
}
export function relatedEvents(
  resource: Resource,
  resources: Resource[],
  events: KEvent[],
) {
  const ids = new Set([resource.uid, ...resource.related]);
  if (isWorkload(resource))
    resources
      .filter(
        (r) => r.workloadUid === resource.uid || r.ownerUid === resource.uid,
      )
      .forEach((r) => ids.add(r.uid));
  return events.filter((e) => ids.has(e.resourceUid));
}
export async function getJSON<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(`${response.status}: ${data.error || response.statusText}`);
  }
  return response.json();
}
