// src/pages/BatteryAnomalyPage.tsx

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";

import type {
  BatteryStatsWithAiResponse,
  BatteryVerdict,
  AiAnalysis,
} from "../utils/batteryAgent";

import { analyzeBatteryStats } from "../utils/batteryAgent";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";

type RouteParams = {
  id: string;
};

const BatteryAnomalyPage: React.FC = () => {
  const { id: serial } = useParams<RouteParams>();
  const navigate = useNavigate();

  const [data, setData] = useState<BatteryStatsWithAiResponse | null>(null);
  const [verdict, setVerdict] = useState<BatteryVerdict | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serial) return;

    const fetchStats = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await axios.get<BatteryStatsWithAiResponse>(
          `${API_BASE_URL}/api/devices/${serial}/battery_stats_ai?window_hours=12`
        );

        const json = res.data;
        setData(json);

        setVerdict(analyzeBatteryStats(json.stats));
      } catch (err: any) {
        console.error("Failed to load battery stats", err);
        setError(
          err?.response?.data ||
            err?.message ||
            "Failed to load battery stats"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [serial]);

  const stats = data?.stats;
  const ai = (data?.ai_analysis ?? null) as AiAnalysis | null;

  const aiHeadline = (ai as any)?.headline ? String((ai as any).headline).trim() : "";
  const aiSummary = (ai as any)?.summary ? String((ai as any).summary).trim() : "";
  const aiAssessment = ai?.overall_assessment ? String(ai.overall_assessment).trim() : "";

  const hasAiText = Boolean(aiHeadline || aiSummary || aiAssessment);

  const recommendations = useMemo<string[]>(() => {
    const recs = ai?.recommended_actions;
    if (!Array.isArray(recs)) return [];
    return recs
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
  }, [ai]);

  const totalPoints = stats?.points?.length ?? 0;
  const anomalyCount = stats?.anomalies?.length ?? 0;
  const avgDischarge = stats?.avg_discharge_pct_per_hour;

  const normalizedRisk = (ai?.risk_level ?? "low").toLowerCase();
  const riskLevel =
    normalizedRisk === "high" || normalizedRisk === "medium" || normalizedRisk === "low"
      ? (normalizedRisk as "low" | "medium" | "high")
      : "low";

  const levelColor =
    riskLevel === "high"
      ? "#b91c1c"
      : riskLevel === "medium"
      ? "#f97316"
      : "#16a34a";

  const riskLabel =
    riskLevel === "high" ? "CRITICAL" : riskLevel === "medium" ? "WARNING" : "OK";

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
        <p>Loading battery anomaly detection...</p>
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

  if (!data || !stats) {
    return (
      <div style={{ padding: 24 }}>
        <p>No battery data available for this device.</p>
        <button className="btn-outline" onClick={() => navigate(`/device/${serial}`)}>
          Back to device
        </button>
      </div>
    );
  }

  const fallbackHeadline =
    anomalyCount > 0 ? "Battery behaviour needs attention" : "Battery behaviour looks normal";

  const fallbackSummary =
    anomalyCount > 0
      ? "Some unusual discharge patterns were detected in the selected time window."
      : "Battery readings are within a normal range based on recent measurements.";

  const headlineToShow = aiHeadline || fallbackHeadline;
  const summaryToShow = aiSummary || aiAssessment || fallbackSummary;

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

      <h1 style={{ marginTop: 16, marginBottom: 4 }}>Battery Anomaly Detection</h1>
      <p style={{ color: "#6b7280", marginTop: 0 }}>
        Device ID / serial: <code>{stats.serial ?? serial}</code>
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
          Current battery risk state: {riskLabel}
        </div>

        <h2 style={{ margin: "6px 0 6px 0", fontSize: 18 }}>
          {headlineToShow}
        </h2>

        <p style={{ margin: 0, color: "#4b5563" }}>
          {summaryToShow}
        </p>

        {!hasAiText ? (
          <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
            AI insights are currently unavailable, showing rule-based interpretation.
          </div>
        ) : null}
      </div>

      <div
        style={{
          marginTop: 20,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <Metric label="Time window" value={`${stats.window_hours} hours`} />
        <Metric label="Data points" value={`${totalPoints}`} />
        <Metric label="Rule based anomalies" value={`${anomalyCount}`} />
        <Metric
          label="Avg discharge rate"
          value={avgDischarge != null ? `${avgDischarge.toFixed(1)} %/hour` : "N/A"}
        />
        <Metric
          label="Time to empty"
          value={
            stats.time_to_empty_minutes != null
              ? `${stats.time_to_empty_minutes} min`
              : "N/A"
          }
        />
        <Metric
          label="Time to full"
          value={
            stats.time_to_full_minutes != null
              ? `${stats.time_to_full_minutes} min`
              : "N/A"
          }
        />
      </div>

      <div style={{ marginTop: 24 }}>
        <h3>Recommendations</h3>
        {recommendations.length > 0 ? (
          <ul style={{ paddingLeft: 18, marginTop: 8 }}>
            {recommendations.map((action, idx) => (
              <li key={idx} style={{ marginBottom: 6, color: "#374151" }}>
                {action}
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

export default BatteryAnomalyPage;