import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Compass,
  GitBranch,
} from "lucide-react";
import type { Resource } from "./types";
import type { EvidenceTab, InvestigationRoute } from "./investigation";
import { relationshipGroups, suggestedChecks } from "./investigation";
export function InvestigationContext({
  resource,
  resources,
  route,
  onChange,
  onOpen,
}: {
  resource: Resource;
  resources: Resource[];
  route: InvestigationRoute;
  onChange: (patch: Partial<InvestigationRoute>) => void;
  onOpen: (r: Resource, tab?: EvidenceTab) => void;
}) {
  const groups = relationshipGroups(resource, resources);
  return (
    <div className="investigation-context">
      <div className="investigation-bar">
        <span>
          <Compass size={14} />
          INVESTIGATION
        </span>
        <label>
          Window
          <select
            aria-label="Investigation time window"
            value={route.range}
            onChange={(e) => onChange({ range: Number(e.target.value) })}
          >
            <option value={900}>Last 15 minutes</option>
            <option value={3600}>Last hour</option>
            <option value={21600}>Last 6 hours</option>
            <option value={86400}>Last 24 hours</option>
          </select>
        </label>
      </div>
      <label className="investigation-pivot">
        Connected resource
        <select
          aria-label="Follow a related resource"
          value=""
          onChange={(e) => {
            const next = resources.find((r) => r.uid === e.target.value);
            if (next) onOpen(next);
          }}
        >
          <option value="">Follow a connection…</option>
          {groups.map((group) => (
            <optgroup key={group.key} label={group.title}>
              {group.items.map((r) => (
                <option value={r.uid} key={r.uid}>
                  {r.name} · {r.kind}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <nav className="investigation-trail" aria-label="Investigation trail">
        {route.trail.map((uid, i) => {
          const r = resources.find((r) => r.uid === uid);
          return (
            <span key={uid}>
              {i > 0 && <ChevronRight size={12} />}
              <button
                aria-current={i === route.trail.length - 1 ? "step" : undefined}
                disabled={i === route.trail.length - 1}
                onClick={() =>
                  onChange({
                    resource: uid,
                    trail: route.trail.slice(0, i + 1),
                  })
                }
              >
                {r?.name || "Unavailable resource"}
                {r?.deletedAt && <small>deleted</small>}
              </button>
            </span>
          );
        })}
      </nav>
      <div className="investigation-scope">
        {route.trail.length > 1 ? (
          <button
            onClick={() =>
              onChange({
                resource: route.trail[route.trail.length - 2],
                trail: route.trail.slice(0, -1),
              })
            }
          >
            <ArrowLeft size={13} />
            Previous resource
          </button>
        ) : (
          <span>Start here, then follow the connected evidence.</span>
        )}
        <span>{route.tab} · same rolling time range</span>
      </div>
    </div>
  );
}
export function InvestigationNextSteps({
  resource,
  resources,
  onOpen,
  onTab,
}: {
  resource: Resource;
  resources: Resource[];
  onOpen: (r: Resource, tab?: EvidenceTab) => void;
  onTab: (t: EvidenceTab) => void;
}) {
  const checks = suggestedChecks(resource, resources);
  return (
    <section className="investigation-next">
      <h3>
        <GitBranch size={15} />
        Continue the investigation
      </h3>
      <p>
        Suggested checks from observed relationships. These are not root-cause
        conclusions.
      </p>
      <div>
        {checks.map((check) => (
          <button
            key={check.resource.uid}
            onClick={() => onOpen(check.resource, "Overview")}
          >
            <span>
              <strong>{check.title}</strong>
              <small>
                {check.resource.name} · {check.reason}
              </small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
      </div>
      <div className="investigation-signals">
        <button onClick={() => onTab("Metrics")}>Inspect metrics</button>
        <button onClick={() => onTab("Logs")}>Read scoped logs</button>
        <button onClick={() => onTab("Events")}>Review related events</button>
      </div>
    </section>
  );
}
