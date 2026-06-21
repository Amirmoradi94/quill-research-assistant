use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

enum SidecarChild {
    Sidecar(CommandChild),
    DevScript(Child),
}

struct SidecarProcesses(Mutex<Vec<SidecarChild>>);

struct DesktopRuntime {
    api_base: String,
    backend_port: u16,
    scraper_port: u16,
}

fn append_log(log_path: &PathBuf, message: &str) {
    if let Some(parent) = log_path.parent() {
        let _ = create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(file, "{message}");
    }
}

fn sidecar_log_path(app_data_dir: &PathBuf, name: &str) -> PathBuf {
    app_data_dir.join(format!("{name}-sidecar.log"))
}

fn loopback_port_is_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn choose_loopback_port(preferred: u16, reserved: &[u16]) -> u16 {
    if !reserved.contains(&preferred) && loopback_port_is_available(preferred) {
        return preferred;
    }

    for port in preferred.saturating_add(1)..preferred.saturating_add(100) {
        if !reserved.contains(&port) && loopback_port_is_available(port) {
            return port;
        }
    }

    TcpListener::bind(("127.0.0.1", 0))
        .ok()
        .and_then(|listener| listener.local_addr().ok().map(|addr| addr.port()))
        .unwrap_or(preferred)
}

fn quill_data_dir() -> PathBuf {
    if let Ok(path) = std::env::var("POSTDOC_DATA_DIR") {
        return PathBuf::from(path);
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("QuillResearchAssistant");
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("QuillResearchAssistant");
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Ok(xdg_data_home) = std::env::var("XDG_DATA_HOME") {
            return PathBuf::from(xdg_data_home).join("QuillResearchAssistant");
        }
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("QuillResearchAssistant");
        }
    }

    std::env::temp_dir().join("QuillResearchAssistant")
}

