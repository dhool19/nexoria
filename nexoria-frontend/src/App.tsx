// src/App.tsx

import React, { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import "./App.css";
import TopNav from "./components/TopNav";
import DashboardPage from "./pages/DashboardPage";
import DeviceDetailPage from "./pages/DeviceDetailPage";
import BatteryAnomalyPage from "./pages/BatteryAnomalyPage";
import ThermalComfortPage from "./pages/ThermalComfortPage";
import NetworkPerformancePage from "./pages/NetworkPerformancePage";
import AnalyticsPage from "./pages/AnalyticsPage";
import DeviceAnalyticsPage from "./pages/DeviceAnalyticsPage";
import type { ApiResponse, DeviceRow } from "./types";

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string) || "http://localhost:5000";

const App: React.FC = () => {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let interval: number | undefined;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`${API_BASE_URL}/devices`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data: ApiResponse = await res.json();
        const rows: DeviceRow[] = Object.entries(data).map(([id, info]) => ({
          id,
          ...info,
        }));

        setDevices(rows);
      } catch (err: any) {
        setError(err?.message || "Failed to load devices");
      } finally {
        setLoading(false);
      }
    };

    load();
    interval = window.setInterval(load, 10000);

    return () => {
      if (interval) window.clearInterval(interval);
    };
  }, []);

  return (
    <Router>
      <div className="app-layout">
        <TopNav />

        <main className="main-content">
          <Routes>
            <Route
              path="/"
              element={
                <DashboardPage devices={devices} loading={loading} error={error} />
              }
            />

            <Route path="/analytics" element={<AnalyticsPage devices={devices} />} />
            
            <Route
              path="/device/:id"
              element={<DeviceDetailPage devices={devices} loading={loading} />}
            />

            <Route
              path="/device/:id/analytics"
              element={<DeviceAnalyticsPage />}
            />

            <Route
              path="/device/:id/battery-anomaly"
              element={<BatteryAnomalyPage />}
            />
            <Route
              path="/device/:id/thermal-comfort"
              element={<ThermalComfortPage />}
            />
            <Route
              path="/device/:id/network-performance"
              element={<NetworkPerformancePage />}
            />
          </Routes>
        </main>
      </div>
    </Router>
  );
};

export default App;
