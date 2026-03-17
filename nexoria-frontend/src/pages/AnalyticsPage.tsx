// src/pages/AnalyticsPage.tsx

import React, { useEffect, useMemo, useState } from "react";
import {
  fetchFleetSummary,
  fetchUsageSummary,
  fetchUsageHeatmap,
  fetchInsights,
  type FleetSummary,
  type UsageSummary,
  type UsageHeatmap,
  type InsightsResponse,
  type DeviceUsageRow,
} from "../utils/analyticsAgent";
import type { DeviceRow } from "../types";

const daysOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatMinutes(min: number) {
  if (!isFinite(min)) return "N/A";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m}m`;
}

function getDashboardCols(width: number) {
  if (width >= 1400) return 12;
  if (width >= 1000) return 8;
  return 4;
}

function clampSpan(span: number, cols: number) {
  return Math.min(span, cols);
}

const Card: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children,
}) => (
  <div
    style={{
      padding: 16,
      borderRadius: 12,
      border: "1px solid #e5e7eb",
      background: "#ffffff",
      minWidth: 0,
    }}
  >
    <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{title}</div>
    {subtitle ? (
      <div style={{ marginTop: 6, color: "#6b7280", fontSize: 13 }}>{subtitle}</div>
    ) : null}
    <div style={{ marginTop: 12 }}>{children}</div>
  </div>
);

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    style={{
      padding: 14,
      borderRadius: 12,
      border: "1px solid #e5e7eb",
      background: "#f9fafb",
      minWidth: 0,
    }}
  >
    <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{label}</div>
    <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: "#111827" }}>{value}</div>
  </div>
);

const SimpleList: React.FC<{
  items: { left: string; right: string }[];
  emptyText: string;
}> = ({ items, emptyText }) => (
  <div style={{ display: "grid", gap: 10 }}>
    {items.length === 0 ? (
      <div style={{ color: "#6b7280", fontSize: 14 }}>{emptyText}</div>
    ) : (
      items.map((it, idx) => (
        <div
          key={idx}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 14,
            borderBottom: "1px solid #f3f4f6",
            paddingBottom: 10,
          }}
        >
          <div style={{ fontWeight: 700, color: "#374151" }}>{it.left}</div>
          <div style={{ color: "#6b7280" }}>{it.right}</div>
        </div>
      ))
    )}
  </div>
);

const UsageTable: React.FC<{
  rows: DeviceUsageRow[];
  codeBySerial: Record<string, string>;
}> = ({ rows, codeBySerial }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
      <thead>
        <tr style={{ textAlign: "left", color: "#6b7280" }}>
          <th style={{ padding: "10px 8px", width: 120 }}>Device No</th>
          <th style={{ padding: "10px 8px" }}>Serial</th>
          <th style={{ padding: "10px 8px" }}>Active</th>
          <th style={{ padding: "10px 8px" }}>Sessions</th>
          <th style={{ padding: "10px 8px" }}>Idle</th>
        </tr>
      </thead>

      <tbody>
        {rows.map((r, idx) => (
          <tr key={`${r.serial}-${idx}`} style={{ borderTop: "1px solid #f3f4f6" }}>
            <td style={{ padding: "10px 8px", fontWeight: 700, color: "#374151" }}>
              {codeBySerial[r.serial] ?? String(idx + 1)}
            </td>
            <td style={{ padding: "10px 8px", fontWeight: 700, color: "#374151" }}>
              {r.serial}
            </td>
            <td style={{ padding: "10px 8px", color: "#111827" }}>
              {formatMinutes(r.active_minutes)}
            </td>
            <td style={{ padding: "10px 8px", color: "#111827" }}>{r.sessions}</td>
            <td style={{ padding: "10px 8px", color: "#111827" }}>
              {formatMinutes(r.idle_minutes)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

type AnalyticsPageProps = {
  devices?: DeviceRow[];
};

const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ devices = [] }) => {
  const [fleet, setFleet] = useState<FleetSummary | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [heatmap, setHeatmap] = useState<UsageHeatmap | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cols, setCols] = useState(() => getDashboardCols(window.innerWidth));

  const windowHours = 24;
  const usageDays = 7;
  const heatmapDays = 14;

  const codeBySerial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of devices) {
      const code = d.device_code ?? undefined;
      if (code) m[d.id] = code;
    }
    return m;
  }, [devices]);

  const refresh = async () => {
    try {
      setLoading(true);
      setError(null);

      const [fs, us, hm, ins] = await Promise.all([
        fetchFleetSummary({ window_hours: windowHours }),
        fetchUsageSummary({ window_days: usageDays }),
        fetchUsageHeatmap({ window_days: heatmapDays }),
        fetchInsights({ window_days: usageDays }),
      ]);

      setFleet(fs);
      setUsage(us);
      setHeatmap(hm);
      setInsights(ins);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onResize = () => setCols(getDashboardCols(window.innerWidth));
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const lowStorageList = useMemo(() => {
    const items = fleet?.low_storage_devices ?? [];
    return items
      .slice()
      .sort((a, b) => a.free_mb - b.free_mb)
      .map((d) => ({ left: d.serial, right: `${Math.round(d.free_mb)} MB free` }));
  }, [fleet]);

  const overheatingList = useMemo(() => {
    const items = fleet?.overheating_today ?? [];
    return items
      .slice()
      .sort((a, b) => b.temperature_c - a.temperature_c)
      .map((d) => ({ left: d.serial, right: `${d.temperature_c.toFixed(1)} °C` }));
  }, [fleet]);

  const heatMax = useMemo(() => {
    if (!heatmap?.heatmap) return 0;
    let m = 0;
    for (const day of Object.keys(heatmap.heatmap)) {
      for (const v of heatmap.heatmap[day] || []) m = Math.max(m, v);
    }
    return m;
  }, [heatmap]);

  const spanSmall = cols === 12 ? 4 : cols === 8 ? 4 : 4;
  const spanTable = cols === 12 ? 6 : cols === 8 ? 8 : 4;
  const spanFull = cols;

  const metricCols = cols === 12 ? 7 : cols === 8 ? 4 : 2;

  if (loading) {
    return (
      <div
        style={{
          padding: 24,
          width: "100%",
          maxWidth: 1400,
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ margin: 0, color: "#111827" }}>Analytics</h1>
        <p style={{ color: "#6b7280" }}>Loading fleet analytics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: 24,
          width: "100%",
          maxWidth: 1400,
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        <h1 style={{ margin: 0, color: "#111827" }}>Analytics</h1>
        <p style={{ color: "#b91c1c" }}>Error: {error}</p>
        <button className="btn-outline" onClick={refresh}>
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 24,
        width: "100%",
        maxWidth: 1400,
        margin: "0 auto",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, color: "#111827" }}>Analytics</h1>
          <p style={{ marginTop: 6, color: "#6b7280" }}>
            Fleet-level health, usage patterns, and operational insights.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn-outline" onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: `repeat(${metricCols}, minmax(0, 1fr))`,
          gap: 12,
        }}
      >
        <Metric label="Fleet size" value={`${fleet?.fleet_size ?? 0}`} />
        <Metric
          label="Avg battery"
          value={fleet?.avg_battery != null ? `${fleet.avg_battery.toFixed(1)}%` : "N/A"}
        />
        <Metric
          label="Ready for session"
          value={
            fleet ? `${fleet.ready_pct.toFixed(1)}% (${fleet.ready_count}/${fleet.fleet_size})` : "N/A"
          }
        />
        <Metric
          label="Online now"
          value={fleet ? `${fleet.online_count} online, ${fleet.offline_count} offline` : "N/A"}
        />
        <Metric
          label="Avg session duration"
          value={usage ? `${Math.round(usage.avg_session_minutes)} minutes` : "N/A"}
        />
        <Metric label="Usage window" value={`${usageDays} days`} />
        <Metric label="Heatmap window" value={`${heatmapDays} days`} />
      </div>

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gap: 12,
          alignItems: "start",
        }}
      >
        <div style={{ gridColumn: `span ${clampSpan(spanSmall, cols)}` }}>
          <Card title="Devices with low storage">
            <SimpleList items={lowStorageList} emptyText="No devices below threshold." />
          </Card>
        </div>

        <div style={{ gridColumn: `span ${clampSpan(spanSmall, cols)}` }}>
          <Card title="Devices overheating today">
            <SimpleList items={overheatingList} emptyText="No overheating devices detected." />
          </Card>
        </div>

        <div style={{ gridColumn: `span ${clampSpan(spanSmall, cols)}` }}>
          <Card title="Insights">
            <SimpleList
              items={(insights?.insights ?? []).map((x) => ({ left: x, right: "" }))}
              emptyText="No insights yet."
            />
          </Card>
        </div>

        <div style={{ gridColumn: `span ${clampSpan(spanTable, cols)}` }}>
          <Card title="Most used devices">
            <UsageTable rows={usage?.most_used ?? []} codeBySerial={codeBySerial} />
          </Card>
        </div>

        <div style={{ gridColumn: `span ${clampSpan(spanTable, cols)}` }}>
          <Card title="Least used devices">
            <UsageTable rows={usage?.least_used ?? []} codeBySerial={codeBySerial} />
          </Card>
        </div>

        <div style={{ gridColumn: `span ${clampSpan(spanFull, cols)}` }}>
          <Card
            title="Usage heatmap (day, hour)"
            subtitle="Each cell is approximate active-minutes (unique minutes with heartbeats)."
          >
            {!heatmap?.heatmap ? (
              <div style={{ color: "#6b7280" }}>No heatmap data yet.</div>
            ) : (
              <div style={{ width: "100%" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "60px repeat(24, minmax(6px, 1fr))",
                    gap: 6,
                    width: "100%",
                  }}
                >
                  <div />
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h} style={{ fontSize: 10, color: "#9ca3af", textAlign: "center" }}>
                      {h}
                    </div>
                  ))}

                  {daysOrder.map((day) => {
                    const arr = heatmap.heatmap[day] || Array.from({ length: 24 }).map(() => 0);
                    return (
                      <React.Fragment key={day}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>{day}</div>
                        {arr.map((v, h) => {
                          const max = heatMax || 1;
                          const alpha = Math.min(0.85, Math.max(0.05, v / max));
                          return (
                            <div
                              key={`${day}-${h}`}
                              title={`${day} ${h}:00, ${v} active minutes`}
                              style={{
                                width: "100%",
                                aspectRatio: "1 / 1",
                                borderRadius: 6,
                                border: "1px solid #f3f4f6",
                                background: `rgba(97, 206, 112, ${v === 0 ? 0.08 : alpha})`,
                              }}
                            />
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsPage;
