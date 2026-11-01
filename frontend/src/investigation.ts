import type { Resource } from "./types";
import { healthy, isWorkload } from "./lib";
export type PageView =
  | "Overview"
  | "Forecasts"
  | "Workloads"
  | "Nodes"
  | "Storage"
  | "Logs"
  | "Events";
export type EvidenceTab = "Overview" | "Metrics" | "Logs" | "Events";
export const evidenceTabs: EvidenceTab[] = [
  "Overview",
  "Metrics",
  "Logs",
  "Events",
];
export const windows = [900, 3600, 21600, 86400];
export type InvestigationRoute = {
  view: PageView;
  namespace: string;
  resource: string;
  tab: EvidenceTab;
  range: number;
  trail: string[];
  pod: string;
  container: string;
};
export function readInvestigation(hash: string): InvestigationRoute {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const views: PageView[] = [
    "Overview",
    "Forecasts",
    "Workloads",
    "Nodes",
    "Storage",
    "Logs",
    "Events",
  ];
  const resource = (q.get("resource") || "").slice(0, 256);
  let trail = (q.get("trail") || "")
    .split(",")
    .filter(Boolean)
    .map((id) => id.slice(0, 256));
  if (resource) {
    if (!trail.includes(resource)) trail.push(resource);
    trail = trail.slice(0, trail.indexOf(resource) + 1);
  } else trail = [];
  if (trail.length > 8) trail = [trail[0], ...trail.slice(-7)];
  return {
    view: views.includes(q.get("view") as PageView)
      ? (q.get("view") as PageView)
      : "Overview",
    namespace: q.get("namespace") || "all",
    resource,
    tab:
      resource && evidenceTabs.includes(q.get("tab") as EvidenceTab)
        ? (q.get("tab") as EvidenceTab)
        : "Overview",
    range: windows.includes(Number(q.get("range")))
      ? Number(q.get("range"))
      : 900,
    trail,
    pod: (q.get("pod") || "").slice(0, 256),
    container: (q.get("container") || "").slice(0, 256),
  };
}
export function writeInvestigation(route: InvestigationRoute) {
  const q = new URLSearchParams({
    view: route.view,
    namespace: route.namespace,
    range: String(route.range),
  });
  if (route.resource) {
    q.set("resource", route.resource);
    q.set("tab", route.tab);
    q.set("trail", route.trail.join(","));
    if (route.pod) q.set("pod", route.pod);
    if (route.container) q.set("container", route.container);
  }
  return "#" + q.toString();
}
export function followResource(
  route: InvestigationRoute,
  resource: Resource,
  tab?: EvidenceTab,
): InvestigationRoute {
  const trail = route.resource ? [...route.trail] : [];
  const previous = trail.indexOf(resource.uid);
  if (previous >= 0) trail.splice(previous + 1);
  else trail.push(resource.uid);
  const bounded = trail.length > 8 ? [trail[0], ...trail.slice(-7)] : trail;
  return {
    ...route,
    resource: resource.uid,
    trail: bounded,
    tab: tab ?? (route.resource ? route.tab : "Overview"),
    pod: resource.kind === "Pod" ? resource.uid : route.pod,
    container:
      resource.kind === "Pod" && resource.uid !== route.pod
        ? ""
        : route.container,
  };
}
export function investigationPods(resource: Resource, resources: Resource[]) {
  const claims = new Set(
    resources
      .filter(
        (r) =>
          r.kind === "PersistentVolumeClaim" &&
          (r.uid === resource.uid ||
            resource.related.includes(r.uid) ||
            (resource.kind === "PersistentVolume" &&
              r.volume === resource.name) ||
            (resource.kind === "StorageClass" &&
              r.storageClass === resource.name)),
      )
      .map((r) => r.uid),
  );
  return resources
    .filter(
      (p) =>
        p.kind === "Pod" &&
        !p.deletedAt &&
        (resource.kind === "Pod"
          ? p.uid === resource.uid
          : resource.kind === "Node"
            ? p.node === resource.name
            : isWorkload(resource)
              ? p.workloadUid === resource.uid || p.ownerUid === resource.uid
              : resource.kind === "Service"
                ? resource.related.includes(p.uid)
                : p.related.some((id) => claims.has(id))),
    )
    .sort(
      (a, b) =>
        Number(healthy(a)) - Number(healthy(b)) ||
        b.restarts - a.restarts ||
        a.name.localeCompare(b.name),
    );
}
export function relationshipGroups(resource: Resource, resources: Resource[]) {
  const pods = investigationPods(resource, resources);
  const ids = new Set(resource.related);
  pods.forEach((p) => ids.add(p.uid));
  const nodeNames = new Set(pods.map((p) => p.node));
  resources
    .filter((r) => r.kind === "Node" && nodeNames.has(r.name))
    .forEach((r) => ids.add(r.uid));
  if (resource.workloadUid) ids.add(resource.workloadUid);
  const related = resources.filter(
    (r) => r.uid !== resource.uid && ids.has(r.uid),
  );
  const groups = [
    {
      key: "workloads",
      title:
        resource.kind === "Node"
          ? "Workloads on this node"
          : resource.kind === "Pod"
            ? "Owning workload"
            : "Connected workloads",
      description:
        resource.kind === "Node"
          ? "Node context may include neighboring workloads."
          : "Connected by Kubernetes ownership or pod references.",
      items: related.filter((r) => r.kind !== "Pod" && isWorkload(r)),
    },
    {
      key: "pods",
      title:
        resource.kind === "Node"
          ? "Pods on this node"
          : isWorkload(resource)
            ? "Pods in this workload"
            : "Pods referencing this resource",
      description: "Follow a pod to its containers, logs, node, and volumes.",
      items: pods.filter((p) => p.uid !== resource.uid),
    },
    {
      key: "nodes",
      title: resource.kind.includes("Volume")
        ? "Nodes hosting referencing pods"
        : "Scheduled on",
      description: "Placement is evidence of association, not a proven cause.",
      items: related.filter((r) => r.kind === "Node"),
    },
    {
      key: "volumes",
      title:
        resource.kind === "PersistentVolumeClaim"
          ? "Bound volume & storage class"
          : "Volume claims",
      description:
        "Pod references and bindings; physical storage health is not yet monitored.",
      items: related.filter((r) =>
        ["PersistentVolumeClaim", "PersistentVolume", "StorageClass"].includes(
          r.kind,
        ),
      ),
    },
    {
      key: "services",
      title: "Matching Kubernetes Services",
      description: "Connected through pod label selectors.",
      items: related.filter((r) => r.kind === "Service"),
    },
    {
      key: "controllers",
      title: "Controller chain",
      description: "Intermediate ownership references.",
      items: related.filter((r) => r.kind === "ReplicaSet" && !isWorkload(r)),
    },
  ];
  return groups.filter((g) => g.items.length);
}
export function suggestedChecks(resource: Resource, resources: Resource[]) {
  const pods = investigationPods(resource, resources);
  const groups = relationshipGroups(resource, resources);
  const pod = pods.find((p) => p.uid !== resource.uid);
  const node =
    groups
      .find((g) => g.key === "nodes")
      ?.items.find((n) => n.conditions.length) ||
    groups.find((g) => g.key === "nodes")?.items[0];
  const volume = groups
    .find((g) => g.key === "volumes")
    ?.items.find((v) => v.kind === "PersistentVolumeClaim");
  return [
    pod
      ? {
          resource: pod,
          title: healthy(pod) ? "Inspect a pod" : "Inspect an affected pod",
          reason: [
            pod.restarts ? `${pod.restarts} restarts` : "",
            pod.status,
            pod.ready < pod.desired
              ? `${pod.ready}/${pod.desired} containers ready`
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
        }
      : null,
    node
      ? {
          resource: node,
          title: "Check node context",
          reason: node.conditions.join(", ") || node.status,
        }
      : null,
    volume
      ? {
          resource: volume,
          title: "Follow its storage",
          reason: `Claim is ${volume.status.toLowerCase()}`,
        }
      : null,
  ].filter((v): v is NonNullable<typeof v> => v !== null);
}
