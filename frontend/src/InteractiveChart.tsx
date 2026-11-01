import { useId, useState } from "react";
import { Activity } from "lucide-react";
import type { Point } from "./types";
import { bytes } from "./lib";
import { nearestPointIndex } from "./insights";

export function InteractiveChart({
  points,
  field = "cpu",
}: {
  points: Point[];
  field?: "cpu" | "memory";
}) {
  const id = useId().replace(/:/g, "");
  const [index, setIndex] = useState<number | null>(null);
  const values = points.filter(
    (p) =>
      Number.isFinite(p[field]) &&
      Number.isFinite(new Date(p.timestamp).getTime()),
  );
  if (values.length < 2)
    return (
      <div className="chart-warm">
        <Activity size={26} />
        <strong>Building your trend</strong>
        <span>
          Real measurements arrive every 15 seconds. Your graph appears after
          two samples.
        </span>
      </div>
    );
  const width = 680,
    height = 190,
    pad = 10;
  const start = new Date(values[0].timestamp).getTime(),
    end = new Date(values[values.length - 1].timestamp).getTime();
  const max =
    Math.max(...values.map((p) => p[field]), field === "cpu" ? 0.01 : 1048576) *
    1.2;
  const coords = values.map((p) => ({
    x:
      pad +
      ((new Date(p.timestamp).getTime() - start) / Math.max(1, end - start)) *
        (width - pad * 2),
    y: height - pad - (p[field] / max) * (height - pad * 2),
  }));
  const line = coords
    .map(
      (p, i) =>
        `${i && new Date(values[i].timestamp).getTime() - new Date(values[i - 1].timestamp).getTime() <= 45000 ? "L" : "M"}${p.x},${p.y}`,
    )
    .join(" ");
  const selected = index === null ? null : Math.min(index, values.length - 1);
  const active = selected === null ? null : values[selected];
  const position = selected === null ? null : coords[selected];
  const format = (value: number) =>
    field === "cpu" ? `${value.toFixed(3)} cores` : bytes(value, 2);
  const update = (clientX: number, rect: DOMRect) =>
    setIndex(
      nearestPointIndex(
        values,
        (((clientX - rect.left) / rect.width) * width - pad) /
          (width - pad * 2),
      ),
    );
  return (
    <div className="interactive-chart">
      <div className="chart-axis">
        <span>{field === "cpu" ? `${max.toFixed(2)} cores` : bytes(max)}</span>
        <span>{field === "cpu" ? (max / 2).toFixed(2) : bytes(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="plot-wrap" onPointerLeave={() => setIndex(null)}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="slider"
          tabIndex={0}
          aria-label={`${field === "cpu" ? "CPU" : "Memory"} history. Use left and right arrows to inspect measurements.`}
          aria-valuemin={0}
          aria-valuemax={values.length - 1}
          aria-valuenow={selected ?? values.length - 1}
          aria-valuetext={`${new Date((active ?? values[values.length - 1]).timestamp).toLocaleTimeString()}: ${format((active ?? values[values.length - 1])[field])}`}
          onPointerMove={(e) =>
            update(e.clientX, e.currentTarget.getBoundingClientRect())
          }
          onPointerDown={(e) =>
            update(e.clientX, e.currentTarget.getBoundingClientRect())
          }
          onFocus={() => setIndex(values.length - 1)}
          onBlur={() => setIndex(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setIndex((i) => Math.max(0, (i ?? values.length - 1) - 1));
            }
            if (e.key === "ArrowRight") {
              e.preventDefault();
              setIndex((i) => Math.min(values.length - 1, (i ?? -1) + 1));
            }
            if (e.key === "Home") {
              e.preventDefault();
              setIndex(0);
            }
            if (e.key === "End") {
              e.preventDefault();
              setIndex(values.length - 1);
            }
            if (e.key === "Escape") setIndex(null);
          }}
        >
          <defs>
            <linearGradient id={`gradient-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity=".18" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.1, 0.5, 0.9].map((f) => (
            <line
              key={f}
              x1={0}
              x2={width}
              y1={height * f}
              y2={height * f}
              stroke="var(--chart-grid)"
              strokeDasharray="3 6"
            />
          ))}
          {coords.map((p, i) =>
            i &&
            new Date(values[i].timestamp).getTime() -
              new Date(values[i - 1].timestamp).getTime() <=
              45000 ? (
              <path
                key={i}
                d={`M${coords[i - 1].x},${height} L${coords[i - 1].x},${coords[i - 1].y} L${p.x},${p.y} L${p.x},${height} Z`}
                fill={`url(#gradient-${id})`}
              />
            ) : null,
          )}
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {position ? (
            <>
              <line
                x1={position.x}
                x2={position.x}
                y1={0}
                y2={height}
                stroke="currentColor"
                strokeOpacity=".4"
                strokeDasharray="4 4"
              />
              <circle
                cx={position.x}
                cy={position.y}
                r={7}
                fill="var(--panel)"
                stroke="currentColor"
                strokeWidth={2.5}
              />
            </>
          ) : (
            <circle
              cx={coords[coords.length - 1].x}
              cy={coords[coords.length - 1].y}
              r={4}
              fill="currentColor"
            />
          )}
        </svg>
        {active && position && (
          <div
            className={`chart-tooltip ${position.x > width * 0.65 ? "align-right" : ""}`}
            style={{
              left: `${Math.max(3, Math.min(97, (position.x / width) * 100))}%`,
            }}
            role="status"
          >
            <span>
              {new Date(active.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <strong>{format(active[field])}</strong>
            <small>Observed measurement</small>
          </div>
        )}
        <div className="chart-times">
          <span>
            {new Date(start).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span>Hover or use arrow keys</span>
          <span>
            {new Date(end).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
