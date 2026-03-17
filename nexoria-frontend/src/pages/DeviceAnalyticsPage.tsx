// src/pages/DeviceAnalyticsPage.tsx

import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fetchDeviceBatteryTrend,
  fetchDeviceTemperatureTrend,
} from "../utils/analyticsAgent";

import type { TrendPoint, TrendResponse } from "../utils/analyticsAgent";

function LineChart({
  points,
  valueKey,
  title,
  unit,
  valueLabel,
}: {
  points: TrendPoint[];
  valueKey: "avg";
  title: string;
  unit?: string;
  valueLabel?: string;
}) {
  const width = 900;
  const height = 260;

  const padL = 44;
  const padR = 16;
  const padT = 18;
  const padB = 34;

  const vals = points
    .map((p) => p[valueKey])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const hasData = vals.length > 0;

  let minV = hasData ? Math.min(...vals) : 0;
  let maxV = hasData ? Math.max(...vals) : 1;

  if (hasData && Math.abs(maxV - minV) < 1e-9) {
    minV = minV - 1;
    maxV = maxV + 1;
  }

  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xStep = points.length > 1 ? plotW / (points.length - 1) : 0;

  const x = (i: number) => padL + i * xStep;

  const y = (v: number) => {
    const denom = maxV - minV || 1;
    const norm = (v - minV) / denom;
    return padT + (1 - norm) * plotH;
  };

  const path = useMemo(() => {
    if (!hasData || points.length === 0) return "";

    const segments: string[] = [];
    let started = false;

    for (let i = 0; i < points.length; i++) {
      const v = points[i][valueKey];
      if (typeof v !== "number" || !Number.isFinite(v)) {
        started = false;
        continue;
      }
      const cmd = started ? "L" : "M";
      segments.push(`${cmd} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`);
      started = true;
    }

    return segments.join(" ");
  }, [points, hasData, minV, maxV]);

  const lastPoint = [...points].reverse().find((p) => typeof p.avg === "number");
  const lastVal =
    lastPoint && typeof lastPoint.avg === "number"
      ? `${lastPoint.avg.toFixed(1)}${unit ?? ""}`
      : "-";

  const ticks = hasData ? [minV, (minV + maxV) / 2, maxV] : [0, 0.5, 1];

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;

    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const startLabel = points[0]?.t ? formatTime(points[0].t) : "";
  const endLabel = points[points.length - 1]?.t
    ? formatTime(points[points.length - 1].t)
    : "";

  const [hover, setHover] = useState<{ i: number; cx: number; cy: number } | null>(null);

  const renderTooltip = () => {
    if (!hover) return null;
    const p = points[hover.i];
    const v = p?.[valueKey];
    if (!p || typeof v !== "number" || !Number.isFinite(v)) return null;

    let tx = hover.cx + 10;
    let ty = hover.cy - 12;

    const boxW = 210;
    const boxH = 48;

    if (tx + boxW > width - padR) tx = width - padR - boxW;
    if (ty - boxH < padT) ty = padT + boxH;

    return (
      <g>
        {/* vertical guide */}
        <line
          x1={hover.cx}
          y1={padT}
          x2={hover.cx}
          y2={height - padB}
          stroke="#111"
          opacity={0.15}
          strokeWidth="1"
        />

        <rect x={tx} y={ty - boxH} width={boxW} height={boxH} rx={8} fill="#111" opacity={0.92} />
        <text x={tx + 10} y={ty - boxH + 18} fontSize="12" fill="#fff">
          {formatTime(p.t)}
        </text>
        <text x={tx + 10} y={ty - boxH + 36} fontSize="12" fill="#fff">
          {(valueLabel ?? "Value") + ": "} {v.toFixed(1)}
          {unit ?? ""}
        </text>
      </g>
    );
  };

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 12,
        padding: 12,
        marginBottom: 16,
        background: "white",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            latest: <b>{lastVal}</b>, points: {points.length}
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          min: {minV.toFixed(1)}, max: {maxV.toFixed(1)}
        </div>
      </div>

      <svg
        width={width}
        height={height}
        style={{ width: "100%", height: "auto", marginTop: 10 }}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={padL} y1={padT} x2={padL} y2={height - padB} stroke="#bbb" strokeWidth="1" />
        <line x1={padL} y1={height - padB} x2={width - padR} y2={height - padB} stroke="#bbb" strokeWidth="1" />

        {ticks.map((tv, idx) => {
          const yy = y(tv);
          return (
            <g key={idx}>
              <line x1={padL} y1={yy} x2={width - padR} y2={yy} stroke="#eee" strokeWidth="1" />
              <text x={padL - 8} y={yy + 4} fontSize="11" textAnchor="end" fill="#666">
                {tv.toFixed(1)}
              </text>
            </g>
          );
        })}

        {path ? <path d={path} fill="none" stroke="#111" strokeWidth="2.5" /> : null}

        {points.map((p, i) => {
          const v = p[valueKey];
          if (typeof v !== "number" || !Number.isFinite(v)) return null;
          const cx = x(i);
          const cy = y(v);

          return (
            <g key={i}>
              <circle
                cx={cx}
                cy={cy}
                r="10"
                fill="transparent"
                onMouseEnter={() => setHover({ i, cx, cy })}
                onMouseMove={() => setHover({ i, cx, cy })}
              />
              <circle cx={cx} cy={cy} r="3.5" fill="#111" />
            </g>
          );
        })}

        {renderTooltip()}

        <text x={padL} y={height - 10} fontSize="11" fill="#666">
          {startLabel}
        </text>
        <text x={width - padR} y={height - 10} fontSize="11" textAnchor="end" fill="#666">
          {endLabel}
        </text>
      </svg>
    </div>
  );
}

export default function DeviceAnalyticsPage() {
  const { id } = useParams();
  const serial = id || "";

  const [battery, setBattery] = useState<TrendResponse | null>(null);
  const [temp, setTemp] = useState<TrendResponse | null>(null);
  const [err, setErr] = useState<string>("");

  const window_hours = 24;
  const bucket_minutes = 10;

  async function load() {
    try {
      setErr("");
      const [b, t] = await Promise.all([
        fetchDeviceBatteryTrend(serial, { window_hours, bucket_minutes }),
        fetchDeviceTemperatureTrend(serial, { window_hours, bucket_minutes }),
      ]);
      setBattery(b);
      setTemp(t);
    } catch (e: any) {
      setErr(e?.message || "Failed to load trends");
    }
  }

  useEffect(() => {
    if (!serial) return;
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [serial]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>Device analytics</h2>
          <div style={{ fontSize: 13, opacity: 0.8 }}>Serial: {serial}</div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-ghost" onClick={load}>Refresh</button>
          
          <Link className="btn-outline" to={`/device/${serial}`}>Back to device</Link>

        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f99", borderRadius: 12 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <LineChart
          points={battery?.points || []}
          valueKey="avg"
          title="Battery over time (avg per bucket)"
          unit="%"
          valueLabel="Battery"
        />
        <LineChart
          points={temp?.points || []}
          valueKey="avg"
          title="Temperature over time (avg per bucket)"
          unit="°C"
          valueLabel="Temperature"
        />
      </div>
    </div>
  );
}
