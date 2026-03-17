// src/utils/networkAgent.ts

export type NetworkPoint = {
  t: string;
  wifi_rssi: number | null;
  wifi_link_mbps: number | null;
  wifi_ssid: string | null;
};

export type NetworkAnomaly = {
  type: string;
  severity: "low" | "medium" | "high" | string;
  reason: string;
};

export type NetworkStats = {
  serial: string;
  window_hours: number;
  points: NetworkPoint[];
  avg_rssi: number | null;
  min_rssi: number | null;
  avg_link_mbps: number | null;
  min_link_mbps: number | null;
  rssi_stability_score: number | null;
  link_stability_score: number | null;
  anomalies: NetworkAnomaly[];
};

export type NetworkVerdictLevel = "OK" | "WARNING" | "CRITICAL";

export type NetworkVerdict = {
  level: NetworkVerdictLevel;
  title: string;
  message: string;
};

export function analyzeNetworkStats(stats: NetworkStats): NetworkVerdict {
  const avgRssi = stats.avg_rssi ?? 0;
  const avgLink = stats.avg_link_mbps ?? 0;
  const rssiStability = stats.rssi_stability_score ?? 1;
  const linkStability = stats.link_stability_score ?? 1;
  const anomalyCount = stats.anomalies.length;

  let level: NetworkVerdictLevel = "OK";
  let title = "Network performance looks normal";
  let message =
    "Wifi signal and link speed appear to be within normal ranges for this device.";

  const veryWeakSignal = avgRssi <= -80;
  const weakSignal = avgRssi <= -70;
  const veryLowLink = avgLink <= 3;
  const lowLink = avgLink <= 10;
  const unstable = rssiStability < 0.6 || linkStability < 0.6;

  if (veryWeakSignal || veryLowLink) {
    level = "CRITICAL";
    title = "Severe network issues detected";
    message =
      "The device has very poor wifi signal or extremely low link speed. " +
      "This can cause frequent disconnects and poor streaming quality. " +
      "Check the access point, distance, and interference.";
  } else if (weakSignal || lowLink || unstable || anomalyCount > 0) {
    level = "WARNING";
    title = "Network quality is degraded";
    message =
      "The device experiences weak signal, low throughput, or unstable wifi. " +
      "You may see lag, slow downloads, or intermittent tracking issues.";
  }

  return { level, title, message };
}
