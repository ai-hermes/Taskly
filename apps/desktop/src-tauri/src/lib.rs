mod screenshot;
mod window_monitor;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder,
};

#[tauri::command]
async fn capture_screenshot(_app: tauri::AppHandle) -> Result<String, String> {
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

#[tauri::command]
async fn open_widget_window(app: tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("widget").is_some() {
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "widget", WebviewUrl::App("/widget".into()))
        .title("Taskly Widget")
        .inner_size(240.0, 300.0)
        .decorations(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| format!("Failed to create widget window: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn close_widget_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("widget") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            capture_screenshot,
            get_active_window,
            is_whitelisted_app,
            open_widget_window,
            close_widget_window,
        ])
        .setup(|app| {
            // Build tray menu
            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let widget_item = MenuItem::with_id(app, "widget", "显示 Widget", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &widget_item, &quit_item])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Taskly - 智能待办管理")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "widget" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = open_widget_window(app_handle).await;
                        });
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
