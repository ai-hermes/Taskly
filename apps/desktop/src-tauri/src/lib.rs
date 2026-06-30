mod ocr;
mod permissions;
mod screenshot;
mod window_monitor;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
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
async fn capture_screenshot(_app: tauri::AppHandle) -> Result<String, String> {
    screenshot::capture_focused_window().map_err(|e| format!("Screenshot failed: {}", e))
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
async fn get_active_window() -> Result<String, String> {
    window_monitor::get_frontmost_app().map_err(|e| format!("Failed to get active window: {}", e))
}

#[tauri::command]
async fn is_whitelisted_app() -> Result<bool, String> {
    let app_name = window_monitor::get_frontmost_app()
        .map_err(|e| format!("Failed to get active window: {}", e))?;
    Ok(window_monitor::is_whitelisted(&app_name))
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
        .invoke_handler(tauri::generate_handler![
            capture_screenshot,
            get_active_window,
            is_whitelisted_app,
            recognize_image,
            open_widget_window,
            close_widget_window,
            show_main_window,
            set_debugger_console,
            check_screen_recording_permission,
            request_screen_recording_permission,
            open_screen_recording_settings,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(DOCK_ICON);
            }

            // Log permission status at startup to aid debugging.
            eprintln!(
                "[permissions] startup: screen recording granted = {}",
                permissions::has_screen_recording_permission()
            );

            // Build tray menu
            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let widget_item = MenuItem::with_id(app, "widget", "显示 Widget", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &widget_item, &quit_item])?;

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
        .run(|_app_handle, event| {
            if matches!(event, RunEvent::Ready) {
                set_macos_dock_icon();
            }
        });
}
