// src/pages/DeviceDetailPage.tsx

import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import type { DeviceRow } from "../types";
import {
  batteryClass,
  formatMinutes,
  wifiStrengthPercent,
  getOnlineStatus,
} from "../utils/deviceHelpers";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";

const DEVICE_TYPE = ["VR-Brille"];
const COLOR = ["Dunkelblau", "Rot", "Schwarz", "Gelb", "Rosa"];
const ACQUISITION_YEAR = [
  "2019",
  "2020",
  "2021",
  "2022",
  "2023",
  "2024",
  "2025",
  "2026",
  "2027",
  "2028",
  "2029",
  "2030",
];
const DEVICE_MODELS = [
  "Pico 4",
  "Pico 4 Ultra",
  "Pico 4 Enterprise",
  "Pico 4 Ultra Enterprise",
  "Pico Neo 3",
  "Pico Neo 3 Pro",
  "Pico Neo 3 Pro Eye",
  "Pico Neo 3 Link",
  "Pico G3",
  "Pico Neo CV",
  "Pico G2 4K",
  "Pico G2 4K S",
  "Pico G2 4K Enterprise",
  "Pico Neo 2",
  "Pico Neo 2 Eye",
];

const LAB_NAME = ["DHBW AR & VR Lab"];

const formatTimeAgo = (lastSeen: string | null | undefined): string => {
  if (!lastSeen) return "Unknown";

  const lastDate = new Date(lastSeen);
  if (Number.isNaN(lastDate.getTime())) return lastSeen;

  const now = new Date();
  const diffMs = now.getTime() - lastDate.getTime();
  if (diffMs < 0) return "In the future";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  if (days < 30) return `${days} day${days !== 1 ? "s" : ""} ago`;
  if (months < 12) return `${months} month${months !== 1 ? "s" : ""} ago`;
  return `${years} year${years !== 1 ? "s" : ""} ago`;
};

