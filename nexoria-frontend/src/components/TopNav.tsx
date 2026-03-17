// src/components/TopNav.tsx

import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import logo from "../assets/nexoria-logo.png";


const TopNav: React.FC = () => {
  const location = useLocation();

  const isDashboardSection =
    location.pathname === "/" || location.pathname.startsWith("/device/");

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `nav-link ${isActive ? "active" : ""}`;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={logo} alt="Nexoria Logo" className="sidebar-logo" />
        <div className="logo-subtitle">Quest Headset Management</div>
      </div>

      <nav className="sidebar-links">
        <NavLink
          to="/"
          className={() => `nav-link ${isDashboardSection ? "active" : ""}`}
        >
          Dashboard
        </NavLink>

        <NavLink to="/analytics" className={linkClass}>
          Analytics
        </NavLink>

      </nav>
    </aside>
  );
};

export default TopNav;
