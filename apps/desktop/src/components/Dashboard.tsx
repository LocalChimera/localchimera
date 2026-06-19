import { useState, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";

interface Status {
  running: boolean;
  docker_present: boolean;
  logs: string;
  error: string;
  app_url: string;
}

export function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState({ start: false, stop: false });
  const logsRef = useRef<HTMLDivElement>(null);

  // Settings state
  const [autoStart, setAutoStart] = useState(false);
  const [desktopIcon, setDesktopIcon] = useState(false);
  const [taskbarIcon, setTaskbarIcon] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState({ auto: false, desk: false, task: false });

  // Docker status
  const [dockerPresent, setDockerPresent] = useState<boolean | null>(null);

  const apiBase = "http://localhost:";
  const supervisorPort = "9876";

  const fetchStatus = async () => {
    if (!supervisorPort) return;
    try {
      const res = await fetch(`${apiBase}${supervisorPort}/status`);
      const data = await res.json();
      setStatus(data);
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    invoke<boolean>("docker_status").then(setDockerPresent).catch(() => setDockerPresent(false));
  }, []);

  useEffect(() => {
    if (logsRef.current && status?.logs) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [status?.logs]);

  // Load current settings on mount
  useEffect(() => {
    invoke<boolean>("get_autostart").then(setAutoStart).catch(() => {});
    invoke<boolean>("has_desktop_shortcut").then(setDesktopIcon).catch(() => {});
  }, []);

  const toggleAutoStart = async () => {
    setSettingsLoading(l => ({ ...l, auto: true }));
    const next = !autoStart;
    try {
      await invoke("set_autostart", { enabled: next });
      setAutoStart(next);
    } catch (e) { console.error(e); }
    setSettingsLoading(l => ({ ...l, auto: false }));
  };

  const toggleDesktopIcon = async () => {
    setSettingsLoading(l => ({ ...l, desk: true }));
    const next = !desktopIcon;
    try {
      if (next) await invoke("create_desktop_shortcut");
      else await invoke("remove_desktop_shortcut");
      setDesktopIcon(next);
    } catch (e) { console.error(e); }
    setSettingsLoading(l => ({ ...l, desk: false }));
  };

  const startApp = async () => {
    setLoading(l => ({ ...l, start: true }));
    try {
      await fetch(`${apiBase}${supervisorPort}/start`, { method: "POST" });
      await fetchStatus();
    } catch {}
    setLoading(l => ({ ...l, start: false }));
  };

  const stopApp = async () => {
    setLoading(l => ({ ...l, stop: true }));
    try {
      await fetch(`${apiBase}${supervisorPort}/stop`, { method: "POST" });
      await fetchStatus();
    } catch {}
    setLoading(l => ({ ...l, stop: false }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 800, margin: "0 auto" }}>
      {/* Docker required banner */}
      {dockerPresent === false && (
        <div style={{
          padding: "12px 16px",
          borderRadius: 8,
          background: "#450a0a",
          border: "1px solid #b91c1c",
          color: "#fca5a5",
          fontSize: 13,
          fontWeight: 600,
        }}>
          🐳 Docker is required. Chimera runs inside a hardened container.
          <a href="https://docs.docker.com/get-docker/" target="_blank" rel="noopener" style={{ color: "#00e5ff", marginLeft: 8 }}>Install Docker →</a>
        </div>
      )}

      {/* Status bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 20px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "#0b0a09",
      }}>
        <div>
          <div style={{ fontSize: 12, color: "#4a4540", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 4 }}>
            Container Status
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: status?.running ? "#86efac" : "#fca5a5" }}>
            {status?.running ? "🟢 Running" : "⚪ Stopped"}
          </div>
          {status?.error && (
            <div style={{ fontSize: 12, color: "#fca5a5", marginTop: 4 }}>
              Error: {status.error}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {!status?.running ? (
            <button
              onClick={startApp}
              disabled={loading.start || dockerPresent === false}
              style={{
                padding: "8px 18px",
                borderRadius: 6,
                border: "none",
                background: dockerPresent === false ? "#450a0a" : "#c9a96e",
                color: dockerPresent === false ? "#fca5a5" : "#0e0d0b",
                fontWeight: 600,
                fontSize: 13,
                cursor: (loading.start || dockerPresent === false) ? "not-allowed" : "pointer",
                opacity: (loading.start || dockerPresent === false) ? 0.5 : 1,
              }}
            >
              {loading.start ? "Starting..." : dockerPresent === false ? "🐳 Docker Required" : "▶ Start App"}
            </button>
          ) : (
            <button
              onClick={stopApp}
              disabled={loading.stop}
              style={{
                padding: "8px 18px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "transparent",
                color: "#fca5a5",
                fontWeight: 600,
                fontSize: 13,
                cursor: loading.stop ? "not-allowed" : "pointer",
                opacity: loading.stop ? 0.6 : 1,
              }}
            >
              {loading.stop ? "Stopping..." : "⏹ Stop App"}
            </button>
          )}
          {status?.app_url && (
            <button
              onClick={() => open(status.app_url)}
              style={{
                padding: "8px 18px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "#161410",
                color: "#b0a898",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Open App →
            </button>
          )}
        </div>
      </div>

      {/* Logs */}
      <div>
        <div style={{ fontSize: 12, color: "#4a4540", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 8 }}>
          Logs
        </div>
        <div
          ref={logsRef}
          style={{
            background: "#0b0a09",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10,
            padding: 14,
            height: 320,
            overflow: "auto",
            fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', monospace",
            fontSize: 12,
            lineHeight: 1.6,
            color: "#7a7468",
            whiteSpace: "pre-wrap",
          }}
        >
          {status?.logs || "No logs yet. Start the app to see output."}
        </div>
      </div>

      {/* Settings */}
      <div style={{
        padding: "16px 20px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "#0b0a09",
      }}>
        <div style={{ fontSize: 12, color: "#4a4540", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 12 }}>
          Settings
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Auto-start */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 13, color: "#b0a898" }}>Start on system boot</div>
              <div style={{ fontSize: 11, color: "#4a4540" }}>Auto-launch Chimera when you log in</div>
            </div>
            <button
              onClick={toggleAutoStart}
              disabled={settingsLoading.auto}
              style={{
                width: 44, height: 24, borderRadius: 12,
                background: autoStart ? "#00e5ff" : "#161410",
                border: "1px solid rgba(255,255,255,0.1)",
                position: "relative", cursor: "pointer", transition: "0.2s",
                opacity: settingsLoading.auto ? 0.6 : 1,
              }}
            >
              <span style={{
                position: "absolute", top: 2, left: autoStart ? 22 : 2,
                width: 18, height: 18, borderRadius: "50%", background: "#fff",
                transition: "0.2s", display: "block"
              }} />
            </button>
          </div>

          {/* Desktop icon */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 13, color: "#b0a898" }}>Desktop icon</div>
              <div style={{ fontSize: 11, color: "#4a4540" }}>Create a shortcut on your desktop</div>
            </div>
            <button
              onClick={toggleDesktopIcon}
              disabled={settingsLoading.desk}
              style={{
                width: 44, height: 24, borderRadius: 12,
                background: desktopIcon ? "#00e5ff" : "#161410",
                border: "1px solid rgba(255,255,255,0.1)",
                position: "relative", cursor: "pointer", transition: "0.2s",
                opacity: settingsLoading.desk ? 0.6 : 1,
              }}
            >
              <span style={{
                position: "absolute", top: 2, left: desktopIcon ? 22 : 2,
                width: 18, height: 18, borderRadius: "50%", background: "#fff",
                transition: "0.2s", display: "block"
              }} />
            </button>
          </div>

          {/* Taskbar pin note */}
          <div style={{ fontSize: 11, color: "#4a4540", marginTop: 4 }}>
            💡 To pin to taskbar: right-click the desktop shortcut → "Pin to taskbar"
          </div>
        </div>
      </div>
    </div>
  );
}