const formatLastSeenLocal = (lastSeen: string | null | undefined): string => {
  if (!lastSeen) return "-";

  const d = new Date(lastSeen);
  if (Number.isNaN(d.getTime())) return lastSeen;

  try {
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
};

type DetailProps = {
  devices: DeviceRow[];
  loading: boolean;
};

type ApkInfo = {
  id: string;
  label: string;
  filename: string;
};

type InstalledApp = {
  package_name: string;
  label?: string;
  version_name?: string;
  version_code?: number;
  installed_at?: number;
};

type DeviceWithApps = DeviceRow & {
  installed_apps?: InstalledApp[];
};

type LabMetaForm = {
  device_type: string;
  color: string;
  acquisition_year: string;
  device_model: string;
  lab_name: string;
  device_SN: string;
};

const DeviceDetailPage: React.FC<DetailProps> = ({ devices, loading }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [apks, setApks] = useState<ApkInfo[]>([]);
  const [selectedApkId, setSelectedApkId] = useState<string>("");
  const [installStatus, setInstallStatus] = useState<string | null>(null);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLabel, setUploadLabel] = useState<string>("");

  const [editingMeta, setEditingMeta] = useState(false);
  const [metaSubmitting, setMetaSubmitting] = useState(false);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [metaOk, setMetaOk] = useState<string | null>(null);

  const [metaForm, setMetaForm] = useState<LabMetaForm>({
    device_type: "",
    color: "",
    acquisition_year: "",
    device_model: "",
    lab_name: "",
    device_SN: "",
  });

  useEffect(() => {
    axios
      .get<ApkInfo[]>(`${API_BASE}/api/apks`)
      .then((res) => {
        if (Array.isArray(res.data)) setApks(res.data);
        else setApks([]);
      })
      .catch(() => setApks([]));
  }, []);

  const device = devices.find((d) => d.id === id) as DeviceWithApps | undefined;

  useEffect(() => {
    if (!device) return;
    setMetaForm({
      device_type: device.device_type ?? "",
      color: device.color ?? "",
      acquisition_year:
        device.acquisition_year != null ? String(device.acquisition_year) : "",
      device_model: device.device_model_meta ?? "",
      lab_name: device.lab_name ?? "",
      device_SN: device.device_SN ?? "",
    });
  }, [device?.id]);

  if (loading && !device) {
    return (
      <div className="page device-detail">
        <p>Loading device...</p>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="page device-detail">
        <div className="detail-header">
          <div>
            <div className="detail-breadcrumbs">
              <Link to="/" className="crumb-link">
                Devices
              </Link>
              <span className="crumb-sep">/</span>
              <span className="crumb-current">Not found</span>
            </div>
            <h1 className="detail-title">Device not found</h1>
            <p className="detail-subtitle">We couldn’t find a device with that ID.</p>
          </div>

          <div className="detail-actions">
            <button className="btn-outline" onClick={() => navigate("/")}>
              Back to devices
            </button>
          </div>
        </div>
      </div>
    );
  }

  const d = device;

  const installedApps: InstalledApp[] = Array.isArray(d.installed_apps)
    ? d.installed_apps
    : [];

  const usedMb = d.storage_used_mb ?? 0;
  const totalMb = d.storage_total_mb ?? 0;
  const usedPercent = totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : null;
  const mbToGb = (mb: number) => (mb / 1024).toFixed(1);

  const chargingLabel =
    typeof d.charging === "boolean"
      ? d.charging
        ? "Yes"
        : "No"
      : d.charging ?? "-";

  const status = getOnlineStatus(d.last_seen, 2);

  const statusClass =
    status === "online"
      ? "chip-online"
      : status === "offline"
      ? "chip-offline"
      : "chip-unknown";

  const statusText =
    status === "online" ? "Online" : status === "offline" ? "Offline" : "Unknown";

  const relativeText = formatTimeAgo(d.last_seen);
  const lastSeenLocal = formatLastSeenLocal(d.last_seen);

  const triggerInstall = async () => {
    if (!selectedApkId) return;
    setInstallStatus("Creating install job...");
    try {
      await axios.post(`${API_BASE}/api/devices/${d.id}/install_apk`, {
        apk_id: selectedApkId,
      });
      setInstallStatus("Install job created, will run on next heartbeat.");
    } catch (err) {
      console.error(err);
      setInstallStatus("Failed to create install job.");
    }
  };

  const uploadApk = async () => {
    if (!uploadFile) {
      setInstallStatus("Please choose an APK file to upload.");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("apk", uploadFile);
      if (uploadLabel.trim()) formData.append("label", uploadLabel.trim());

      const res = await axios.post<ApkInfo>(`${API_BASE}/api/apks`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setApks((prev) => [...prev, res.data]);
      setSelectedApkId(res.data.id);
      setInstallStatus("APK uploaded successfully.");
      setUploadFile(null);
      setUploadLabel("");
    } catch (err) {
      console.error(err);
      setInstallStatus("Failed to upload APK.");
    }
  };

  // delete APK from library
  const deleteApk = async (apkId: string) => {
    if (!apkId) return;

    const ok = window.confirm("Delete this APK from the library?");
    if (!ok) return;

    setInstallStatus("Deleting APK...");
    try {
      await axios.delete(`${API_BASE}/api/apks/${apkId}`);

      setApks((prev) => prev.filter((a) => a.id !== apkId));
      setSelectedApkId((prev) => (prev === apkId ? "" : prev));
      setInstallStatus("APK deleted.");
    } catch (e: any) {
      console.error(e);
      setInstallStatus(e?.response?.data?.error || "Failed to delete APK.");
    }
  };

  // delete THIS device (danger zone button)
  const handleDeleteDevice = async () => {
    const serialForDelete = d.id; // backend expects Android ID

    const ok = window.confirm(
      `Delete this device?\n\nAndroid ID: ${serialForDelete}\n\nThis will permanently remove the device and its history (heartbeats, jobs).`
    );
    if (!ok) return;

    try {
      await axios.delete(
        `${API_BASE}/api/devices/${encodeURIComponent(serialForDelete)}`
      );
      alert("Device deleted successfully.");
      navigate("/");
    } catch (err: any) {
      console.error(err);
      alert(
        err?.response?.data?.error
          ? `Delete failed: ${err.response.data.error}`
          : "Delete failed, please check backend logs."
      );
    }
  };

  const onMetaChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setMetaForm((p) => ({ ...p, [name]: value }));
  };

  const saveMeta = async () => {
    setMetaErr(null);
    setMetaOk(null);

    try {
      setMetaSubmitting(true);

      const res = await axios.put(`${API_BASE}/api/devices/${d.id}/lab_metadata`, {
        device_type: metaForm.device_type,
        color: metaForm.color,
        acquisition_year: metaForm.acquisition_year,
        device_model: metaForm.device_model,
        lab_name: metaForm.lab_name,
        device_SN: metaForm.device_SN,
      });

      setMetaOk(res.data?.message || "Lab metadata updated");
      setEditingMeta(false);

      window.location.reload();
    } catch (e: any) {
      setMetaErr(
        e?.response?.data?.error || e?.message || "Failed to update lab metadata"
      );
    } finally {
      setMetaSubmitting(false);
    }
  };

  return (
    <div className="page device-detail">
      {/* Modern header */}
      <div className="detail-header">
        <div>
          <div className="detail-breadcrumbs">
            <Link to="/" className="crumb-link">
              Devices
            </Link>
            <span className="crumb-sep">/</span>
            <span className="crumb-current">
              {d.device_code ? d.device_code : `${d.brand} ${d.model}`}
            </span>
          </div>

          <h1 className="detail-title">
            {d.device_code ? (
              <>
                <span className="mono">{d.device_code}</span>{" "}
                <span className="muted">({d.device_model_meta})</span>
              </>
            ) : (
              <>
                {d.brand} {d.model}
              </>
            )}
          </h1>

          <p className="detail-subtitle">
            Android ID: <span className="mono">{d.id}</span>
          </p>

          <div className="detail-chips">
            <span className={`chip ${statusClass}`}>
              <span className="chip-dot" />
              {statusText}
            </span>
            <span className="chip chip-neutral">
              Location: {d.room || "Unknown"}
            </span>
            <span className="chip chip-neutral">
              Last updated: {relativeText} ({lastSeenLocal})
            </span>
          </div>
        </div>

        <div
          className="detail-actions"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-outline" onClick={() => navigate("/")}>
              ← Back
            </button>
            <button className="btn-ghost" onClick={() => window.location.reload()}>
              Refresh
            </button>
          </div>

          <Link className="btn-outline" to={`/device/${d.id}/analytics`}>
            Device analytics
          </Link>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel sketch-panel detail-panel">
            <h2 className="panel-title">Analysis</h2>
            <p className="panel-hint">Run diagnostics and open device insights.</p>

            <div className="panel-actions">
              <Link className="btn-solid-link" to={`/device/${d.id}/battery-anomaly`}>
                Battery anomaly detection
              </Link>
              <Link className="btn-solid-link" to={`/device/${d.id}/thermal-comfort`}>
                Thermal comfort
              </Link>
              <Link className="btn-solid-link" to={`/device/${d.id}/network-performance`}>
                Network performance
              </Link>
            </div>
          </section>

          {/* Remote install */}
          <section className="panel sketch-panel detail-panel">
            <h2 className="panel-title">Remote install</h2>
            <p className="panel-hint">Upload an APK, or install one from the library.</p>

            <div className="install-grid">
              <div className="install-row">
                <div className="install-label">Upload APK</div>

                <label className="file-btn">
                  <input
                    type="file"
                    accept=".apk"
                    onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  />
                  Choose file
                </label>

                <div className="file-name">
                  {uploadFile ? uploadFile.name : "No file selected"}
                </div>

                <input
                  className="text-input"
                  type="text"
                  placeholder="Label (optional)"
                  value={uploadLabel}
                  onChange={(e) => setUploadLabel(e.target.value)}
                />

                <button className="btn-solid" onClick={uploadApk} disabled={!uploadFile}>
                  Upload
                </button>
              </div>

              <div className="install-row install-row-secondary">
                <div className="install-label">Select APK</div>

                <select
                  className="select-input"
                  value={selectedApkId}
                  onChange={(e) => setSelectedApkId(e.target.value)}
                >
                  <option value="">Choose APK…</option>
                  {apks.map((apk) => (
                    <option key={apk.id} value={apk.id}>
                      {apk.label} ({apk.filename})
                    </option>
                  ))}
                </select>

                {/* Buttons */}
                <div
                  style={{
                    gridColumn: "1 / -1",
                    display: "flex",
                    gap: 12,
                    marginTop: 10,
                  }}
                >
                  <button
                    onClick={triggerInstall}
                    disabled={!selectedApkId}
                    style={{
                      background: "#61CE70",
                      border: "2px solid #61CE70",
                      color: "#fff",
                      padding: "10px 16px",
                      borderRadius: 12,
                      fontWeight: 600,
                      cursor: selectedApkId ? "pointer" : "not-allowed",
                      opacity: selectedApkId ? 1 : 0.6,
                    }}
                  >
                    Install on this device
                  </button>

                  <button
                    onClick={() => deleteApk(selectedApkId)}
                    disabled={!selectedApkId}
                    style={{
                      background: "#E2001A",
                      border: "2px solid #E2001A",
                      color: "#fff",
                      padding: "10px 16px",
                      borderRadius: 12,
                      fontWeight: 600,
                      cursor: selectedApkId ? "pointer" : "not-allowed",
                      opacity: selectedApkId ? 1 : 0.6,
                    }}
                  >
                    Delete selected
                  </button>
                </div>
              </div>

              {installStatus && (
                <div className="field-note" style={{ marginTop: 6 }}>
                  {installStatus}
                </div>
              )}
            </div>
          </section>

          {/* Lab metadata (view + edit) */}
          <section className="panel sketch-panel detail-panel">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
              }}
            >
              <h2 className="panel-title" style={{ margin: 0 }}>
                Lab metadata
              </h2>

              {!editingMeta ? (
                <button
                  className="btn-outline"
                  onClick={() => {
                    setMetaErr(null);
                    setMetaOk(null);
                    setEditingMeta(true);
                  }}
                >
                  Edit
                </button>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn-outline"
                    onClick={() => {
                      setEditingMeta(false);
                      setMetaErr(null);
                      setMetaOk(null);
                      setMetaForm({
                        device_type: d.device_type ?? "",
                        color: d.color ?? "",
                        acquisition_year:
                          d.acquisition_year != null ? String(d.acquisition_year) : "",
                        device_model: d.device_model_meta ?? "",
                        lab_name: d.lab_name ?? "",
                        device_SN: d.device_SN ?? "",
                      });
                    }}
                    disabled={metaSubmitting}
                  >
                    Cancel
                  </button>
                  <button className="btn-solid" onClick={saveMeta} disabled={metaSubmitting}>
                    {metaSubmitting ? "Saving..." : "Save"}
                  </button>
                </div>
              )}
            </div>

            {!editingMeta ? (
              <div className="kv-grid">
                <div className="kv">
                  <div className="kv-k">Device name</div>
                  <div className="kv-v mono">{d.device_code || "-"}</div>
                </div>

                <div className="kv">
                  <div className="kv-k">Android ID</div>
                  <div className="kv-v mono">{d.id}</div>
                </div>

                <div className="kv">
                  <div className="kv-k">Device type</div>
                  <div className="kv-v">{d.device_type || "-"}</div>
                </div>
                <div className="kv">
                  <div className="kv-k">Model (meta)</div>
                  <div className="kv-v">{d.device_model_meta || "-"}</div>
                </div>
                <div className="kv">
                  <div className="kv-k">Lab name</div>
                  <div className="kv-v">{d.lab_name || "-"}</div>
                </div>
                <div className="kv">
                  <div className="kv-k">Lab SN</div>
                  <div className="kv-v mono">{d.device_SN || "-"}</div>
                </div>
                <div className="kv">
                  <div className="kv-k">Acquisition year</div>
                  <div className="kv-v">
                    {d.acquisition_year != null ? d.acquisition_year : "-"}
                  </div>
                </div>
                <div className="kv">
                  <div className="kv-k">Color</div>
                  <div className="kv-v">{d.color || "-"}</div>
                </div>
              </div>
            ) : (
              <div
                className="meta-edit-grid"
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 12,
                  width: "100%",
                }}
              >
                <div className="enroll-field">
                  <label className="install-label">Serial number</label>
                  <input
                    className="text-input"
                    name="device_SN"
                    value={metaForm.device_SN}
                    onChange={onMetaChange}
                    placeholder="PA7J50PGF9260317W"
                    required
                  />
                </div>

                <div className="enroll-field">
                  <label className="install-label">Device type</label>
                  <select
                    className="text-input"
                    name="device_type"
                    value={metaForm.device_type}
                    onChange={onMetaChange}
                    required
                  >
                    <option value="" disabled>
                      Select device type
                    </option>
                    {DEVICE_TYPE.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="enroll-field">
                  <label className="install-label">Color</label>
                  <select
                    className="text-input"
                    name="color"
                    value={metaForm.color}
                    onChange={onMetaChange}
                    required
                  >
                    <option value="" disabled>
                      Select color
                    </option>
                    {COLOR.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="enroll-field">
                  <label className="install-label">Acquisition year</label>
                  <select
                    className="text-input"
                    name="acquisition_year"
                    value={metaForm.acquisition_year}
                    onChange={onMetaChange}
                    required
                  >
                    <option value="" disabled>
                      Select acquisition year
                    </option>
                    {ACQUISITION_YEAR.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="enroll-field">
                  <label className="install-label">Lab name</label>
                  <select
                    className="text-input"
                    name="lab_name"
                    value={metaForm.lab_name}
                    onChange={onMetaChange}
                    required
                  >
                    <option value="" disabled>
                      Select lab
                    </option>
                    {LAB_NAME.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="enroll-field">
                  <label className="install-label">Device model</label>
                  <select
                    className="text-input"
                    name="device_model"
                    value={metaForm.device_model}
                    onChange={onMetaChange}
                    required
                  >
                    <option value="" disabled>
                      Select device model
                    </option>
                    {DEVICE_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                {metaErr && <div className="enroll-toast enroll-toast--err">{metaErr}</div>}
                {metaOk && <div className="enroll-toast enroll-toast--ok">{metaOk}</div>}
              </div>
            )}
          </section>

          {/* Batteries */}
          <section className="panel sketch-panel detail-panel">
            <h2 className="panel-title">Batteries</h2>
            <div className="panel-body battery-table">
              <div className="battery-row">
                <div className="battery-label">
                  <span className="battery-icon">🕶️</span>
                  <span>Headset</span>
                </div>
                <div className="battery-cell">
                  <div className="cell-label">Battery</div>
                  <span className={batteryClass(d.battery ?? 0)}>
                    {d.battery != null ? `${d.battery}%` : "-"}
                  </span>
                </div>
                <div className="battery-cell">
                  <div className="cell-label">Temp</div>
                  <span>{d.temperature_c}°C</span>
                </div>
                <div className="battery-cell">
                  <div className="cell-label">Health</div>
                  <span>
                    {d.health}
                    {typeof d.charging === "boolean" && (
                      <>
                        {" · "}
                        {d.charging ? "charging" : "not charging"}
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Installed apps */}
          <section className="panel sketch-panel detail-panel">
            <h2 className="panel-title">
              Installed apps{" "}
              <span style={{ fontWeight: 400, fontSize: 14 }}>
                ({installedApps.length})
              </span>
            </h2>

            {installedApps.length === 0 ? (
              <div className="field-note">No app data reported yet.</div>
            ) : (
              <div className="apps-table-wrap">
                <table className="apps-table">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Version</th>
                    </tr>
                  </thead>
                  <tbody>
                    {installedApps.map((app) => (
                      <tr key={app.package_name}>
                        <td className="apps-td-strong">
                          {app.label ?? app.package_name}
                          <div className="apps-td-sub mono">{app.package_name}</div>
                        </td>
                        <td>
                          {app.version_name ?? "-"}
                          {app.version_code != null && ` (code ${app.version_code})`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {installStatus && (
              <div className="field-note" style={{ marginTop: 8 }}>
                {installStatus}
              </div>
            )}
          </section>

          {/* Danger zone */}
          <div className="danger-zone">
            <button className="danger-btn" onClick={handleDeleteDevice}>
              Delete this device
            </button>
            <div className="danger-hint">
              This will permanently remove the device and its related data (heartbeats,
              jobs).
            </div>
          </div>
        </div>

        {/* SIDE COLUMN */}
        <div className="detail-side">
          {/* Headset info */}
          <section className="panel sketch-panel detail-panel">
            <h2 className="panel-title">Headset information</h2>

            <div className="kv-grid one-col">
              <div className="kv">
                <div className="kv-k">Brand</div>
                <div className="kv-v">{d.brand}</div>
              </div>
              <div className="kv">
                <div className="kv-k">Model</div>
                <div className="kv-v">{d.model}</div>
              </div>
              <div className="kv">
                <div className="kv-k">Android version</div>
                <div className="kv-v">{d.android_version}</div>
              </div>
              <div className="kv">
                <div className="kv-k">OS version</div>
                <div className="kv-v">{d.software_version}</div>
              </div>
              <div className="kv">
                <div className="kv-k">Client app version</div>
                <div className="kv-v">{d.pui_version}</div>
              </div>
              <div className="kv">
                <div className="kv-k">Uptime</div>
                <div className="kv-v">{formatMinutes(d.uptime_minutes ?? 0)}</div>
              </div>
              <div className="kv">
                <div className="kv-k">Brightness</div>
                <div className="kv-v">{d.brightness}</div>
              </div>
              <div className="kv">
                <div className="kv-k">Volume</div>
                <div className="kv-v">
                  {d.volume_current}/{d.volume_max}
                </div>
              </div>
              <div className="kv">
                <div className="kv-k">Charging</div>
                <div className="kv-v">{chargingLabel}</div>
              </div>
            </div>
          </section>

          {/* Storage */}
          <section className="panel sketch-panel detail-panel">
            <h2 className="panel-title">Storage</h2>

            <div className="kv-grid one-col">
              <div className="kv">
                <div className="kv-k">Internal shared storage</div>
                <div className="kv-v">
                  {d.storage_used_mb != null && d.storage_total_mb != null ? (
                    <>
                      {mbToGb(usedMb)} GB of {mbToGb(totalMb)} GB
                      {usedPercent != null && ` (${usedPercent}%)`}
                    </>
                  ) : d.storage_used_mb != null ? (
                    `${d.storage_used_mb} MB used`
                  ) : (
                    "-"
                  )}
                </div>
              </div>

              {d.storage_total_mb != null && d.storage_used_mb != null && (
                <div className="field-note">
                  Used {usedMb} MB of total {totalMb} MB.
                </div>
              )}
            </div>
          </section>

          {/* Network */}
          <section className="panel sketch-panel detail-panel">
            <h2 className="panel-title">Network</h2>

            <div className="kv-grid one-col">
              <div className="kv">
                <div className="kv-k">Signal strength</div>
                <div className="kv-v">
                  <span className="wifi-icon">📶</span>{" "}
                  {wifiStrengthPercent(d.wifi_rssi ?? 0)}%
                </div>
              </div>
              <div className="kv">
                <div className="kv-k">SSID</div>
                <div className="kv-v">{d.wifi_ssid}</div>
              </div>
              <div className="kv">
                <div className="kv-k">Frequency</div>
                <div className="kv-v">{d.wifi_frequency_mhz} MHz</div>
              </div>
              <div className="kv">
                <div className="kv-k">Link speed</div>
                <div className="kv-v">{d.wifi_link_mbps} Mbps</div>
              </div>
              <div className="kv">
                <div className="kv-k">IP address</div>
                <div className="kv-v mono">{d.ip}</div>
              </div>
              <div className="kv">
                <div className="kv-k">MAC address</div>
                <div className="kv-v mono">{d.mac}</div>
              </div>
              <div className="kv">
                <div className="kv-k">BSSID</div>
                <div className="kv-v mono">{d.wifi_bssid}</div>
              </div>
              <div className="kv">
                <div className="kv-k">RSSI</div>
                <div className="kv-v">{d.wifi_rssi} dBm</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default DeviceDetailPage;