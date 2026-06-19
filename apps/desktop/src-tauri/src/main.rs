// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, State};
use std::path::PathBuf;

struct SidecarHandle(Mutex<Option<std::process::Child>>);
struct QvacDir(PathBuf);
struct DataDir(PathBuf);

/// Resolve the path to the QVAC backend directory.
/// Tries (in order):
///   1. Tauri resource dir /qvac (bundled in release builds)
///   2. Next to the binary /qvac (portable mode)
///   3. Dev fallback: ../../qvac from the repo layout
fn qvac_dir(app: &tauri::App) -> PathBuf {
    // 1. Tauri resource bundle
    if let Ok(res) = app.path().resource_dir() {
        let bundled = res.join("qvac");
        if bundled.join("src").join("index.js").exists() {
            return bundled;
        }
    }

    // 2. Next to the binary (portable / extracted)
    let exe = std::env::current_exe().expect("current_exe");
    let dir = exe.parent().expect("exe parent").to_path_buf();
    let portable = dir.join("qvac");
    if portable.join("src").join("index.js").exists() {
        return portable;
    }

    // 3. Dev fallback: repo layout (apps/desktop/src-tauri/../../qvac)
    dir.parent()
        .expect("repo root")
        .parent()
        .expect("repo root")
        .join("qvac")
}

fn docker_available() -> bool {
    Command::new("docker")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn docker_image_built(tag: &str) -> bool {
    Command::new("docker")
        .args(["images", "-q", tag])
        .output()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false)
}

fn spawn_qvac_docker(qvac_dir: &PathBuf, data_dir: &PathBuf) -> Result<std::process::Child, String> {
    let tag = "chimera-desktop:latest";

    if !docker_image_built(tag) {
        let dockerfile = qvac_dir.join("Dockerfile");
        let status = Command::new("docker")
            .args(["build", "-t", tag, "-f", dockerfile.to_str().unwrap(), qvac_dir.to_str().unwrap()])
            .status()
            .map_err(|e| format!("docker build failed: {}", e))?;
        if !status.success() {
            return Err("docker build exited with non-zero status".to_string());
        }
    }

    let _ = std::fs::create_dir_all(data_dir.join("llmwiki-data"));
    let _ = std::fs::create_dir_all(data_dir.join("data"));

    let child = Command::new("docker")
        .args([
            "run", "--rm", "--name", "chimera-desktop",
            "-p", "3002:3002",
            "-v", &format!("{}:/app/llmwiki-data", data_dir.join("llmwiki-data").to_string_lossy()),
            "-v", &format!("{}:/app/data", data_dir.join("data").to_string_lossy()),
            "-e", "PORT=3002",
            tag,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("docker run failed: {}", e))?;

    Ok(child)
}

fn spawn_qvac(state: State<SidecarHandle>, qvac_dir: &PathBuf, data_dir: &PathBuf) -> Result<String, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok("qvac already running".to_string());
    }

    if !docker_available() {
        return Err("Docker is required to run Chimera. Please install Docker Desktop and try again.".to_string());
    }

    let child = spawn_qvac_docker(qvac_dir, data_dir)
        .map_err(|e| format!("Docker failed: {}", e))?;

    *guard = Some(child);
    Ok("qvac started (docker)".to_string())
}

#[tauri::command]
fn start_supervisor(state: State<SidecarHandle>, qvac_dir: State<QvacDir>, data_dir: State<DataDir>) -> Result<String, String> {
    spawn_qvac(state, &qvac_dir.0, &data_dir.0)
}

#[tauri::command]
fn stop_supervisor(state: State<SidecarHandle>) -> Result<String, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    // Also stop the named container if it is still running
    let _ = Command::new("docker")
        .args(["stop", "-t", "5", "chimera-desktop"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    Ok("qvac stopped".to_string())
}

#[tauri::command]
fn supervisor_status(state: State<SidecarHandle>) -> Result<bool, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.is_some())
}

#[tauri::command]
fn docker_status() -> Result<bool, String> {
    Ok(docker_available())
}

#[derive(serde::Serialize)]
struct UpdateCheckResult {
    has_update: bool,
    current_version: String,
    latest_version: String,
    download_url: String,
}

#[tauri::command]
async fn check_for_updates() -> Result<UpdateCheckResult, String> {
    const API: &str = "https://api.github.com/repos/TerexitariusStomp/qvac-chimera/releases/latest";
    const CURRENT: &str = env!("CARGO_PKG_VERSION");

    let client = reqwest::Client::builder()
        .user_agent(format!("Chimera-Desktop/{}", CURRENT))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(API).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let latest = json["tag_name"]
        .as_str()
        .unwrap_or("v0.0.0")
        .trim_start_matches('v')
        .to_string();

    let current = CURRENT.to_string();
    let has = latest != current && !latest.is_empty() && latest != "0.0.0";

    Ok(UpdateCheckResult {
        has_update: has,
        current_version: current,
        latest_version: latest,
        download_url: "https://github.com/TerexitariusStomp/qvac-chimera/releases/latest".to_string(),
    })
}

#[derive(serde::Serialize)]
struct PrefResult {
    enabled: bool,
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<bool, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe.to_str().ok_or("invalid exe path")?;

