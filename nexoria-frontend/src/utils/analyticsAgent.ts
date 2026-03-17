// src/utils/analyticsAgent.ts

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";

export type FleetSummary = {
  fleet_size: number;
  avg_battery: number | null;
  ready_count: number;
  ready_pct: number;
  online_count: number;
  offline_count: number;
  low_storage_devices: { serial: string; free_mb: number }[];
  overheating_today: { serial: string; temperature_c: number }[];
  thresholds: Record<string, any>;
};

export type DeviceUsageRow = {
  serial: string;
  active_minutes: number;
  sessions: number;
  idle_minutes: number;
};

export type UsageSummary = {
  window_days: number;
  session_gap_minutes: number;
  avg_session_minutes: number;
  most_used: DeviceUsageRow[];
  least_used: DeviceUsageRow[];
  device_usage: DeviceUsageRow[];
};

export type UsageHeatmap = {
  window_days: number;
  heatmap: Record<string, number[]>; 
};

export type InsightsResponse = {
  window_days: number;
  session_gap_minutes: number;
  insights: string[];
};


export type TrendPoint = {
  t: string; 
  avg: number | null;
  min: number;
  max: number;
  samples: number;
};

export type TrendResponse = {
  serial: string;
  metric: string; 
  window_hours: number;
  bucket_minutes: number;
  points: TrendPoint[];
};

async function safeFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export function fetchFleetSummary(params?: {
  window_hours?: number;
  online_grace_minutes?: number;
  ready_battery_min?: number;
  low_storage_free_mb?: number;
  overheating_temp_c?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.window_hours != null)
    qs.set("window_hours", String(params.window_hours));
  if (params?.online_grace_minutes != null)
    qs.set("online_grace_minutes", String(params.online_grace_minutes));
  if (params?.ready_battery_min != null)
    qs.set("ready_battery_min", String(params.ready_battery_min));
  if (params?.low_storage_free_mb != null)
    qs.set("low_storage_free_mb", String(params.low_storage_free_mb));
  if (params?.overheating_temp_c != null)
    qs.set("overheating_temp_c", String(params.overheating_temp_c));

  return safeFetch<FleetSummary>(
    `${API_BASE_URL}/api/analytics/fleet_summary?${qs.toString()}`
  );
}

export function fetchUsageSummary(params?: {
  window_days?: number;
  session_gap_minutes?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.window_days != null)
    qs.set("window_days", String(params.window_days));
  if (params?.session_gap_minutes != null)
    qs.set("session_gap_minutes", String(params.session_gap_minutes));

  return safeFetch<UsageSummary>(
    `${API_BASE_URL}/api/analytics/usage_summary?${qs.toString()}`
  );
}

export function fetchUsageHeatmap(params?: { window_days?: number }) {
  const qs = new URLSearchParams();
  if (params?.window_days != null)
    qs.set("window_days", String(params.window_days));

  return safeFetch<UsageHeatmap>(
    `${API_BASE_URL}/api/analytics/usage_heatmap?${qs.toString()}`
  );
}

export function fetchInsights(params?: {
  window_days?: number;
  session_gap_minutes?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.window_days != null)
    qs.set("window_days", String(params.window_days));
  if (params?.session_gap_minutes != null)
    qs.set("session_gap_minutes", String(params.session_gap_minutes));

  return safeFetch<InsightsResponse>(
    `${API_BASE_URL}/api/analytics/insights?${qs.toString()}`
  );
}

export function fetchDeviceBatteryTrend(
  serial: string,
  params?: { window_hours?: number; bucket_minutes?: number }
) {
  const qs = new URLSearchParams();
  if (params?.window_hours != null)
    qs.set("window_hours", String(params.window_hours));
  if (params?.bucket_minutes != null)
    qs.set("bucket_minutes", String(params.bucket_minutes));

  const q = qs.toString();
  return safeFetch<TrendResponse>(
    `${API_BASE_URL}/api/devices/${encodeURIComponent(
      serial
    )}/battery_trend${q ? `?${q}` : ""}`
  );
}

export function fetchDeviceTemperatureTrend(
  serial: string,
  params?: { window_hours?: number; bucket_minutes?: number }
) {
  const qs = new URLSearchParams();
  if (params?.window_hours != null)
    qs.set("window_hours", String(params.window_hours));
  if (params?.bucket_minutes != null)
    qs.set("bucket_minutes", String(params.bucket_minutes));

  const q = qs.toString();
  return safeFetch<TrendResponse>(
    `${API_BASE_URL}/api/devices/${encodeURIComponent(
      serial
    )}/temperature_trend${q ? `?${q}` : ""}`
  );
}