fn stop_stale_sidecars() {
    for process_name in ["postdoc-backend", "postdoc-scraper"] {
        let _ = Command::new("/usr/bin/pkill")
            .arg("-x")
            .arg(process_name)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn publish_api_base(app: &tauri::App, runtime: &DesktopRuntime, app_data_dir: &PathBuf) {
    let script = format!(
        r#"
        window.__QUILL_API_BASE__ = {api_base:?};
        try {{ localStorage.setItem('quill.apiBase', {api_base:?}); }} catch (_) {{}}
        window.dispatchEvent(new CustomEvent('quill:api-base', {{ detail: {{ apiBase: {api_base:?} }} }}));
        "#,
        api_base = runtime.api_base
    );

    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.eval(script) {
            append_log(
                &sidecar_log_path(app_data_dir, "backend"),
                &format!("failed to publish api base to frontend: {error}"),
            );
        }
    }
}

fn spawn_dev_backend(backend_port: u16, scraper_port: u16) -> Option<Child> {
    let mut search_roots = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        search_roots.push(current_dir);
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            search_roots.push(parent.to_path_buf());
        }
    }

    let script = search_roots
        .into_iter()
        .flat_map(|root| root.ancestors().map(PathBuf::from).collect::<Vec<_>>())
        .map(|root| root.join("scripts/start_backend_desktop.sh"))
        .find(|candidate| candidate.is_file())?;

    Command::new(script)
        .env("POSTDOC_DESKTOP", "1")
        .env("PORT", backend_port.to_string())
        .env("SCRAPER_URL", format!("http://127.0.0.1:{scraper_port}"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

#[tauri::command]
fn quill_api_base(runtime: tauri::State<'_, DesktopRuntime>) -> String {
    runtime.api_base.clone()
}

pub fn run() {
    let backend_port = choose_loopback_port(8000, &[]);
    let scraper_port = choose_loopback_port(8001, &[backend_port]);
    let api_base = format!("http://127.0.0.1:{backend_port}");

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SidecarProcesses(Mutex::new(Vec::new())))
        .manage(DesktopRuntime {
            api_base,
            backend_port,
            scraper_port,
        })
        .invoke_handler(tauri::generate_handler![quill_api_base])
        .setup(|app| {
            stop_stale_sidecars();

            if std::env::var("QUILL_NOTIFICATION_SMOKE_TEST")
                .ok()
                .as_deref()
                == Some("1")
            {
                let _ = app
                    .notification()
                    .builder()
                    .title("Quill reminder test")
                    .body("Desktop notifications are working.")
                    .show();
                eprintln!("quill notification smoke test sent");
            }

            let app_data_dir = quill_data_dir();
            let runtime = app.state::<DesktopRuntime>();
            append_log(
                &sidecar_log_path(&app_data_dir, "backend"),
                &format!(
                    "desktop runtime: api_base={} backend_port={} scraper_port={}",
                    runtime.api_base, runtime.backend_port, runtime.scraper_port
                ),
            );
            publish_api_base(app, &runtime, &app_data_dir);

            let state = app.state::<SidecarProcesses>();
            if let Ok(mut children) = state.0.lock() {
                if let Some(scraper) = app
                    .shell()
                    .sidecar("postdoc-scraper")
                    .ok()
                    .and_then(|command| {
                        command
                            .env("POSTDOC_DESKTOP", "1")
                            .env("SCRAPER_PORT", runtime.scraper_port.to_string())
                            .spawn()
                            .ok()
                    })
                    .map(|(mut rx, child)| {
                        let log_path = sidecar_log_path(&app_data_dir, "scraper");
                        append_log(&log_path, "postdoc-scraper: spawned");
                        tauri::async_runtime::spawn(async move {
                            while let Some(event) = rx.recv().await {
                                match event {
                                    CommandEvent::Stdout(line) => {
                                        let text =
                                            String::from_utf8_lossy(&line).trim_end().to_string();
                                        if !text.is_empty() {
                                            append_log(
                                                &log_path,
                                                &format!("postdoc-scraper stdout: {text}"),
                                            );
                                        }
                                    }
                                    CommandEvent::Stderr(line) => {
                                        let text =
                                            String::from_utf8_lossy(&line).trim_end().to_string();
                                        if !text.is_empty() {
                                            append_log(
                                                &log_path,
                                                &format!("postdoc-scraper stderr: {text}"),
                                            );
                                        }
                                    }
                                    CommandEvent::Error(error) => {
                                        append_log(
                                            &log_path,
                                            &format!("postdoc-scraper event error: {error}"),
                                        );
                                    }
                                    CommandEvent::Terminated(payload) => {
                                        append_log(
                                            &log_path,
                                            &format!(
                                                "postdoc-scraper: terminated code={:?} signal={:?}",
                                                payload.code, payload.signal
                                            ),
                                        );
                                    }
                                    _ => {}
                                }
                            }
                        });
                        SidecarChild::Sidecar(child)
                    })
                {
                    children.push(scraper);
                }

                if let Some(backend) = app
                    .shell()
                    .sidecar("postdoc-backend")
                    .ok()
                    .and_then(|command| {
                        command
                            .env("POSTDOC_DESKTOP", "1")
                            .env("PORT", runtime.backend_port.to_string())
                            .env("POSTDOC_DISABLE_REPLY_POLLER", "1")
                            .env(
                                "SCRAPER_URL",
                                format!("http://127.0.0.1:{}", runtime.scraper_port),
                            )
                            .spawn()
                            .ok()
                    })
                    .map(|(mut rx, child)| {
                        let log_path = sidecar_log_path(&app_data_dir, "backend");
                        append_log(&log_path, "postdoc-backend: spawned");
                        tauri::async_runtime::spawn(async move {
                            while let Some(event) = rx.recv().await {
                                match event {
                                    CommandEvent::Stdout(line) => {
                                        let text =
                                            String::from_utf8_lossy(&line).trim_end().to_string();
                                        if !text.is_empty() {
                                            append_log(
                                                &log_path,
                                                &format!("postdoc-backend stdout: {text}"),
                                            );
                                        }
                                    }
                                    CommandEvent::Stderr(line) => {
                                        let text =
                                            String::from_utf8_lossy(&line).trim_end().to_string();
                                        if !text.is_empty() {
                                            append_log(
                                                &log_path,
                                                &format!("postdoc-backend stderr: {text}"),
                                            );
                                        }
                                    }
                                    CommandEvent::Error(error) => {
                                        append_log(
                                            &log_path,
                                            &format!("postdoc-backend event error: {error}"),
                                        );
                                    }
                                    CommandEvent::Terminated(payload) => {
                                        append_log(
                                            &log_path,
                                            &format!(
                                                "postdoc-backend: terminated code={:?} signal={:?}",
                                                payload.code, payload.signal
                                            ),
                                        );
                                    }
                                    _ => {}
                                }
                            }
                        });
                        SidecarChild::Sidecar(child)
                    })
                    .or_else(|| {
                        spawn_dev_backend(runtime.backend_port, runtime.scraper_port)
                            .map(SidecarChild::DevScript)
                    })
                {
                    children.push(backend);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<SidecarProcesses>();
                if let Ok(mut children) = state.0.lock() {
                    while let Some(child) = children.pop() {
                        match child {
                            SidecarChild::Sidecar(child) => {
                                let _ = child.kill();
                            }
                            SidecarChild::DevScript(mut child) => {
                                let _ = child.kill();
                            }
                        }
                    }
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Quill AI");
}
