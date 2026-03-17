// src/types.ts

export type InstalledApp = {
  package_name: string;
  label?: string;
  version_name?: string;
  version_code?: number;
};

export type DeviceInfo = {
  android_version: string;
  battery: number;
  brand: string;
  brightness: number;
  charging: boolean;
  controller_l: number | null;
  controller_r: number | null;
  health: string;
  ip: string;
  last_seen: string;
  mac: string;
  model: string;
  pui_version: string;
  room: string;
  software_version: string;
  storage_used_mb: number | null;
  storage_total_mb?: number | null;
  temperature_c: number;
  uptime_minutes: number;
  volume_current: number;
  volume_max: number;
  wifi_bssid: string;
  wifi_frequency_mhz: number;
  wifi_link_mbps: number;
  wifi_rssi: number;
  wifi_ssid: string;

  device_code?: string | null;

  device_type?: string;
  color?: string;
  acquisition_year?: number;
  device_model_meta?: string;
  lab_name?: string;
  device_SN?: string;
  installed_apps?: InstalledApp[];
};

export type ApiResponse = {
  [serial: string]: DeviceInfo;
};

export type DeviceRow = DeviceInfo & {
  id: string;
};