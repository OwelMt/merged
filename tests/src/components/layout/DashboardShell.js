import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import SidebarAdmin from "./Sidebar";
import SidebarDRRMO from "./SidebarDRRMO";
import SidebarBarangay from "./SidebarBarangay";

import "../css/sidebar.css";
import Confirm from "../common/Confirm";
import SplashScreen from "../splashscreen/SplashScreen";
import { API_BASE_URL } from "../../config/api";

export default function DashboardShell({ children, variant }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [username, setUsername] = useState("");

  const BASE_URL = API_BASE_URL;

  const resolved =
    variant ??
    (pathname.startsWith("/drrmo")
      ? "drrmo"
      : pathname.startsWith("/accountant")
      ? "accountant"
      : pathname.startsWith("/barangay")
      ? "barangay"
      : "admin");

  const roleLabel = useMemo(() => {
    if (resolved === "drrmo") return "DRRMO";
    if (resolved === "accountant") return "Accountant";
    if (resolved === "barangay") return "Barangay";
    return "Administrator";
  }, [resolved]);

  const SidebarComp =
    resolved === "drrmo"
      ? SidebarDRRMO
      : resolved === "barangay"
      ? SidebarBarangay
      : SidebarAdmin;

  const requestLogout = () => setConfirmOpen(true);

  const doLogout = async () => {
    setConfirmOpen(false);
    setShowSplash(true);

    try {
      await fetch(`${BASE_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      }).catch(() => {});
    } finally {
      localStorage.clear();
      sessionStorage.clear();

      window.setTimeout(() => {
        setShowSplash(false);
        navigate("/Login", { replace: true });
      }, 1200);
    }
  };

  const onToggle = () => {
    setCollapsed((prev) => !prev);
  };

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setMobileOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const storedUsername =
      localStorage.getItem("username") ||
      sessionStorage.getItem("username") ||
      localStorage.getItem("name") ||
      sessionStorage.getItem("name") ||
      "";

    setUsername(storedUsername);
  }, []);

  return (
    <div
      className={`admin-layout ${collapsed ? "has-collapsed" : ""} ${
        mobileOpen ? "has-mobile-sidebar" : ""
      }`}
    >
      <button
        type="button"
        className="mobile-sidebar-toggle"
        onClick={() => setMobileOpen(true)}
        aria-label="Open sidebar"
      >
        ☰
      </button>

      {mobileOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-label="Close sidebar overlay"
        />
      )}

      <div className={`sidebar-shell ${mobileOpen ? "is-open" : ""}`}>
        <SidebarComp
          variant={resolved}
          collapsed={collapsed}
          onToggle={onToggle}
          onLogout={requestLogout}
          onNavigateMobile={() => setMobileOpen(false)}
          username={username}
          roleLabel={roleLabel}
        />
      </div>

      <main className="admin-main">
        <header className="dashboard-topbar">
          <div className="shell-profile-inline">
            <div className="shell-profile-meta">
              <span className="shell-profile-kicker">Signed in as</span>
              <strong className="shell-profile-name">
                {username || "Unknown User"}
              </strong>
              <span className="shell-profile-role">{roleLabel}</span>
            </div>
            <div className="shell-profile-avatar">
              {(username || roleLabel || "U").charAt(0).toUpperCase()}
            </div>
          </div>
        </header>
        <section className="admin-content">
          <div className="admin-content-inner">
            <div className="shell-page-content">{children}</div>
          </div>
        </section>
      </main>

      <Confirm
        open={confirmOpen}
        title="Log out"
        message="Are you sure you want to log out?"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={doLogout}
      />

      {showSplash && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            background: "#fff",
          }}
        >
          <SplashScreen />
        </div>
      )}
    </div>
  );
}
