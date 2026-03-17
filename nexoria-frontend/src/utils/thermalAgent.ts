// src/utils/thermalAgent.ts

export type TemperaturePoint = {
  t: string;
  temperature_c: number;
};

export type TemperatureAnomaly = {
  timestamp: string;
  temperature_c: number;
  reason: string;
  severity: "low" | "medium" | "high" | string;
};

export type TemperatureStats = {
  serial: string;
  window_hours: number;
  points: TemperaturePoint[];
  avg_temperature_c: number | null;
  max_temperature_c: number | null;
  trend_deg_per_hour: number | null;
  anomalies: TemperatureAnomaly[];
  comfort_level: "COMFORTABLE" | "WARM" | "HOT" | "RISK" | "UNKNOWN" | string;
};

export type TemperatureVerdictLevel = "OK" | "WARNING" | "CRITICAL";

export type TemperatureVerdict = {
  level: TemperatureVerdictLevel;
  title: string;
  message: string;
};

export function analyzeTemperatureStats(
  stats: TemperatureStats
): TemperatureVerdict {
  const maxT = stats.max_temperature_c ?? 0;
  const anomalyCount = stats.anomalies.length;
  const trend = stats.trend_deg_per_hour ?? 0;

  let level: TemperatureVerdictLevel = "OK";
  let title = "Thermal behaviour looks normal";
  let message =
    "Temperatures are within a comfortable range based on recent measurements.";

  if (stats.comfort_level === "RISK" || maxT >= 42) {
    level = "CRITICAL";
    title = "High temperature risk detected";
    message =
      "The device has reached high temperatures that may be uncomfortable or stressful for the hardware. " +
      "Consider reducing usage, lowering performance, or improving ventilation.";
  } else if (stats.comfort_level === "HOT" || maxT >= 37 || anomalyCount > 0) {
    level = "WARNING";
    title = "Elevated temperature detected";
    message =
      "The device is operating at warm to hot temperatures. Monitor usage and environment to avoid overheating.";
  }

  if (trend > 1) {
    message +=
      " Temperature is also trending upwards over time, so it is worth monitoring this device more closely.";
  }

  return { level, title, message };
}
