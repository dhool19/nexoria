// src/pages/ThermalComfortPage.tsx

import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  analyzeTemperatureStats,
  type TemperatureStats,
  type TemperatureVerdict,
} from "../utils/thermalAgent";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";

type ThermalAIAnalysis = {
  overall_assessment: string;
  risk_level: "low" | "medium" | "high";
  anomalies: Array<{
    type: string;
    severity: "low" | "medium" | "high";
    evidence: string;
  }>;
  recommended_actions: string[];
  raw_text?: string;
};

type ThermalStatsAIResponse = {
  stats: TemperatureStats;
  ai_analysis: ThermalAIAnalysis;
};

const ThermalComfortPage = () => {
  const { id: serial } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<TemperatureStats | null>(null);
  const [verdict, setVerdict] = useState<TemperatureVerdict | null>(null);
  const [ai, setAi] = useState<ThermalAIAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serial) return;

    const fetchStats = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(
          `${API_BASE_URL}/api/devices/${serial}/thermal_stats_ai?window_hours=12`
        );
        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }

        const data: ThermalStatsAIResponse = await res.json();

        setStats(data.stats);
        setAi(data.ai_analysis);
        setVerdict(analyzeTemperatureStats(data.stats));
      } catch (err: any) {
        console.error(err);
        setError(err?.message || "Failed to load temperature stats");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [serial]);

  const recommendations = useMemo<string[]>(() => {
    const aiRecs = ai?.recommended_actions;
    if (Array.isArray(aiRecs) && aiRecs.length > 0) return aiRecs;

    const recs = (stats as any)?.recommendations;
    if (Array.isArray(recs) && recs.length > 0) return recs;

    const fallback: string[] = [];
    const trend = stats?.trend_deg_per_hour ?? null;
    const maxT = stats?.max_temperature_c ?? null;
    const anomaliesCount = stats?.anomalies?.length ?? 0;

    if (trend != null && trend >= 1.0) {
      fallback.push(
        "Temperature trend is rising, monitor upcoming sessions and check room temperature or airflow near the device."
      );
    }

    if (maxT != null && maxT >= 37) {
      fallback.push(
        "Let the headset cool down between sessions and avoid charging while in use if it stays warm."
      );
    }

    if (anomaliesCount > 0) {
      fallback.push(
        "Thermal anomalies detected, inspect vents for blockage (dust) and verify if long sessions or charging explain the behavior."
      );
    }

    if (verdict?.level === "CRITICAL") {
      fallback.push(
        "If temperatures stay high, pause use and investigate hardware/ventilation before continuing."
      );
    }

    if (fallback.length === 0) {
      fallback.push("No immediate action needed, continue periodic monitoring.");
    }

    return fallback;
  }, [stats, verdict, ai]);

  if (!serial) {
    return (
      <div style={{ padding: 24 }}>
        <p>No serial provided.</p>
        <button className="btn-outline" onClick={() => navigate(`/device`)}>
          Back to devices
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <p>Loading thermal comfort analysis...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <p>Error: {error}</p>
        <button
          className="btn-outline"
          onClick={() => navigate(`/device/${serial}`)}
        >
          Back to device
        </button>
      </div>
    );
  }

  if (!stats || !verdict) {
    return (
      <div style={{ padding: 24 }}>
        <p>No temperature data available for this device.</p>
        <button
          className="btn-outline"
          onClick={() => navigate(`/device/${serial}`)}
        >
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

  const riskColor =
    ai?.risk_level === "high"
      ? "#b91c1c"
      : ai?.risk_level === "medium"
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

      <h1 style={{ marginTop: 16, marginBottom: 4 }}>
        Thermal Comfort and Temperature Behaviour
      </h1>
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
          Current thermal state: {verdict.level}
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
          label="Average temperature"
          value={
            stats.avg_temperature_c != null
              ? `${stats.avg_temperature_c.toFixed(1)} °C`
              : "N/A"
          }
        />
        <Metric
          label="Maximum temperature"
          value={
            stats.max_temperature_c != null
              ? `${stats.max_temperature_c.toFixed(1)} °C`
              : "N/A"
          }
        />
        <Metric
          label="Trend"
          value={
            stats.trend_deg_per_hour != null
              ? `${stats.trend_deg_per_hour.toFixed(2)} °C / h`
              : "N/A"
          }
        />
        <Metric label="Comfort level" value={stats.comfort_level ?? "UNKNOWN"} />
        <Metric label="Anomalies in window" value={`${stats.anomalies.length}`} />
      </div>

      <div style={{ marginTop: 24 }}>
        <h3>Recommendations</h3>
        <ul style={{ paddingLeft: 18, marginTop: 10 }}>
          {recommendations.map((r, idx) => (
            <li key={idx} style={{ marginBottom: 6, color: "#374151" }}>
              {r}
            </li>
          ))}
        </ul>
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

export default ThermalComfortPage;