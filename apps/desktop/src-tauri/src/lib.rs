mod screenshot;
mod window_monitor;

use tauri::Manager;

#[tauri::command]
async fn capture_screenshot(app: tauri::AppHandle) -> Result<String, String> {
    screenshot::capture_focused_window()
        .map_err(|e| format!("Screenshot failed: {}", e))
}

#[tauri::command]
async fn get_active_window() -> Result<String, String> {
    window_monitor::get_frontmost_app()
        .map_err(|e| format!("Failed to get active window: {}", e))
}

#[tauri::command]
async fn is_whitelisted_app() -> Result<bool, String> {
    let app_name = window_monitor::get_frontmost_app()
        .map_err(|e| format!("Failed to get active window: {}", e))?;
    Ok(window_monitor::is_whitelisted(&app_name))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            capture_screenshot,
            get_active_window,
            is_whitelisted_app,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
