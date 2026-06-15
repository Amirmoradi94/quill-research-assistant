use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

enum SidecarChild {
    Sidecar(CommandChild),
    DevScript(Child),
}

struct SidecarProcesses(Mutex<Vec<SidecarChild>>);

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
                    .map(|(_, child)| SidecarChild::Sidecar(child))
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
                            .env("SCRAPER_URL", "http://127.0.0.1:8001")
                            .spawn()
                            .ok()
                    })
                    .map(|(_, child)| SidecarChild::Sidecar(child))
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
