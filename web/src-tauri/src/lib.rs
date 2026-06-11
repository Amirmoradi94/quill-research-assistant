use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

enum BackendChild {
    Sidecar(CommandChild),
    DevScript(Child),
}

struct BackendProcess(Mutex<Option<BackendChild>>);

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
        .plugin(tauri_plugin_shell::init())
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            let state = app.state::<BackendProcess>();
            if let Ok(mut slot) = state.0.lock() {
                let sidecar = app
                    .shell()
                    .sidecar("postdoc-backend")
                    .ok()
                    .and_then(|command| command.env("POSTDOC_DESKTOP", "1").env("PORT", "8000").spawn().ok())
                    .map(|(_, child)| BackendChild::Sidecar(child));
                *slot = sidecar.or_else(|| spawn_dev_backend().map(BackendChild::DevScript));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<BackendProcess>();
                if let Ok(mut slot) = state.0.lock() {
                    if let Some(child) = slot.take() {
                        match child {
                            BackendChild::Sidecar(child) => {
                                let _ = child.kill();
                            }
                            BackendChild::DevScript(mut child) => {
                                let _ = child.kill();
                            }
                        }
                    }
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Postdoc Dashboard");
}
