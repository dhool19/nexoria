// src/utils/deviceHelpers.ts

import type { DeviceRow } from "../types";

export const batteryClass = (battery?: number | null) => {
  if (battery === null || battery === undefined)
    return "battery-pill battery-empty";

  if (battery >= 60) return "battery-pill battery-high";
  if (battery >= 30) return "battery-pill battery-mid";
  return "battery-pill battery-low";
};

export const formatMinutes = (m: number | null | undefined) => {
  if (m === null || m === undefined) return "-";

  const total = Number(m);
  if (Number.isNaN(total)) return "-";

  const hours = Math.floor(total / 60);
  const mins = total % 60;

  if (hours === 0) return `${mins} min`;
  return `${hours} h ${mins} min`;
};

export const wifiStrengthPercent = (rssi: number | null | undefined) => {
  if (rssi === null || rssi === undefined) return 0;

  const clamped = Math.max(-90, Math.min(-40, rssi));
  return Math.round(((clamped + 90) / 50) * 100);
};

export const matchesSearch = (device: DeviceRow, query: string) => {
  if (!query) return true;

  const q = query.trim().toLowerCase();

  const combined = [
    device.device_code ?? "", 
    device.id ?? "",
    device.brand ?? "",
    device.model ?? "",
    device.room ?? "",
    device.ip ?? "",
    device.wifi_ssid ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return combined.includes(q);
};

export type OnlineStatus = "online" | "offline" | "unknown";

export const getOnlineStatus = (
  lastSeen: string | undefined | null,
  timeoutMinutes = 2
): OnlineStatus => {
  if (!lastSeen) return "unknown";

  const normalized = lastSeen.replace(" ", "T");
  const last = new Date(normalized);

  if (Number.isNaN(last.getTime())) return "unknown";

  const diffMs = Date.now() - last.getTime();

  if (diffMs <= timeoutMinutes * 60 * 1000) return "online";
  return "offline";
};