    if cfg!(windows) {
        use std::process::Command;
        let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
        if enabled {
            Command::new("reg")
                .args(["add", key, "/v", "Chimera", "/t", "REG_SZ", "/d", exe_str, "/f"])
                .output()
                .map_err(|e| e.to_string())?;
        } else {
            Command::new("reg")
                .args(["delete", key, "/v", "Chimera", "/f"])
                .output()
                .map_err(|e| e.to_string())?;
        }
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let plist_dir = std::path::PathBuf::from(&home).join("Library/LaunchAgents");
        let plist = plist_dir.join("com.chimera.desktop.plist");
        if enabled {
            let _ = std::fs::create_dir_all(&plist_dir);
            let content = format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.chimera.desktop</string>
    <key>ProgramArguments</key>
    <array><string>{}</string></array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>"#, exe_str);
            std::fs::write(&plist, content).map_err(|e| e.to_string())?;
            let _ = Command::new("launchctl").args(["load", plist.to_str().unwrap_or("")]).output();
        } else {
            let _ = Command::new("launchctl").args(["unload", plist.to_str().unwrap_or("")]).output();
            let _ = std::fs::remove_file(&plist);
        }
    } else {
        // Linux: systemd user service
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let svc_dir = std::path::PathBuf::from(&home).join(".config/systemd/user");
        let svc = svc_dir.join("chimera.service");
        if enabled {
            let _ = std::fs::create_dir_all(&svc_dir);
            let content = format!(r#"[Unit]
Description=Chimera Local AI Node
After=network.target
[Service]
Type=simple
ExecStart={}
Restart=on-failure
[Install]
WantedBy=default.target
"#, exe_str);
            std::fs::write(&svc, content).map_err(|e| e.to_string())?;
            let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).output();
            let _ = Command::new("systemctl").args(["--user", "enable", "--now", "chimera.service"]).output();
        } else {
            let _ = Command::new("systemctl").args(["--user", "disable", "--now", "chimera.service"]).output();
            let _ = std::fs::remove_file(&svc);
            let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).output();
        }
    }
    Ok(enabled)
}

#[tauri::command]
fn get_autostart() -> Result<bool, String> {
    if cfg!(windows) {
        use std::process::Command;
        let out = Command::new("reg")
            .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "/v", "Chimera"])
            .output()
            .map_err(|e| e.to_string())?;
        Ok(out.status.success())
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let plist = std::path::PathBuf::from(&home).join("Library/LaunchAgents/com.chimera.desktop.plist");
        Ok(plist.exists())
    } else {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let svc = std::path::PathBuf::from(&home).join(".config/systemd/user/chimera.service");
        Ok(svc.exists())
    }
}

#[tauri::command]
fn create_desktop_shortcut() -> Result<bool, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe.to_str().ok_or("invalid exe path")?;

    if cfg!(windows) {
        use std::process::Command;
        let home = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
        let desk = std::path::PathBuf::from(&home).join("Desktop/Chimera.lnk");
        let vbs = format!(r#"Set ws = WScript.CreateObject("WScript.Shell")
Set lnk = ws.CreateShortcut("{}")
lnk.TargetPath = "{}"
lnk.IconLocation = "{},0"
lnk.Save"#, desk.to_str().unwrap_or(""), exe_str, exe_str);
        let tmp = std::env::temp_dir().join("mklnk.vbs");
        std::fs::write(&tmp, vbs).map_err(|e| e.to_string())?;
        Command::new("cscript").args(["/nologo", tmp.to_str().unwrap_or("")]).output().map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&tmp);
    } else if cfg!(target_os = "linux") {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let desk = std::path::PathBuf::from(&home).join("Desktop/chimera.desktop");
        let content = format!(r#"[Desktop Entry]
Name=Chimera
Comment=Local AI that earns when idle
Exec={}
Type=Application
Terminal=false
"#, exe_str);
        std::fs::write(&desk, content).map_err(|e| e.to_string())?;
        let _ = Command::new("chmod").args(["+x", desk.to_str().unwrap_or("")]).output();
    }
    Ok(true)
}

#[tauri::command]
fn remove_desktop_shortcut() -> Result<bool, String> {
    if cfg!(windows) {
        let home = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(std::path::PathBuf::from(&home).join("Desktop/Chimera.lnk"));
    } else if cfg!(target_os = "linux") {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(std::path::PathBuf::from(&home).join("Desktop/chimera.desktop"));
    }
    Ok(true)
}

#[tauri::command]
fn has_desktop_shortcut() -> Result<bool, String> {
    if cfg!(windows) {
        let home = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
        Ok(std::path::PathBuf::from(&home).join("Desktop/Chimera.lnk").exists())
    } else if cfg!(target_os = "linux") {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        Ok(std::path::PathBuf::from(&home).join("Desktop/chimera.desktop").exists())
    } else {
        Ok(false)
    }
}

fn data_dir() -> PathBuf {
    if cfg!(windows) {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string()));
        PathBuf::from(appdata).join("chimera")
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".local/share/chimera")
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarHandle(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            start_supervisor,
            stop_supervisor,
            supervisor_status,
            docker_status,
            check_for_updates,
            set_autostart,
            get_autostart,
            create_desktop_shortcut,
            remove_desktop_shortcut,
            has_desktop_shortcut
        ])
        .setup(|app| {
            let qvac = qvac_dir(app);
            app.manage(QvacDir(qvac.clone()));
            let dd = data_dir();
            app.manage(DataDir(dd.clone()));
            let handle: State<SidecarHandle> = app.state();
            let _ = spawn_qvac(handle, &qvac, &dd);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
