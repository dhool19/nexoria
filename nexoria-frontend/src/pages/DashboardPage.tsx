import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DeviceRow } from "../types";
import { matchesSearch, getOnlineStatus } from "../utils/deviceHelpers";

type DashboardProps = {
  devices: DeviceRow[];
  loading: boolean;
  error: string | null;
};

const DashboardPage: React.FC<DashboardProps> = ({ devices, loading, error }) => {
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

  const filtered = useMemo(
    () => devices.filter((d) => matchesSearch(d, search)),
    [devices, search]
  );

  return (
    <div className="page">
      <div className="section-header">
        <div>
          <h1>Devices</h1>
          <p className="section-subtitle">Manage your Quest headset fleet</p>
        </div>

        <div className="section-actions">
          <div className="search-wrapper">
            <input
              type="text"
              className="search-input"
              placeholder="Search by device_01, Android ID, model, room..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="search-icon">🔍</span>
          </div>
        </div>
      </div>

      {loading && <p>Loading devices...</p>}
      {error && <p className="error-text">Error: {error}</p>}

      {!loading && !error && (
        <div className="card-grid">
          {filtered.map((d) => {
            const status = getOnlineStatus(d.last_seen, 2);

            const statusClass =
              status === "online"
                ? "chip-online"
                : status === "offline"
                ? "chip-offline"
                : "chip-unknown";

            const statusText =
              status === "online"
                ? "Online"
                : status === "offline"
                ? "Offline"
                : "Unknown";

            return (
              <div key={d.id} className="device-card sketch-panel">
                <div className="device-card-top">
                  <div className="device-card-icon" aria-hidden="true">
                    <svg
                      width="28"
                      height="28"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="8" width="20" height="8" rx="3" />
                      <path d="M7 12h.01M17 12h.01" />
                    </svg>
                  </div>

                  <div className="device-card-content">
                    <div className="device-card-left">
                      <div className="device-card-name">
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
                      </div>

                      <div className="device-card-meta">
                        {d.device_code ? (
                          <>
                            Android ID <span className="mono">{d.id}</span>
                          </>
                        ) : (
                          <>
                            Serial <span className="mono">{d.id}</span>
                          </>
                        )}
                      </div>

                      <div className="device-card-meta">
                        Room {d.room || "Unknown"}
                      </div>

                      <div className="device-card-meta">
                        <span className={`chip ${statusClass}`}>
                          <span className="chip-dot" />
                          {statusText}
                        </span>
                      </div>
                    </div>

                    <div className="device-card-right">
                      <button
                        className="btn-outline"
                        onClick={() => navigate(`/device/${d.id}`)}
                      >
                        More details
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && !loading && !error && (
            <p>No devices match your search.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default DashboardPage;