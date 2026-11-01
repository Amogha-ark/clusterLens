import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Box,
  ChevronRight,
  Database,
  HardDrive,
  Layers3,
  Search,
  Server,
} from "lucide-react";
import type { Resource, Snapshot } from "./types";
import { age, bytes } from "./lib";
import { storageComplete, volumeMappings } from "./insights";

type Filter = "All volumes" | "In use" | "Unattached" | "Review suggested";
export function StorageView({
  snapshot,
  namespace,
  onOpen,
}: {
  snapshot: Snapshot;
  namespace: string;
  onOpen: (r: Resource) => void;
}) {
  const [filter, setFilter] = useState<Filter>("All volumes");
  const [query, setQuery] = useState("");
  const mappings = useMemo(
    () =>
      volumeMappings(snapshot.resources, storageComplete(snapshot)).filter(
        (m) => namespace === "all" || m.claim.namespace === namespace,
      ),
    [snapshot, namespace],
  );
  const counts = {
    "All volumes": mappings.length,
    "In use": mappings.filter((m) => m.state === "In use").length,
    Unattached: mappings.filter((m) => m.state === "Unattached").length,
    "Review suggested": mappings.filter((m) => m.review).length,
  };
  const rows = mappings.filter(
    (m) =>
      (filter === "All volumes" || filter === "Review suggested"
        ? filter === "All volumes" || m.review
        : m.state === filter) &&
      [
        m.claim.name,
        m.claim.namespace,
        ...m.pods.map((p) => p.name),
        ...m.workloads.map((w) => w.name),
        ...m.nodes,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="storage-view">
      <div className="storage-intro">
        <span className="storage-bubble">
          <HardDrive size={26} />
        </span>
        <div>
          <h2>Know where every volume belongs.</h2>
          <p>
            Follow each claim to its workload and pods. Spot unreferenced
            storage before you investigate further.
          </p>
        </div>
      </div>
      <p className="storage-capability">
        <Activity size={15} />
        <span>
          <strong>Storage health telemetry is not connected.</strong> Disk
          utilization, Ceph health, and OSD status are not monitored yet.
        </span>
      </p>
      <div className="storage-toolbar">
        <div className="filter-pills" aria-label="Volume usage filter">
          {(Object.keys(counts) as Filter[]).map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              className={filter === f ? "active" : ""}
              onClick={() => setFilter(f)}
            >
              {f}
              <span>{counts[f]}</span>
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search volumes, workloads, or pods"
            placeholder="Find a volume, workload, or pod…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {!storageComplete(snapshot) && (
        <div className="notice warning">
          <p>
            Pod or claim discovery is incomplete. Usage is marked unknown until
            mappings can be verified.
          </p>
        </div>
      )}
      <section className="volume-list" aria-label="Volume to pod mappings">
        {rows.map((m) => (
          <article className="volume-card" key={m.claim.uid}>
            <div className="volume-identity">
              <span className="volume-icon">
                <HardDrive size={22} />
              </span>
              <button onClick={() => onOpen(m.claim)}>
                <strong>{m.claim.name}</strong>
                <span>
                  {m.claim.namespace} ·{" "}
                  {m.claim.capacity
                    ? bytes(m.claim.capacity)
                    : "Capacity pending"}
                </span>
              </button>
            </div>
            <div className="volume-connection">
              <span className="connection-arrow">
                <ArrowRight size={19} />
              </span>
              <div>
                {m.pods.length ? (
                  <>
                    <span className="connection-label">USED BY</span>
                    <div className="volume-workloads">
                      {m.workloads.map((w) => (
                        <button key={w.uid} onClick={() => onOpen(w)}>
                          <Layers3 size={14} />
                          {w.name}
                          <ArrowUpRight size={12} />
                        </button>
                      ))}
                    </div>
                    <div className="volume-pods">
                      {m.pods.slice(0, 2).map((p) => (
                        <button key={p.uid} onClick={() => onOpen(p)}>
                          <Box size={13} />
                          {p.name}
                          {p.node && (
                            <span>
                              on {p.node.replace("k3d-clusterlens-", "")}
                            </span>
                          )}
                        </button>
                      ))}
                      {m.pods.length > 2 && (
                        <button onClick={() => onOpen(m.claim)}>
                          +{m.pods.length - 2} more pods
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <span className="connection-label">
                      {m.state === "Unknown"
                        ? "MAPPING UNAVAILABLE"
                        : "NO ACTIVE POD REFERENCES"}
                    </span>
                    <p>
                      {m.review
                        ? "Older claim with no active pod references. Review its purpose."
                        : m.state === "Waiting for storage"
                          ? "Waiting for a storage volume to bind."
                          : m.state === "Unknown"
                            ? "Discovery needs to finish before usage is known."
                            : "May be intentionally retained for a scaled-down workload."}
                    </p>
                  </>
                )}
              </div>
            </div>
            <div className="volume-outcome">
              <span
                className={`usage-badge ${m.state === "In use" ? "used" : m.state === "Unknown" ? "unknown" : "unused"}`}
              >
                <i />
                {m.state}
              </span>
              {m.review && (
                <span className="review-label">Review suggested</span>
              )}
              <button
                className="icon-button"
                onClick={() => onOpen(m.claim)}
                aria-label={`View ${m.claim.name} mapping details`}
              >
                <ChevronRight size={19} />
              </button>
            </div>
          </article>
        ))}
      </section>
      {!rows.length && (
        <div className="empty panel">
          <HardDrive size={28} />
          <h3>
            {query
              ? "No matching volumes"
              : filter === "All volumes"
                ? "No volume claims here"
                : `No ${filter.toLowerCase()} volumes`}
          </h3>
          <p>
            {filter === "Unattached"
              ? "Every discovered claim in this scope has an active pod reference, or is in another state."
              : "Try another filter or namespace."}
          </p>
        </div>
      )}
      <p className="storage-explainer">
        <span>What these labels mean</span>“In use” means a current,
        non-completed pod references the claim; it does not verify a physical
        CSI mount. “Unattached” means no such pod reference was found. Review
        suggestions identify unattached claims created at least 7 days ago—not
        proven stale data. Last-use time and used bytes are not available.
      </p>
      <details className="technical-inventory panel">
        <summary>
          <span>
            <Database size={17} />
            Technical inventory
          </span>
          <span>
            Volumes & storage classes
            <ChevronRight size={16} />
          </span>
        </summary>
        <div className="technical-links">
          {snapshot.resources
            .filter(
              (r) => r.kind === "PersistentVolume" || r.kind === "StorageClass",
            )
            .map((r) => (
              <button key={r.uid} onClick={() => onOpen(r)}>
                <Database size={15} />
                <span>
                  <strong>{r.name}</strong>
                  <small>
                    {r.kind} · {r.storageClass || r.provisioner || r.status}
                  </small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
        </div>
      </details>
    </div>
  );
}
