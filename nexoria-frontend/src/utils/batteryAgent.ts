// src/utils/batteryAgent.ts

export type BatteryPoint = {
  t: string;
  battery: number;
  charging: boolean | null;
  health: string | null;
  rate_per_hour: number;
};

export type BatteryAnomaly = {
  timestamp: string;
  battery: number;
  rate_per_hour: number;
  reason: string;
};

export type BatteryStats = {
  serial: string;
  window_hours: number;
  points: BatteryPoint[];
  avg_discharge_pct_per_hour: number | null;
  anomalies: BatteryAnomaly[];
  time_to_empty_minutes: number | null;
  time_to_full_minutes: number | null;
};

export type AiRiskLevel = "low" | "medium" | "high";

export type AiAnomaly = {
  timestamp: string | null;
  severity: "low" | "medium" | "high";
  short_description: string;
  details: string;
};

export type AiAnalysis = {
  overall_assessment: string;
  risk_level: AiRiskLevel;
  anomalies: AiAnomaly[];
  recommended_actions: string[];
};

export type BatteryStatsWithAiResponse = {
  stats: BatteryStats;
  ai_analysis: AiAnalysis;
};

type VerdictLevel = "OK" | "WARNING" | "CRITICAL";

export type BatteryVerdict = {
  level: VerdictLevel;
  title: string;
  message: string;
};

export function analyzeBatteryStats(stats: BatteryStats): BatteryVerdict {
  const avg = stats.avg_discharge_pct_per_hour ?? 0;
  const anomalyCount = stats.anomalies.length;

  let level: VerdictLevel = "OK";
  let title = "Battery looks normal";
  let message = "No anomalies detected in the selected time window.";

  if (anomalyCount > 0 && avg > 25) {
    level = "CRITICAL";
    title = "Severe battery anomalies detected";
    message =
      "The device shows unusually fast battery drain and several anomaly events. " +
      "This may indicate heavy usage, a misbehaving app, or a potential battery issue.";
  } else if (avg > 15) {
    level = "WARNING";
    title = "High battery consumption";
    message =
      "Battery drain is above the typical range. Consider checking running apps, brightness, and usage patterns.";
  }

  return { level, title, message };
}
