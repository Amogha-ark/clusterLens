import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Cpu,
  HardDrive,
  Layers3,
} from "lucide-react";
import type { Point, Resource, Snapshot } from "./types";
import { bytes, filtered } from "./lib";
import {
  contributors,
  storageComplete,
  volumeMappings,
} from "./insights";
import { InteractiveChart } from "./InteractiveChart";
import { HealthOverview } from "./HealthOverview";

export function Overview({
  snapshot,
  namespace,
  history,
  error,
  onOpen,
  onNavigate,
}: {
  snapshot: Snapshot;
  namespace: string;
  history: Point[];
  error: string;
  onOpen: (r: Resource) => void;
  onNavigate: (view: "Workloads" | "Nodes" | "Storage" | "Events", namespace?: string) => void;
}) {
  const [metric, setMetric] = useState<"cpu" | "memory">("cpu");
  const scoped = filtered(snapshot.resources, namespace);
  const ranking = contributors(scoped, metric);
  const mappings = volumeMappings(
    scoped
      .filter((r) => r.kind === "PersistentVolumeClaim")
      .concat(
        snapshot.resources.filter((r) => r.kind !== "PersistentVolumeClaim"),
      ),
    storageComplete(snapshot),
  );
  const used = mappings.filter((m) => m.state === "In use").length,
    unused = mappings.filter((m) => m.state === "Unattached").length,
    review = mappings.filter((m) => m.review).length;
  const latest = history.at(-1)?.[metric];
  const top = ranking.rows[0];
  return (
    <div className="executive-overview">
      <HealthOverview snapshot={snapshot} error={error} onOpen={onOpen} onNavigate={view => onNavigate(view, 'all')} />
      <div className="overview-section-title">
        <div>
          <span className="overline">RESOURCE PERSPECTIVE</span>
          <h2>What’s using your resources?</h2>
          <p>See the biggest contributors, then explore the details.</p>
        </div>
        <div className="segmented" aria-label="Resource metric">
          {(["cpu", "memory"] as const).map((m) => (
            <button
              key={m}
              aria-pressed={metric === m}
              className={metric === m ? "active" : ""}
              onClick={() => setMetric(m)}
            >
              {m === "cpu" ? "CPU" : "Memory"}
            </button>
          ))}
        </div>
      </div>
      <div className="insight-grid">
        <section className="panel contributors-panel">
          <div className="panel-heading">
            <div>
              <h3>Top workloads</h3>
              <p>
                {namespace === "all" ? "Across all namespaces" : namespace} ·
                ranked by {metric === "cpu" ? "CPU" : "memory"} use
              </p>
            </div>
            <button
              className="text-button"
              onClick={() => onNavigate("Workloads")}
            >
              View all
              <ArrowUpRight size={16} />
            </button>
          </div>
          {ranking.rows.length ? (
            <>
              <div className="contributor-list">
                {ranking.rows
                  .slice(0, 5)
                  .map(({ resource, value, share }, i) => (
                    <button
                      className="contributor"
                      key={resource.uid}
                      onClick={() => onOpen(resource)}
                    >
                      <span className={`rank-icon rank-${i}`}>
                        <Layers3 size={18} />
                      </span>
                      <span className="contributor-body">
                        <span className="contributor-title">
                          <strong>{resource.name}</strong>
                          <span>
                            {(share * 100).toFixed(1)}%
                            <small>
                              {metric === "cpu"
                                ? `${value.toFixed(3)} cores`
                                : bytes(value)}
                            </small>
                          </span>
                        </span>
                        <span className="contribution-track">
                          <i style={{ width: `${share * 100}%` }} />
                        </span>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
              </div>
              <div className="ranking-note">
                <span className="dot lavender" />
                <span>
                  Share of measured workload{" "}
                  {metric === "cpu" ? "CPU" : "memory"} · {ranking.measured}/
                  {ranking.count} measured
                </span>
              </div>
            </>
          ) : (
            <div className="empty">
              <Cpu size={26} />
              <h3>
                {ranking.count
                  ? "Waiting for usage data"
                  : "No workloads in this scope"}
              </h3>
              <p>
                {ranking.count
                  ? "Rankings appear when workload metrics are available."
                  : "Choose another namespace to see its workloads."}
              </p>
            </div>
          )}
        </section>
        <section className="panel trend-panel">
          <div className="panel-heading">
            <div>
              <h3>Cluster {metric === "cpu" ? "CPU" : "memory"} trend</h3>
              <p>Actual measurements, over time</p>
            </div>
            <span className="subtle-live">
              {snapshot.connected && snapshot.metrics.available && !error ? 'Current telemetry' : 'Telemetry unavailable'}
            </span>
          </div>
          <div className="trend-reading">
            <strong>
              {latest === undefined
                ? "—"
                : metric === "cpu"
                  ? latest.toFixed(2)
                  : bytes(latest).split(" ")[0]}
              <small>
                {metric === "cpu"
                  ? "cores"
                  : latest === undefined
                    ? ""
                    : bytes(latest).split(" ")[1]}
              </small>
            </strong>
            <span>Most recent sample</span>
          </div>
          <InteractiveChart points={history} field={metric} />
          <div className="trend-note">
            Cluster-wide · gaps mean missing data
          </div>
        </section>
      </div>
      <section className="panel storage-summary">
        <div className="storage-summary-lead">
          <span className="storage-bubble">
            <HardDrive size={24} />
          </span>
          <div>
            <h3>Storage, accounted for.</h3>
            <p>
              {mappings.length
                ? `${mappings.length} volume claims in ${namespace === "all" ? "all namespaces" : "this namespace"}. Know what’s used and what needs a look.`
                : "No volume claims in this scope."}
            </p>
          </div>
        </div>
        <div className="storage-mini-counts">
          <span>
            <strong>{used}</strong>
            <small>In use</small>
          </span>
          <span className={unused ? "amber-text" : ""}>
            <strong>{unused}</strong>
            <small>Unattached</small>
          </span>
          {review > 0 && (
            <span className="amber-text">
              <strong>{review}</strong>
              <small>Review suggested</small>
            </span>
          )}
          {mappings.some((m) => m.state === "Unknown") && (
            <span>
              <strong>—</strong>
              <small>Mapping incomplete</small>
            </span>
          )}
        </div>
        <button
          className="button soft-button"
          onClick={() => onNavigate("Storage")}
        >
          Explore storage
          <ArrowRight size={15} />
        </button>
      </section>
      {top && (
        <p className="overview-footnote">
          <Check size={13} />
          <span>
            <strong>{top.resource.name}</strong> is the largest measured{" "}
            {metric === "cpu" ? "CPU" : "memory"} contributor in this scope.
            High usage alone does not indicate a problem.
          </span>
        </p>
      )}
    </div>
  );
}
