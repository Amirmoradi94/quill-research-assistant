use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
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

fn spawn_dev_backend() -> Option<Child> {
    let script = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|web_dir| web_dir.parent())
        .map(|root| root.join("scripts/start_backend_desktop.sh"))?;

    Command::new(script)
        .env("POSTDOC_DESKTOP", "1")
        .env("PORT", "8000")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarProcesses(Mutex::new(Vec::new())))
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
            let state = app.state::<SidecarProcesses>();
            if let Ok(mut children) = state.0.lock() {
                if let Some(scraper) = app
                    .shell()
                    .sidecar("postdoc-scraper")
                    .ok()
                    .and_then(|command| {
                        command
                            .env("POSTDOC_DESKTOP", "1")
                            .env("SCRAPER_PORT", "8001")
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
                            .env("PORT", "8000")
                            .env("POSTDOC_DISABLE_REPLY_POLLER", "1")
                            .env("SCRAPER_URL", "http://127.0.0.1:8001")
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
                    .or_else(|| spawn_dev_backend().map(SidecarChild::DevScript))
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
