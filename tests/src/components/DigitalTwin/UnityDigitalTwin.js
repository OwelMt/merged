import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardShell from "../layout/DashboardShell";
import "../css/DigitalTwin.css";
import { API_BASE_URL } from "../../config/api";

const LOGIC2_BASE_URL = String(process.env.REACT_APP_LOGIC2_API_URL || "").replace(/\/+$/, "");
const IS_LOCAL_HOST =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);
const WATER_LEVEL_API_BASES = IS_LOCAL_HOST
  ? [API_BASE_URL, LOGIC2_BASE_URL].filter(Boolean)
  : [API_BASE_URL];
const POLL_INTERVAL_MS = 10000;

const fetchFromAnyBase = async (path) => {
  let lastError = null;

  for (const baseUrl of WATER_LEVEL_API_BASES) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        return { data, baseUrl, status: response.status };
      }

      if (response.status === 404) {
        lastError = new Error(`Route not found on ${baseUrl}`);
        continue;
      }

      const message = await response.text();
      lastError = new Error(message || `Request failed on ${baseUrl}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Failed to fetch water level records.");
};

const formatDateTime = (value) => {
  if (!value) return "No reading yet";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No reading yet";

  return parsed.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getStatusTone = (status) => {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "DANGER") return "danger";
  if (normalized === "WARNING") return "warning";
  return "safe";
};

const getStatusLabel = (status) => {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "DANGER") return "Danger";
  if (normalized === "WARNING") return "Warning";
  return "Safe";
};

const normalizeHistory = (items) =>
  Array.isArray(items)
    ? items.map((item, index) => ({
        id:
          item?._id ||
          `${item?.camera_id || "camera"}-${item?.timestamp || index}-${index}`,
        water_level: toNumber(item?.water_level, 0),
        warning_level: toNumber(item?.warning_level, 8),
        danger_level: toNumber(item?.danger_level, 10),
        status: String(item?.status || "SAFE").toUpperCase(),
        camera_id: item?.camera_id || "cam_1",
        timestamp: item?.timestamp || item?.createdAt || null,
      }))
    : [];

export default function UnityDigitalTwin() {
  const iframeRef = useRef(null);
  const [allReadings, setAllReadings] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState("cam_1");
  const [latestReading, setLatestReading] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const cameraIds = useMemo(() => {
    const unique = Array.from(
      new Set(
        (allReadings || [])
          .map((item) => String(item?.camera_id || "").trim())
          .filter(Boolean)
      )
    );

    return unique.length ? unique : ["cam_1"];
  }, [allReadings]);

  const fetchAllReadings = useCallback(async () => {
    const { data } = await fetchFromAnyBase("/api/water-levels");
    const items = Array.isArray(data) ? data : [];
    setAllReadings(items);

    if (!selectedCamera && items[0]?.camera_id) {
      setSelectedCamera(String(items[0].camera_id));
    }
  }, [selectedCamera]);

  const fetchCameraData = useCallback(
    async (cameraId) => {
      if (!cameraId) return;

      setHistoryLoading(true);

      const [latestResult, historyResult] = await Promise.all([
        fetchFromAnyBase(
          `/api/water-levels/latest/${encodeURIComponent(cameraId)}`
        ).catch((error) => ({ error })),
        fetchFromAnyBase(
          `/api/water-levels/history/${encodeURIComponent(cameraId)}`
        ).catch((error) => ({ error })),
      ]);

      if (historyResult?.error) {
        throw new Error("Failed to fetch water level history.");
      }

      if (latestResult?.error) {
        const latestMessage = String(latestResult.error?.message || "");
        if (!/route not found/i.test(latestMessage) && !/404/.test(latestMessage)) {
          throw new Error("Failed to fetch latest water level.");
        }
      }

      const latestData = latestResult?.data || null;
      const historyData = historyResult?.data || [];
      const normalizedHistory = normalizeHistory(historyData);

      setLatestReading(
        latestData && Object.keys(latestData).length
          ? {
              ...latestData,
              water_level: toNumber(latestData.water_level, 0),
              warning_level: toNumber(latestData.warning_level, 8),
              danger_level: toNumber(latestData.danger_level, 10),
              status: String(latestData.status || "SAFE").toUpperCase(),
              camera_id: latestData.camera_id || cameraId,
              timestamp: latestData.timestamp || latestData.createdAt || null,
            }
          : null
      );
      setHistory(normalizedHistory);
      setLastSyncedAt(new Date().toISOString());
      setHistoryLoading(false);
    },
    []
  );

  const refreshData = useCallback(async () => {
    try {
      setError("");
      setLoading(true);

      await fetchAllReadings();
      await fetchCameraData(selectedCamera || "cam_1");
    } catch (fetchError) {
      setError(
        fetchError?.message ||
          "Unable to sync Digital Twin water-level data right now."
      );
    } finally {
      setLoading(false);
      setHistoryLoading(false);
    }
  }, [fetchAllReadings, fetchCameraData, selectedCamera]);

  useEffect(() => {
    refreshData();

    const intervalId = window.setInterval(refreshData, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [refreshData]);

  useEffect(() => {
    if (!cameraIds.includes(selectedCamera)) {
      setSelectedCamera(cameraIds[0] || "cam_1");
    }
  }, [cameraIds, selectedCamera]);

  useEffect(() => {
    if (!selectedCamera) return;

    let isActive = true;

    const loadCameraData = async () => {
      try {
        setError("");
        await fetchCameraData(selectedCamera);
      } catch (fetchError) {
        if (!isActive) return;
        setError(
          fetchError?.message ||
            "Unable to sync Digital Twin water-level data right now."
        );
      } finally {
        if (isActive) {
          setLoading(false);
          setHistoryLoading(false);
        }
      }
    };

    loadCameraData();

    return () => {
      isActive = false;
    };
  }, [fetchCameraData, selectedCamera]);

  useEffect(() => {
    const payload = latestReading
      ? {
          camera_id: latestReading.camera_id,
          water_level: latestReading.water_level,
          warning_level: latestReading.warning_level,
          danger_level: latestReading.danger_level,
          status: latestReading.status,
          timestamp: latestReading.timestamp,
          history: history.slice(-8),
        }
      : {
          camera_id: selectedCamera,
          water_level: 0,
          warning_level: 8,
          danger_level: 10,
          status: "SAFE",
          timestamp: null,
          history: [],
        };

    if (!iframeRef.current?.contentWindow) return;

    iframeRef.current.contentWindow.postMessage(
      {
        type: "SAGIP_WATER_LEVEL_UPDATE",
        payload,
      },
      "*"
    );
  }, [history, latestReading, selectedCamera]);

  const currentLevel = toNumber(latestReading?.water_level, 0);
  const warningLevel = toNumber(latestReading?.warning_level, 8);
  const dangerLevel = toNumber(latestReading?.danger_level, 10);
  const currentStatus = latestReading?.status || "SAFE";
  const statusTone = getStatusTone(currentStatus);
  const latestHistory = history.slice(-8).reverse();

  return (
    <DashboardShell>
      <div className="digital-twin-page">
        <section className="digital-twin-hero">
          <div>
            <span className="digital-twin-kicker">Water Monitoring</span>
            <h1>Digital Twin Flood Monitoring</h1>
            <p>
              Watch the Unity simulation alongside live backend readings,
              warning thresholds, and recent water-level movement.
            </p>
          </div>

          <div className="digital-twin-hero-actions">
            <div className={`digital-twin-status-pill ${statusTone}`}>
              <span className="digital-twin-dot" aria-hidden="true" />
              <span>{getStatusLabel(currentStatus)}</span>
            </div>

            <button
              type="button"
              className="digital-twin-refresh-btn"
              onClick={refreshData}
            >
              <span className="digital-twin-btn-mark" aria-hidden="true">
                ↻
              </span>
              Refresh
            </button>
          </div>
        </section>

        <section className="digital-twin-summary-grid">
          <article className="digital-twin-summary-card level">
            <span>Current Water Level</span>
            <strong>{currentLevel.toFixed(2)} m</strong>
            <small>
              {latestReading ? `Camera ${latestReading.camera_id}` : "No live reading"}
            </small>
          </article>

          <article className="digital-twin-summary-card warning">
            <span>Warning Level</span>
            <strong>{warningLevel.toFixed(2)} m</strong>
            <small>Raise operations monitoring</small>
          </article>

          <article className="digital-twin-summary-card danger">
            <span>Danger Level</span>
            <strong>{dangerLevel.toFixed(2)} m</strong>
            <small>Escalate response readiness</small>
          </article>

          <article className="digital-twin-summary-card cameras">
            <span>Monitored Cameras</span>
            <strong>{cameraIds.length}</strong>
            <small>{cameraIds.join(", ")}</small>
          </article>
        </section>

        <section className="digital-twin-board">
          <div className="digital-twin-main-panel">
            <div className="digital-twin-panel-head">
              <div>
                <h2>Unity Digital Twin</h2>
                <p>
                  Live simulation frame fed by the latest DRRMO water-level
                  readings.
                </p>
              </div>

              <div className="digital-twin-toolbar">
                <label className="digital-twin-camera-picker">
                  <span>Camera</span>
                  <select
                    value={selectedCamera}
                    onChange={(event) => setSelectedCamera(event.target.value)}
                  >
                    {cameraIds.map((cameraId) => (
                      <option key={cameraId} value={cameraId}>
                        {cameraId}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="digital-twin-frame-wrap">
              <iframe
                ref={iframeRef}
                title="Sagip Bayan Digital Twin"
                src="/unity/digital-twin/index.html"
                className="digital-twin-frame"
                allowFullScreen
              />
            </div>

            {error ? (
              <div className="digital-twin-inline-alert error">
                <span className="digital-twin-inline-mark" aria-hidden="true">
                  !
                </span>
                <span>{error}</span>
              </div>
            ) : loading ? (
              <div className="digital-twin-inline-alert loading">
                <span className="digital-twin-inline-mark" aria-hidden="true">
                  ~
                </span>
                <span>Syncing live water-level data...</span>
              </div>
            ) : (
              <div className="digital-twin-inline-alert info">
                <span className="digital-twin-inline-mark" aria-hidden="true">
                  •
                </span>
                <span>Last synced: {formatDateTime(lastSyncedAt)}</span>
              </div>
            )}
          </div>

          <aside className="digital-twin-side-panel">
            <section className="digital-twin-side-card">
              <div className="digital-twin-side-head">
                <h3>Live Reading</h3>
                <span className={`digital-twin-status-chip ${statusTone}`}>
                  {getStatusLabel(currentStatus)}
                </span>
              </div>

              <div className="digital-twin-reading-grid">
                <div>
                  <span>
                    Camera
                  </span>
                  <strong>{latestReading?.camera_id || selectedCamera}</strong>
                </div>

                <div>
                  <span>
                    Water Level
                  </span>
                  <strong>{currentLevel.toFixed(2)} m</strong>
                </div>

                <div>
                  <span>
                    Warning
                  </span>
                  <strong>{warningLevel.toFixed(2)} m</strong>
                </div>

                <div>
                  <span>
                    Danger
                  </span>
                  <strong>{dangerLevel.toFixed(2)} m</strong>
                </div>
              </div>
            </section>

            <section className="digital-twin-side-card">
              <div className="digital-twin-side-head">
                <h3>Recent History</h3>
                <span className="digital-twin-history-count">
                  {latestHistory.length} reading(s)
                </span>
              </div>

              {historyLoading ? (
                <div className="digital-twin-history-empty">
                  Loading recent readings...
                </div>
              ) : latestHistory.length ? (
                <div className="digital-twin-history-list">
                  {latestHistory.map((entry) => (
                    <div key={entry.id} className="digital-twin-history-item">
                      <div>
                        <strong>{entry.water_level.toFixed(2)} m</strong>
                        <span>{formatDateTime(entry.timestamp)}</span>
                      </div>

                      <span
                        className={`digital-twin-history-status ${getStatusTone(
                          entry.status
                        )}`}
                      >
                        {getStatusLabel(entry.status)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="digital-twin-history-empty">
                  No recent readings for this camera yet.
                </div>
              )}
            </section>
          </aside>
        </section>
      </div>
    </DashboardShell>
  );
}
