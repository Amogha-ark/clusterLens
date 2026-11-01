import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Box,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  GitBranch,
  HardDrive,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  Network,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  Container,
  KEvent,
  LogResult,
  Point,
  Resource,
  Snapshot,
} from "./types";
import {
  age,
  bytes,
  cpu,
  filtered,
  getJSON,
  healthy,
  isWorkload,
  relatedEvents,
} from "./lib";
import { AIExplanation } from "./AIExplanation";
import { ThemeToggle } from "./ThemeToggle";
import { Overview } from "./Overview";
import { StorageView } from "./StorageView";
import { InteractiveChart } from "./InteractiveChart";
import "./styles.css";
import "./redesign.css";
import "./themes.css";
import {
  evidenceTabs,
  followResource,
  investigationPods,
  readInvestigation,
  relationshipGroups,
  writeInvestigation,
} from "./investigation";
import type { EvidenceTab, InvestigationRoute } from "./investigation";
import {
  InvestigationContext,
  InvestigationNextSteps,
} from "./InvestigationContext";
import "./investigation.css";
import "./resource-details.css";

import { Forecasts } from './Forecasts';
type View = "Overview" | "Forecasts" | "Workloads" | "Nodes" | "Storage" | "Logs" | "Events";
const nav: { name: View; icon: LucideIcon }[] = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Workloads", icon: Boxes },
  { name: "Forecasts", icon: Activity },
  { name: "Nodes", icon: Server },
  { name: "Storage", icon: Database },
  { name: "Logs", icon: Terminal },
  { name: "Events", icon: Activity },
];
const descriptions: Record<View, string> = {
  Overview: "Health first. Understand what matters, then explore.",
  Forecasts: "Explore recent trends, projected usage and uncertainty.",
  Workloads: "Follow your applications from workload to evidence.",
  Nodes: "The foundation beneath every workload.",
  Storage:
    "See what’s in use, what’s unattached, and what deserves a closer look.",
  Logs: "Go straight to the source. Real container output.",
  Events: "A timeline of what changed, and where.",
};
function Glyph({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon =
    kind === "Node"
      ? Server
      : kind.includes("Volume")
        ? HardDrive
        : kind === "Service"
          ? Network
          : kind === "StorageClass"
            ? Database
            : kind === "Pod"
              ? Box
              : Layers3;
  return <Icon size={size} />;
}
function Badge({
  good,
  children,
}: {
  good: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`badge ${good ? "good" : "warn"}`}>
      <i />
      {children}
    </span>
  );
}
function Empty({
  title,
  children,
  icon: Icon = Search,
}: {
  title: string;
  children: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={23} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function ResourceButton({
  resource,
  onOpen,
}: {
  resource: Resource;
  onOpen: (r: Resource) => void;
}) {
  return (
    <button className="resource-link" onClick={() => onOpen(resource)}>
      <span className="resource-icon">
        <Glyph kind={resource.kind} />
      </span>
      <span>
        <strong>{resource.name}</strong>
        <small>{resource.kind}</small>
      </span>
      <ChevronRight size={14} />
    </button>
  );
}
function EventList({
  events,
  resources,
  onOpen,
  compact = false,
  scopeResource,
}: {
  events: KEvent[];
  resources: Resource[];
  onOpen: (r: Resource) => void;
  compact?: boolean;
  scopeResource?: Resource;
}) {
  if (!events.length)
    return (
      <Empty title="A quiet timeline" icon={CheckCircle2}>
        No Kubernetes events in this scope and time window.
      </Empty>
    );
  return (
    <div className={`event-list ${compact ? "compact" : ""}`}>
      {events.map((event) => {
        const resource = resources.find((r) => r.uid === event.resourceUid);
        return (
          <article className="event" key={event.uid}>
            <span
              className={`event-icon ${event.type === "Warning" ? "warning" : ""}`}
            >
              {event.type === "Warning" ? (
                <TriangleAlert size={15} />
              ) : (
                <Check size={15} />
              )}
            </span>
            <div>
              <div className="event-title">
                <strong>{event.reason}</strong>
                <time title={event.timestamp}>{age(event.timestamp)}</time>
              </div>
              {resource ? (
                <button
                  className="inline-link"
                  onClick={() => onOpen(resource)}
                >
                  {event.name}
                  <ArrowUpRight size={12} />
                </button>
              ) : (
                <span className="event-object">{event.name}</span>
              )}
              {scopeResource && (
                <span className="evidence-origin">
                  {event.resourceUid === scopeResource.uid
                    ? "This resource"
                    : `Related ${resource?.kind || "resource"}`}{" "}
                  · {event.namespace || "cluster scoped"}
                </span>
              )}
              <p>{event.message}</p>
              {!compact && (
                <small>
                  {event.namespace} · {event.count || 1} occurrence(s)
                </small>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
function ResourceTable({
  resources,
  onOpen,
  mode = "workload",
}: {
  resources: Resource[];
  onOpen: (r: Resource) => void;
  mode?: "workload" | "node" | "storage";
}) {
  if (!resources.length)
    return (
      <Empty title="No resources here">
        Try another namespace or clear your search.
      </Empty>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>
              {mode === "node"
                ? "Node"
                : mode === "storage"
                  ? "Storage resource"
                  : "Workload"}
            </th>
            <th>Status</th>
            <th>
              {mode === "storage"
                ? "Capacity"
                : mode === "node"
                  ? "Pods"
                  : "Ready"}
            </th>
            <th>{mode === "storage" ? "Storage class" : "CPU"}</th>
            <th>{mode === "storage" ? "Access" : "Memory"}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r.uid}>
              <td>
                <button className="table-name" onClick={() => onOpen(r)}>
                  <span
                    className={`resource-icon ${mode === "storage" ? "purple" : ""}`}
                  >
                    <Glyph kind={r.kind} />
                  </span>
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      {r.kind}
                      {r.namespace && ` · ${r.namespace}`}
                    </small>
                  </span>
                </button>
              </td>
              <td>
                <Badge
                  good={
                    mode === "storage"
                      ? ["Bound", "Available"].includes(r.status)
                      : healthy(r)
                  }
                >
                  {r.status || "Unknown"}
                </Badge>
              </td>
              <td className="mono">
                {mode === "storage"
                  ? r.capacity
                    ? bytes(r.capacity)
                    : "—"
                  : mode === "node"
                    ? r.desired
                    : `${r.ready} / ${r.desired}`}
              </td>
              <td className="mono">
                {mode === "storage"
                  ? r.storageClass || "—"
                  : r.usage
                    ? cpu(r.usage.cpu)
                    : "—"}
              </td>
              <td className="mono">
                {mode === "storage"
                  ? r.accessModes.join(", ") || "—"
                  : r.usage
                    ? bytes(r.usage.memory)
                    : "—"}
              </td>
              <td>
                <button
                  className="icon-button row-arrow"
                  aria-label={`Open ${r.name}`}
                  onClick={() => onOpen(r)}
                >
                  <ArrowUpRight size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function LogsPanel({
  pods,
  initialPod,
  initialContainer,
  range,
  selection,
  onSelection,
}: {
  pods: Resource[];
  initialPod?: Resource;
  initialContainer?: Container;
  range: number;
  selection?: { pod: string; container: string };
  onSelection?: (pod: string, container: string) => void;
}) {
  const [podId, setPodId] = useState(initialPod?.uid || "");
  const requestedPod = selection?.pod || podId;
  const pod = requestedPod
    ? pods.find((p) => p.uid === requestedPod)
    : initialPod;

  const [container, setContainer] = useState(initialContainer?.name || "");
  const [result, setResult] = useState<LogResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [auto, setAuto] = useState(false);
  const [previous, setPrevious] = useState(false);
  const [reload, setReload] = useState(0);
  const logRef = useRef<HTMLPreElement>(null);
  const selectedContainer =
    pod?.containers.find((c) => c.name === (selection?.container || container))
      ?.name ||
    pod?.containers[0]?.name ||
    "";
  useEffect(() => {
    if (
      onSelection &&
      pod &&
      selectedContainer &&
      (!selection?.pod || !selection?.container)
    )
      onSelection(pod.uid, selectedContainer);
  }, [pod?.uid, selectedContainer, selection?.pod, selection?.container]);
  useEffect(() => {
    setResult(null);
    setError("");
    if (!pod || !selectedContainer) return;
    const controller = new AbortController();
    let active = true,
      loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      setBusy(true);
      try {
        const params = new URLSearchParams({
          namespace: pod.namespace,
          pod: pod.name,
          uid: pod.uid,
          container: selectedContainer,
          sinceSeconds: String(Math.min(range, 21600)),
          previous: String(previous),
        });
        const data = await getJSON<LogResult>(
          "/api/v1/logs?" + params,
          controller.signal,
        );
        if (active) {
          setResult(data);
          setError("");
        }
      } catch (e) {
        if (active && !(e instanceof DOMException && e.name === "AbortError"))
          setError(String(e));
      } finally {
        loading = false;
        if (active) setBusy(false);
      }
    };
    void load();
    const timer = auto
      ? window.setInterval(() => void load(), 5000)
      : undefined;
    return () => {
      active = false;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [pod?.uid, selectedContainer, range, previous, reload, auto]);
  const text = result?.text || "";
  const lines = text
    .split("\n")
    .filter((line) => line.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="logs-panel">
      <div className="log-controls">
        <label>
          Pod
          <select
            value={pod?.uid || ""}
            onChange={(e) => {
              setPodId(e.target.value);
              setContainer("");
              onSelection?.(e.target.value, "");
            }}
          >
            <option value="">Select a pod</option>
            {pods.map((p) => (
              <option key={p.uid} value={p.uid}>
                {p.namespace}/{p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Container
          <select
            value={selectedContainer}
            onChange={(e) => {
              setContainer(e.target.value);
              if (pod) onSelection?.(pod.uid, e.target.value);
            }}
            disabled={!pod}
          >
            {pod?.containers.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
        </label>
        <button
          className="button"
          onClick={() => setReload((n) => n + 1)}
          disabled={!pod || busy}
        >
          <RefreshCw size={14} className={busy ? "spin" : ""} />
          Refresh
        </button>
      </div>
      <div className="log-options">
        <label className="search-field">
          <Search size={14} />
          <input
            aria-label="Filter returned log lines"
            placeholder="Filter returned lines…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={previous}
            onChange={(e) => setPrevious(e.target.checked)}
          />
          Previous instance
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          Refresh every 5s
        </label>
      </div>
      {error ? (
        <div className="notice warning">
          <TriangleAlert size={16} />
          <div>
            <strong>
              {error.includes("403") ? "Log access denied" : "Logs unavailable"}
            </strong>
            <p>{error}</p>
          </div>
        </div>
      ) : !pod ? (
        <Empty
          title={
            requestedPod
              ? "Selected pod is outside this resource scope"
              : "Choose a pod to start"
          }
          icon={Terminal}
        >
          Select a pod from this resource's connections. Logs remain scoped by
          its Kubernetes UID.
        </Empty>
      ) : busy && !result ? (
        <Empty title="Reading container output" icon={LoaderCircle}>
          Querying the selected pod and time window…
        </Empty>
      ) : !text ? (
        <Empty title="No output in this window" icon={Terminal}>
          Try a longer time window or another container.
        </Empty>
      ) : (
        <>
          <div className="terminal-header">
            <span>
              <i className="live-dot" />
              {pod.name}
              <ChevronRight size={12} />
              {selectedContainer}
            </span>
            <small>{lines.filter(Boolean).length} returned lines</small>
          </div>
          <pre
            className="terminal"
            ref={logRef}
            tabIndex={0}
            aria-label="Container logs"
          >
            {lines.join("\n") || "No lines match the filter."}
          </pre>
          <div className="log-footer">
            <ShieldCheck size={13} />
            <span>
              Kubernetes API · ≤500 lines / 256 KiB · queried up to{" "}
              {Math.min(range / 3600, 6) < 1
                ? `${range / 60}m`
                : `${Math.min(range / 3600, 6)}h`}{" "}
              · not persisted
            </span>
            {result?.truncated && <strong>Byte limit reached</strong>}
          </div>
        </>
      )}
    </div>
  );
}
function DetailDrawer({
  resource,
  snapshot,
  onClose,
  onOpen,
  range,
  route,
  onContext,
}: {
  resource: Resource;
  snapshot: Snapshot;
  onClose: () => void;
  onOpen: (r: Resource, tab?: EvidenceTab) => void;
  range: number;
  route: InvestigationRoute;
  onContext: (patch: Partial<InvestigationRoute>) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const tab = route.tab;
  const setTab = (tab: EvidenceTab) => onContext({ tab });
  const historyKey = resource.uid + "/" + range;
  const [historyResult, setHistoryResult] = useState<{
    key: string;
    points: Point[];
  }>({ key: "", points: [] });
  const history = historyResult.key === historyKey ? historyResult.points : [];
  const [historyFailure, setHistoryFailure] = useState({
    key: "",
    message: "",
  });
  const historyError =
    historyFailure.key === historyKey ? historyFailure.message : "";
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>(".drawer")
      ?.scrollTo?.(0, 0);
  }, [resource.uid, tab]);
  useEffect(() => {
    const c = new AbortController();
    getJSON<{ points: Point[] }>(
      "/api/v1/history?" +
        new URLSearchParams({
          uid: resource.uid,
          since: new Date(Date.now() - range * 1000).toISOString(),
        }),
      c.signal,
    )
      .then((d) => {
        if (!c.signal.aborted) {
          setHistoryResult({ key: historyKey, points: d.points });
          setHistoryFailure({ key: historyKey, message: "" });
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setHistoryResult({ key: historyKey, points: [] });
          setHistoryFailure({ key: historyKey, message: String(e) });
        }
      });
    return () => c.abort();
  }, [resource.uid, range, snapshot.timestamp]);
  const detailResources = [
    ...snapshot.resources,
    ...(snapshot.deletedResources || []),
  ];
  const groups = relationshipGroups(resource, detailResources);
  const pods = investigationPods(resource, snapshot.resources);
  const events = relatedEvents(
    resource,
    detailResources,
    snapshot.events,
  ).filter((e) => new Date(e.timestamp).getTime() > Date.now() - range * 1000);
  const metadata = [
    ["Kind", resource.kind],
    ["Namespace", resource.namespace || "Cluster scoped"],
    ["Created", new Date(resource.created).toLocaleString()],
    ["Resource UID", resource.uid],
    ...(resource.kind === "Node"
      ? [
          [
            "CPU allocatable / capacity",
            `${cpu(resource.cpuAllocatable)} / ${cpu(resource.cpuCapacity)}`,
          ],
          [
            "Memory allocatable / capacity",
            `${bytes(resource.memoryAllocatable)} / ${bytes(resource.memoryCapacity)}`,
          ],
          [
            "Active pressure conditions",
            resource.conditions.join(", ") || "None reported",
          ],
        ]
      : []),
    ...(resource.node ? [["Node", resource.node]] : []),
    ...(resource.provisioner ? [["Provisioner", resource.provisioner]] : []),
    ...(resource.storageClass
      ? [["Storage class", resource.storageClass]]
      : []),
  ];
  return (
    <dialog
      ref={ref}
      className="drawer-dialog"
      aria-label={`${resource.kind} ${resource.name} details`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="drawer">
        <div className="drawer-header">
          <span className="eyebrow">
            <Glyph kind={resource.kind} /> RESOURCE DETAILS
          </span>
          <div className="resource-window-actions">
          <a className="button" href={window.location.pathname + window.location.search + writeInvestigation(route)} target="_blank" rel="noopener noreferrer" aria-label="Open resource in new tab"><ExternalLink size={16}/> Open in new tab</a>
          <button
            className="icon-button"
            aria-label="Close resource details"
            onClick={onClose}
          >
            <X size={20} />
          </button>
          </div>
        </div>
        <div className="drawer-heading">
          <span className="resource-icon large">
            <Glyph kind={resource.kind} size={25} />
          </span>
          <div>
            <h2>{resource.name}</h2>
            <p>
              {resource.kind} <span> / </span>{" "}
              {resource.namespace || "cluster scoped"}
            </p>
          </div>
        </div>
        <div className="drawer-status">
          <Badge good={healthy(resource)}>{resource.status || "Unknown"}</Badge>
          <span>{resource.restarts} restarts</span>
          <span>{age(resource.created)}</span>
        </div>
        <div
          className="tabs"
          role="tablist"
          aria-label="Resource detail sections"
        >
          {evidenceTabs.map((t) => (
            <button
              key={t}
              role="tab"
              tabIndex={tab === t ? 0 : -1}
              onKeyDown={(e) => {
                const tabs = evidenceTabs;
                let i = tabs.indexOf(t);
                if (e.key === "ArrowRight") i = (i + 1) % 4;
                else if (e.key === "ArrowLeft") i = (i + 3) % 4;
                else return;
                e.preventDefault();
                setTab(tabs[i]);
                const buttons =
                  e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    "button",
                  );
                buttons?.[i].focus();
              }}
              aria-selected={tab === t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Events" && <span className="count">{events.length}</span>}
            </button>
          ))}
        </div>
        <div className="drawer-content" role="tabpanel">
        <InvestigationContext
          resource={resource}
          resources={detailResources}
          route={route}
          onChange={onContext}
          onOpen={onOpen}
        />

 <AIExplanation key={snapshot.cluster + "/" + resource.uid + "/" + range} resource={resource} cluster={snapshot.cluster} range={range} resources={detailResources} onOpen={onOpen} />
          {tab === "Overview" ? (
            <>
              <InvestigationNextSteps
                resource={resource}
                resources={detailResources}
                onOpen={onOpen}
                onTab={setTab}
              />
              <div className="detail-metrics">
                <div>
                  <span>CPU usage</span>
                  <strong>
                    {resource.usage ? cpu(resource.usage.cpu) : "—"}
                    <small>
                      {resource.usage ? "cores / millicores" : "No measurement"}
                    </small>
                  </strong>
                </div>
                <div>
                  <span>Memory usage</span>
                  <strong>
                    {resource.usage ? bytes(resource.usage.memory) : "—"}
                    <small>
                      {resource.usage ? "working set" : "No measurement"}
                    </small>
                  </strong>
                </div>
              </div>
              <h3 className="section-label">RESOURCE DETAILS</h3>
              <dl className="metadata">
                {metadata.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {resource.kind.includes("Volume") && (
                <div className="notice">
                  <HardDrive size={17} />
                  <div>
                    <strong>
                      {resource.capacity
                        ? bytes(resource.capacity) + " capacity"
                        : "Capacity not reported"}
                    </strong>
                    <p>
                      Filesystem usage is unavailable from inventory. Requested
                      capacity is not a local-path quota.
                    </p>
                  </div>
                </div>
              )}
              {resource.containers.length > 0 && (
                <>
                  <h3 className="section-label">
                    CONTAINERS <span>{resource.containers.length}</span>
                  </h3>
                  {resource.containers.map((c) => (
                    <div className="container-card" key={c.name}>
                      <div>
                        <Box size={15} />
                        <strong>{c.name}</strong>
                        <Badge good={c.ready || c.state === "Completed"}>
                          {c.state}
                        </Badge>
                      </div>
                      <code>{c.image}</code>
                      <div className="container-budget">
                        <span>
                          CPU request / limit{" "}
                          <b>
                            {cpu(c.cpuRequest)} /{" "}
                            {c.cpuLimit ? cpu(c.cpuLimit) : "none"}
                          </b>
                        </span>
                        <span>
                          Memory request / limit{" "}
                          <b>
                            {bytes(c.memoryRequest)} /{" "}
                            {c.memoryLimit ? bytes(c.memoryLimit) : "none"}
                          </b>
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {groups.map((group) => (
                <section className="relationship-group" key={group.key}>
                  <h3 className="section-label">
                    {group.title}
                    <span>{group.items.length}</span>
                  </h3>
                  <p>{group.description}</p>
                  <div className="related-list">
                    {group.items.map((r) => (
                      <ResourceButton
                        key={r.uid}
                        resource={r}
                        onOpen={onOpen}
                      />
                    ))}
                  </div>
                </section>
              ))}
              <h3 className="section-label">LABELS</h3>
              <div className="labels">
                {Object.entries(resource.labels).map(([k, v]) => (
                  <code key={k}>
                    {k}
                    <span>=</span>
                    {v}
                  </code>
                ))}
                {!Object.keys(resource.labels).length && (
                  <span className="muted">No labels</span>
                )}
              </div>
            </>
          ) : tab === "Metrics" ? (
            <>
              {historyError && (
                <div className="notice warning">
                  <p>
                    History could not be loaded for this resource:{" "}
                    {historyError}
                  </p>
                </div>
              )}
              <div className="panel-heading">
                <h3>CPU usage</h3>
                <span className="muted">Actual collected samples</span>
              </div>
              <InteractiveChart points={history} />
              <div className="panel-heading">
                <h3>Memory working set</h3>
              </div>
              <InteractiveChart points={history} field="memory" />
              <div className="notice">
                <CircleHelp size={16} />
                <p>
                  Samples are held in a bounded, volatile memory buffer and
                  disappear on restart. CPU throttling and forecasts are not
                  available in this slice.
                </p>
              </div>
            </>
          ) : tab === "Logs" && range > 21600 ? (
            <Empty title="Logs support up to six hours" icon={Terminal}>
              Choose a supported window to keep logs, metrics, and events
              aligned.
              <button
                className="button"
                onClick={() => onContext({ range: 21600 })}
              >
                Use last 6 hours
              </button>
            </Empty>
          ) : tab === "Logs" && resource.deletedAt ? (
            <Empty title="Resource was deleted" icon={Terminal}>
              Log output was not persisted. Historical metric samples remain
              available until the memory buffer expires.
            </Empty>
          ) : tab === "Logs" ? (
            <LogsPanel
              key={resource.uid}
              pods={pods}
              initialPod={pods[0]}
              range={range}
              selection={{ pod: route.pod, container: route.container }}
              onSelection={(pod, container) => onContext({ pod, container })}
            />
          ) : (
            <EventList
              events={events}
              resources={detailResources}
              scopeResource={resource}
              onOpen={onOpen}
            />
          )}
        </div>
        <div className="drawer-footer">
          <GitBranch size={14} />
          Follow relationships as evidence. A shared node or volume is not a
          proven root cause.
        </div>
      </section>
    </dialog>
  );
}
function readRoute() {
  return readInvestigation(window.location.hash);
}
export function App() {
  const [route, setRoute] = useState(readRoute);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [query, setQuery] = useState("");
  const range = route.range;
  const setRange = (range: number) => navigate({ range });
  const [history, setHistory] = useState<Point[]>([]);

  const [command, setCommand] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [help, setHelp] = useState(false);
  const commandRef = useRef<HTMLDialogElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const navigate = (patch: Partial<InvestigationRoute>) => {
    const current = readRoute();
    const next = { ...current, ...patch };
    if (!next.resource) {
      next.trail = [];
      next.tab = "Overview";
      next.pod = "";
      next.container = "";
    }
    window.location.hash = writeInvestigation(next);
    if (
      (patch.view && patch.view !== route.view) ||
      (patch.namespace && patch.namespace !== route.namespace)
    )
      setQuery("");
  };
  useEffect(() => {
    const listener = () => setRoute(readRoute());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    document.title = `ClusterLens · ${route.view}`;
  }, [route.view]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.view, route.namespace]);
  useEffect(() => {
    const c = new AbortController();
    let active = true,
      loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      setBusy(true);
      try {
        const data = await getJSON<Snapshot>("/api/v1/snapshot", c.signal);
        if (active) {
          setSnapshot(data);
          setError("");
        }
      } catch (e) {
        if (active && !(e instanceof DOMException && e.name === "AbortError"))
          setError(String(e));
      } finally {
        loading = false;
        if (active) setBusy(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      c.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    const c = new AbortController();
    getJSON<{ points: Point[] }>(
      "/api/v1/history?" +
        new URLSearchParams({
          uid: "cluster",
          since: new Date(Date.now() - range * 1000).toISOString(),
        }),
      c.signal,
    )
      .then((d) => setHistory(d.points))
      .catch(() => setHistory([]));
    return () => c.abort();
  }, [snapshot?.timestamp, range]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommand((v) => !v);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (command) {
      setCommandQuery("");
      setCommandIndex(0);
      commandRef.current?.showModal();
    } else commandRef.current?.close();
  }, [command]);
  useEffect(() => {
    if (help) helpRef.current?.showModal();
    else helpRef.current?.close();
  }, [help]);
  const resources = snapshot?.resources || [];
  const eventResources = [...resources, ...(snapshot?.deletedResources || [])];
  const scoped = useMemo(
    () => filtered(resources, route.namespace, query),
    [resources, route.namespace, query],
  );
  const workloads = scoped.filter(isWorkload);
  const pods = scoped.filter((r) => r.kind === "Pod");
  const nodes = resources.filter((r) => r.kind === "Node");
  const volumes = scoped.filter(
    (r) => r.kind === "PersistentVolumeClaim" || r.kind === "PersistentVolume",
  );
  const namespaces = resources
    .filter((r) => r.kind === "Namespace")
    .map((r) => r.name);
  const events = (snapshot?.events || []).filter(
    (e) =>
      (route.namespace === "all" || e.namespace === route.namespace) &&
      new Date(e.timestamp).getTime() > Date.now() - range * 1000 &&
      `${e.name} ${e.reason} ${e.message}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selected = eventResources.find((r) => r.uid === route.resource);
  const onOpen = (r: Resource, tab?: EvidenceTab) =>
    navigate(followResource(readRoute(), r, tab));
  const connectionGood = !!snapshot?.connected && !error;
  const unsynced = snapshot?.sources.filter((s) => !s.synced || s.error) || [];
  const commandResults = resources
    .filter(
      (r) =>
        [
          "Pod",
          "Node",
          "Service",
          "PersistentVolumeClaim",
          ...Array.from(new Set(workloads.map((w) => w.kind))),
        ].includes(r.kind) &&
        `${r.name} ${r.namespace} ${r.kind}`
          .toLowerCase()
          .includes(commandQuery.toLowerCase()),
    )
    .slice(0, 12);
  const stale =
    !!snapshot && Date.now() - new Date(snapshot.timestamp).getTime() > 30000;
  const clearScope = () => {
    setQuery("");
    navigate({ namespace: "all" });
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#view=Overview&namespace=all"
          aria-label="ClusterLens overview"
        >
          <span className="brand-mark">
            <Boxes size={22} strokeWidth={1.7} />
          </span>
          <span>
            Cluster<span className="brand-light">Lens</span>
            <small>A CLEARER PERSPECTIVE</small>
          </span>
        </a>
        <button className="workspace-picker" onClick={() => setHelp(true)}>
          <span className="workspace-avatar">C</span>
          <span>
            <strong>{snapshot?.cluster || "Your cluster"}</strong>
            <small>Cluster intelligence</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${route.view === name ? "active" : ""}`}
              aria-current={route.view === name ? "page" : undefined}
              onClick={() => navigate({ view: name, resource: "" })}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === "Workloads" && snapshot && (
                <small>
                  {
                    resources.filter(
                      (r) =>
                        isWorkload(r) &&
                        (route.namespace === "all" ||
                          r.namespace === route.namespace),
                    ).length
                  }
                </small>
              )}
              {name === "Overview" && <i className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="local-note-icon">
              <ShieldCheck size={18} />
            </span>
            <strong>Your cluster. Your data.</strong>
            <p>
              Self-hosted by design.
              <br />
              Clarity without the cloud.
            </p>
            <button onClick={() => setHelp(true)}>
              About this workspace <ArrowUpRight size={13} />
            </button>
          </div>
          <button className="sidebar-help" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            About & capabilities
            <ArrowUpRight size={13} />
          </button>
          <div className="sidebar-cluster">
            <span
              className={`connection-light ${connectionGood ? "" : "offline"}`}
            />
            <span>
              <strong>{snapshot?.cluster || "clusterlens-local"}</strong>
              <small>
                {connectionGood
                  ? "Cluster connected"
                  : "Waiting for connection"}
              </small>
            </span>
            <span className="version">v0.1</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span className="breadcrumb-icon">
              <Network size={15} />
            </span>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{route.view}</strong>
          </div>
          <div className="topbar-actions">
            <button className="global-search" onClick={() => setCommand(true)}>
              <Search size={15} />
              <span>Jump to anything…</span>
              <kbd>⌘ K</kbd>
            </button>
            <ThemeToggle />
            <span className="topbar-divider" />
            <span className="local-badge">
              <i /> LOCAL
            </span>
            <button
              className="avatar"
              onClick={() => setHelp(true)}
              aria-label="Local workspace information"
            >
              CL
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-square" /> YOUR CLUSTER, SIMPLIFIED
              </div>
              <h1>
                {route.view === "Overview" ? "Cluster overview" : route.view}
              </h1>
              <p>{descriptions[route.view]}</p>
            </div>
            <div className="heading-actions">
              <button
                className="button refresh-button"
                onClick={() => setRefresh((n) => n + 1)}
                aria-label="Refresh cluster data"
                disabled={busy}
              >
                <RefreshCw size={15} className={busy ? "spin" : ""} />
              </button>
              <label className="select-wrap">
                <Layers3 size={14} />
                <select
                  aria-label="Namespace"
                  value={route.namespace}
                  onChange={(e) =>
                    navigate({ namespace: e.target.value, resource: "" })
                  }
                >
                  <option value="all">All namespaces</option>
                  {!namespaces.includes(route.namespace) &&
                    route.namespace !== "all" && (
                      <option value={route.namespace}>{route.namespace}</option>
                    )}
                  {namespaces.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </label>
              <label className="select-wrap time-select">
                <Activity size={14} />
                <select
                  aria-label="Telemetry time window"
                  value={range}
                  onChange={(e) => setRange(Number(e.target.value))}
                >
                  <option value={900}>Last 15 minutes</option>
                  <option value={3600}>Last hour</option>
                  <option value={21600}>Last 6 hours</option>
                  <option value={86400}>Last 24 hours</option>
                </select>
                <ChevronDown size={13} />
              </label>
            </div>
          </div>
          {error && (
            <div className="notice warning" role="alert">
              <TriangleAlert size={18} />
              <div>
                <strong>
                  {snapshot
                    ? "Connection interrupted · showing last snapshot"
                    : "Cannot reach ClusterLens"}
                </strong>
                <p>{error}. The dashboard retries every 10 seconds.</p>
              </div>
            </div>
          )}
          {snapshot && !snapshot.connected && (
            <div className="notice warning">
              <TriangleAlert size={18} />
              <div>
                <strong>Kubernetes connection unavailable</strong>
                <p>
                  {snapshot.connectionError ||
                    "Waiting for the first connection check."}
                </p>
              </div>
            </div>
          )}
          {unsynced.length > 0 && (
            <div className="notice warning">
              <TriangleAlert size={18} />
              <div>
                <strong>Inventory is incomplete</strong>
                <p>
                  {unsynced
                    .map(
                      (s) => `${s.kind}: ${s.error || "initial sync pending"}`,
                    )
                    .join(" · ")}
                </p>
              </div>
            </div>
          )}
          {snapshot && !snapshot.metrics.available && (
            <div className="notice warning">
              <Activity size={18} />
              <div>
                <strong>Metrics unavailable</strong>
                <p>
                  {snapshot.metrics.error || "Waiting for Metrics Server."}{" "}
                  Inventory and events remain available.
                </p>
              </div>
            </div>
          )}
          {snapshot?.truncated || snapshot?.historyDropped || stale ? (
            <div className="notice warning">
              <TriangleAlert size={17} />
              <p>
                {stale ? "Snapshot is stale. " : ""}
                {snapshot?.truncated
                  ? "Inventory response capped at 5,000 resources. "
                  : ""}
                {snapshot?.historyDropped
                  ? `${snapshot.historyDropped.toLocaleString()} oldest history points evicted at the memory limit.`
                  : ""}
              </p>
            </div>
          ) : null}
          {!snapshot ? (
            <div className="initial-state">
              <div className="loader-orbit">
                <Boxes size={28} />
              </div>
              <h2>
                {error
                  ? "Your cluster is a connection away."
                  : "Getting the full picture."}
              </h2>
              <p>
                {error
                  ? "Start the ClusterLens backend and check the cluster connection."
                  : "Discovering resources and connecting their signals…"}
              </p>
              <button
                className="button"
                onClick={() => setRefresh((n) => n + 1)}
              >
                <RefreshCw size={14} />
                Try again
              </button>
            </div>
          ) : (
            <>
              {route.view === "Overview" ? (
                <Overview
                  snapshot={snapshot}
                  namespace={route.namespace}
                  history={history}
                  error={error}
                  onOpen={onOpen}
                  onNavigate={(view, namespace = route.namespace) => navigate({ view, namespace, resource: "" })}
                />
              ) : route.view === "Forecasts" ? (
                <Forecasts snapshot={snapshot} namespace={route.namespace} error={error} onOpen={onOpen} />
              ) : route.view === "Storage" ? (
                <StorageView
                  key={route.namespace}
                  snapshot={snapshot}
                  namespace={route.namespace}
                  onOpen={onOpen}
                />
              ) : route.view === "Logs" ? (
                <section className="panel full-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>
                        <Terminal size={17} />
                        Container logs
                      </h3>
                      <p>
                        On-demand, timestamped output. Up to six hours, subject
                        to kubelet retention.
                      </p>
                    </div>
                    <span className="outline-badge">READ ONLY</span>
                  </div>
                  <LogsPanel pods={pods} range={range} />
                </section>
              ) : route.view === "Events" ? (
                <section className="panel full-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>
                        Kubernetes events{" "}
                        <span className="count">{events.length}</span>
                      </h3>
                      <p>
                        Filtered from the latest 200 cluster events available in
                        Kubernetes.
                      </p>
                    </div>
                    <label className="search-field">
                      <Search size={15} />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search events…"
                        aria-label="Search events"
                      />
                    </label>
                  </div>
                  <EventList
                    events={events}
                    resources={eventResources}
                    onOpen={(r) => onOpen(r, "Events")}
                  />
                </section>
              ) : (
                <>
                  <div className="inventory-summary">
                    <span>
                      <span className="dot green" />
                      {route.view === "Workloads"
                        ? `${workloads.length} workloads discovered`
                        : route.view === "Nodes"
                          ? `${nodes.length} nodes discovered`
                          : `${volumes.filter((r) => r.kind === "PersistentVolumeClaim").length} claims · ${resources.filter((r) => r.kind === "PersistentVolume").length} volumes`}
                    </span>
                    <label className="search-field">
                      <Search size={15} />
                      <input
                        aria-label={`Search ${route.view.toLowerCase()}`}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={`Search ${route.view.toLowerCase()}…`}
                      />
                      {query && (
                        <button
                          className="icon-button"
                          aria-label="Clear search"
                          onClick={() => setQuery("")}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </label>
                  </div>
                  <section className="panel full-panel">
                    <ResourceTable
                      resources={
                        route.view === "Workloads"
                          ? workloads
                          : scoped.filter((r) => r.kind === "Node")
                      }
                      onOpen={onOpen}
                      mode={route.view === "Nodes" ? "node" : "workload"}
                    />
                  </section>
                  {!scoped.length && (
                    <button className="button" onClick={clearScope}>
                      Clear filters and show all namespaces
                    </button>
                  )}
                </>
              )}
              <footer className="page-footer">
                <span>
                  <span
                    className={`dot ${connectionGood ? "green" : "yellow"}`}
                  />
                  {stale
                    ? "Stale snapshot"
                    : `Updated ${age(snapshot.timestamp)}`}
                  <span className="footer-dot">·</span>Auto-refresh every 10s
                </span>
                <span>
                  Built for clarity. <Boxes size={13} />
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {selected && snapshot && (
        <DetailDrawer
          resource={selected}
          snapshot={snapshot}
          onOpen={onOpen}
          onClose={() => navigate({ resource: "" })}
          range={range}
          route={route}
          onContext={navigate}
        />
      )}
      {route.resource && snapshot && !selected && (
        <div className="resource-missing notice warning" role="alert">
          <TriangleAlert size={18} />
          <p>
            Resource no longer in inventory. It may have been deleted or
            discovery is incomplete.
          </p>
          {route.trail.length > 1 && (
            <button
              className="button"
              onClick={() =>
                navigate({
                  resource: route.trail[route.trail.length - 2],
                  trail: route.trail.slice(0, -1),
                })
              }
            >
              Previous resource
            </button>
          )}
          <button className="button" onClick={() => navigate({ resource: "" })}>
            End investigation
          </button>
        </div>
      )}
      <dialog
        className="command-dialog"
        aria-label="Jump to a resource"
        ref={commandRef}
        onCancel={() => setCommand(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setCommand(false);
        }}
      >
        <div className="command-input">
          <Search size={20} />
          <input
            autoFocus
            aria-label="Search all cluster resources"
            value={commandQuery}
            onChange={(e) => {
              setCommandQuery(e.target.value);
              setCommandIndex(0);
            }}
            placeholder="Where do you want to go?"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCommandIndex((i) =>
                  Math.min(commandResults.length - 1, i + 1),
                );
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setCommandIndex((i) => Math.max(0, i - 1));
              }
              if (e.key === "Enter" && commandResults[commandIndex]) {
                onOpen(commandResults[commandIndex]);
                setCommand(false);
              }
            }}
          />
          <button className="key-button" onClick={() => setCommand(false)}>
            esc
          </button>
        </div>
        <p className="section-label">
          JUMP TO A RESOURCE <span>{commandResults.length} shown</span>
        </p>
        <div className="command-results">
          {commandResults.map((r, i) => (
            <button
              key={r.uid}
              className={commandIndex === i ? "selected" : ""}
              onClick={() => {
                onOpen(r);
                setCommand(false);
              }}
            >
              <Glyph kind={r.kind} />
              <span>
                <strong>{r.name}</strong>
                <small>
                  {r.namespace || "cluster scoped"} · {r.kind}
                </small>
              </span>
              <ArrowUpRight size={15} />
            </button>
          ))}
          {!commandResults.length && (
            <Empty title="No matching resources">
              Try a pod, workload, node, or volume name.
            </Empty>
          )}
        </div>
        <div className="command-footer">
          <span>↑ ↓ to navigate</span>
          <span>↵ to inspect</span>
          <span>esc to close</span>
        </div>
      </dialog>
      <dialog
        className="help-dialog"
        aria-label="About ClusterLens"
        ref={helpRef}
        onCancel={() => setHelp(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setHelp(false);
        }}
      >
        <button
          className="icon-button help-close"
          onClick={() => setHelp(false)}
          aria-label="Close workspace information"
        >
          <X size={20} />
        </button>
        <span className="brand-mark">
          <Boxes size={24} />
        </span>
        <span className="eyebrow">CLUSTERLENS / LOCAL WORKSPACE</span>
        <h2>
          A clearer view
          <br />
          of your cluster.
        </h2>
        <p>
          Live discovery, real resource metrics, correlated Kubernetes events,
          and bounded container logs. No telemetry is sent to an external
          service.
        </p>
        <div className="capability-list">
          {[
            ["Inventory", "Watch-based Kubernetes resource discovery"],
            ["Metrics", "Metrics Server · 15s collection · volatile history"],
            ["Logs", "On-demand pod log API · 500 lines / 256 KiB"],
            ["Storage", "Claims, volumes, classes, and relationships"],
            [
              "Coming later",
              "Durable history, node log collection, throttling, AI",
            ],
          ].map(([k, v]) => (
            <div key={k}>
              <strong>{k}</strong>
              <span>{v}</span>
            </div>
          ))}
        </div>
        <div className="notice">
          <ShieldCheck size={17} />
          <p>
            This local demo has no authentication. Keep it on localhost or
            behind a local port forward.
          </p>
        </div>
        <button
          className="button"
          onClick={() => {
            setHelp(false);
            setCommand(true);
          }}
        >
          <Command size={15} />
          Explore resources <kbd>⌘ K</kbd>
        </button>
      </dialog>
    </div>
  );
}
