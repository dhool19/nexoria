// src/pages/NetworkPerformancePage.tsx

import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  analyzeNetworkStats,
  type NetworkStats,
  type NetworkVerdict,
} from "../utils/networkAgent";

type NetworkAIResponse = {
  overall_assessment?: string;
  risk_level?: "low" | "medium" | "high";
  anomalies?: Array<{
    timestamp?: string | null;
    severity?: "low" | "medium" | "high";
    short_description?: string;
    details?: string;
  }>;
  recommended_actions?: string[];
  raw_text?: string;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";

const NetworkPerformancePage = () => {
  const { id: serial } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [verdict, setVerdict] = useState<NetworkVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [ai, setAi] = useState<NetworkAIResponse | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!serial) return;

    const fetchAll = async () => {
      try {
        setLoading(true);
        setError(null);
        setAi(null);
        setAiError(null);

        const res = await fetch(
          `${API_BASE_URL}/api/devices/${serial}/network_stats?window_hours=24`
        );
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);

        const data: NetworkStats = await res.json();
        setStats(data);
        setVerdict(analyzeNetworkStats(data));

        try {
          const aiRes = await fetch(
            `${API_BASE_URL}/api/devices/${serial}/network_stats_ai?window_hours=24`
          );
          if (!aiRes.ok) {
            throw new Error(`AI request failed with status ${aiRes.status}`);
          }
          const aiData: NetworkAIResponse = await aiRes.json();
          setAi(aiData);
        } catch (e: any) {
          console.error("AI fetch error:", e);
          setAiError(e?.message || "Failed to load AI recommendations");
        }
      } catch (err: any) {
        console.error(err);
        setError(err?.message || "Failed to load network stats");
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [serial]);

  const recommendations = useMemo<string[]>(() => {
    const recs = ai?.recommended_actions;
    if (!Array.isArray(recs)) return [];
    return recs.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  }, [ai]);

  if (!serial) {
    return (
      <div style={{ padding: 24 }}>
        <p>No device id provided.</p>
        <button className="btn-outline" onClick={() => navigate(`/devices`)}>
          Back to devices
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <p>Loading network performance analysis...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <p>Error: {error}</p>
        <button className="btn-outline" onClick={() => navigate(`/device/${serial}`)}>
          Back to device
        </button>
      </div>
    );
  }

  if (!stats || !verdict) {
    return (
      <div style={{ padding: 24 }}>
        <p>No network data available for this device.</p>
        <button className="btn-outline" onClick={() => navigate(`/device/${serial}`)}>
          Back to device
        </button>
      </div>
    );
  }

  const levelColor =
    verdict.level === "CRITICAL"
      ? "#b91c1c"
      : verdict.level === "WARNING"
      ? "#f97316"
      : "#16a34a";

  return (
    <div
      style={{
        padding: 24,
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <button className="btn-outline" onClick={() => navigate(`/device/${serial}`)}>
        ← Back
      </button>

      <h1 style={{ marginTop: 16, marginBottom: 4 }}>Network Performance</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Device ID / serial: <code>{serial}</code>
      </p>

      <div
        style={{
          marginTop: 16,
          padding: 16,
          borderRadius: 12,
          border: `1px solid ${levelColor}`,
          background: "#f9fafb",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: levelColor }}>
          Current network state: {verdict.level}
        </div>
        <h2 style={{ margin: "4px 0 4px 0", fontSize: 18 }}>{verdict.title}</h2>
        <p style={{ margin: 0, color: "#4b5563" }}>{verdict.message}</p>
      </div>

      <div
        style={{
          marginTop: 20,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <Metric
          label="Average RSSI"
          value={stats.avg_rssi != null ? `${stats.avg_rssi.toFixed(0)} dBm` : "N/A"}
        />
        <Metric
          label="Minimum RSSI"
          value={stats.min_rssi != null ? `${stats.min_rssi.toFixed(0)} dBm` : "N/A"}
        />
        <Metric
          label="Average link speed"
          value={
            stats.avg_link_mbps != null ? `${stats.avg_link_mbps.toFixed(1)} Mbps` : "N/A"
          }
        />
        <Metric
          label="Minimum link speed"
          value={
            stats.min_link_mbps != null ? `${stats.min_link_mbps.toFixed(1)} Mbps` : "N/A"
          }
        />
        <Metric
          label="RSSI stability"
          value={
            stats.rssi_stability_score != null
              ? `${Math.round(stats.rssi_stability_score * 100)}%`
              : "N/A"
          }
        />
        <Metric
          label="Link stability"
          value={
            stats.link_stability_score != null
              ? `${Math.round(stats.link_stability_score * 100)}%`
              : "N/A"
          }
        />
        <Metric label="Anomalies in window" value={`${stats.anomalies.length}`} />
      </div>

      <div style={{ marginTop: 24 }}>
        <h3>Recommendations</h3>
        {recommendations.length > 0 ? (
          <ul style={{ paddingLeft: 18, marginTop: 8 }}>
            {recommendations.map((r, idx) => (
              <li key={idx} style={{ marginBottom: 6, color: "#374151" }}>
                {r}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "#6b7280", marginTop: 8 }}>
            No AI recommendations available for this window.
          </p>
        )}
      </div>
    </div>
  );
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        border: "1px solid #e5e7eb",
        background: "#ffffff",
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export default NetworkPerformancePage;