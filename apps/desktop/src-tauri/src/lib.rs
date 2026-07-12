mod agent;
mod ocr;
mod permissions;
mod screenshot;
mod window_monitor;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent, WindowEvent,
};

const TRAY_ICON: tauri::image::Image<'_> = tauri::include_image!("./icons/trayIcon.png");
const DOCK_ICON: tauri::image::Image<'_> = tauri::include_image!("./icons/app-icon-1024.png");
const DOCK_ICON_PNG: &[u8] = include_bytes!("../icons/app-icon-1024.png");

#[cfg(target_os = "macos")]
fn set_macos_dock_icon() {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let app = NSApplication::sharedApplication(mtm);
    let data = NSData::with_bytes(DOCK_ICON_PNG);
    let app_icon = NSImage::initWithData(NSImage::alloc(), &data).expect("creating dock icon");
    unsafe { app.setApplicationIconImage(Some(&app_icon)) };
}

#[cfg(not(target_os = "macos"))]
fn set_macos_dock_icon() {}

#[tauri::command]
async fn capture_screenshot(
    _app: tauri::AppHandle,
    whitelist: Option<Vec<String>>,
) -> Result<String, String> {
    let whitelist = whitelist.unwrap_or_default();
    screenshot::capture_focused_window(&whitelist).map_err(|e| format!("Screenshot failed: {}", e))
}

#[tauri::command]
async fn persist_screenshot(app: tauri::AppHandle, path: String) -> Result<String, String> {
    screenshot::persist_screenshot(&app, &path)
        .map_err(|e| format!("Persist screenshot failed: {}", e))
}

#[tauri::command]
async fn cleanup_screenshots(
    app: tauri::AppHandle,
    keep_paths: Option<Vec<String>>,
) -> Result<usize, String> {
    screenshot::cleanup_screenshots(&app, &keep_paths.unwrap_or_default())
        .map_err(|e| format!("Cleanup screenshots failed: {}", e))
}

#[tauri::command]
fn check_screen_recording_permission() -> bool {
    let granted = permissions::has_screen_recording_permission();
    eprintln!("[permissions] screen recording granted = {}", granted);
    granted
}

#[tauri::command]
fn request_screen_recording_permission() -> bool {
    eprintln!("[permissions] requesting screen recording permission...");
    let granted = permissions::request_screen_recording_permission();
    eprintln!(
        "[permissions] after request, screen recording granted = {}",
        granted
    );
    granted
}

#[tauri::command]
fn open_screen_recording_settings() -> Result<(), String> {
    permissions::open_screen_recording_settings().map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_running_apps() -> Result<Vec<String>, String> {
    window_monitor::list_running_apps().map_err(|e| format!("Failed to list running apps: {}", e))
}

#[tauri::command]
async fn get_active_window() -> Result<String, String> {
    window_monitor::get_frontmost_app().map_err(|e| format!("Failed to get active window: {}", e))
}

#[tauri::command]
async fn is_whitelisted_app(whitelist: Option<Vec<String>>) -> Result<bool, String> {
    let whitelist = whitelist.unwrap_or_default();
    let app_name = window_monitor::get_frontmost_app()
        .map_err(|e| format!("Failed to get active window: {}", e))?;
    Ok(window_monitor::is_whitelisted(&app_name, &whitelist))
}

#[tauri::command]
async fn recognize_image(
    app: tauri::AppHandle,
    image_path: String,
) -> Result<ocr::OcrResponse, String> {
    tauri::async_runtime::spawn_blocking(move || ocr::recognize_image(&app, &image_path))
        .await
        .map_err(|e| format!("OCR task failed: {}", e))?
}

#[tauri::command]
async fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Main window not found".into())
    }
}

#[tauri::command]
async fn set_debugger_console(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        if let Some(window) = app.get_webview_window("main") {
            if enabled {
                window.open_devtools();
            } else {
                window.close_devtools();
            }
            Ok(())
        } else {
            Err("Main window not found".into())
        }
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        let _ = enabled;
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            capture_screenshot,
            persist_screenshot,
            cleanup_screenshots,
            get_active_window,
            is_whitelisted_app,
            list_running_apps,
            recognize_image,
            show_main_window,
            set_debugger_console,
            check_screen_recording_permission,
            request_screen_recording_permission,
            open_screen_recording_settings,
            agent::prepare_todo_workspace,
            agent::copy_assets_to_workspace,
            agent::execute_todo_once,
            agent::start_agent_session,
            agent::send_agent_message,
            agent::respond_agent_ui,
            agent::abort_agent_turn,
            agent::finish_agent_session,
            agent::cancel_agent_session,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(DOCK_ICON);

                // Closing the main window hides it to the background (tray)
                // instead of quitting. Use the tray "退出" item to fully exit.
                let main_window = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_window.hide();
                    }
                });
            }

            // Log permission status at startup to aid debugging.
            eprintln!(
                "[permissions] startup: screen recording granted = {}",
                permissions::has_screen_recording_permission()
            );

            // Build tray menu
            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(TRAY_ICON)
                .icon_as_template(true)
                .menu(&menu)
                .tooltip("Taskly - 智能待办管理")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Open devtools only when explicitly requested via env var,
            // e.g. `TASKLY_DEVTOOLS=1 pnpm dev`.
            #[cfg(debug_assertions)]
            {
                let want_devtools = std::env::var("TASKLY_DEVTOOLS")
                    .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE"))
                    .unwrap_or(false);
                if want_devtools {
                    if let Some(window) = app.get_webview_window("main") {
                        window.open_devtools();
                    }
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::Ready => {
                set_macos_dock_icon();
            }
            // Clicking the Dock icon (macOS) re-shows and focuses the main window.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        });
}
