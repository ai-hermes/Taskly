use std::process::Command;

/// Screenshots referenced by todos are copied here (under the app data dir) so
/// they survive OS temp-dir cleanup.
const PERSIST_SUBDIR: &str = "screenshots";
/// Temp screenshots older than this are considered stale and reaped.
const TEMP_TTL_SECS: u64 = 60 * 60;

/// Directory for durable, todo-referenced screenshots.
fn screenshots_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    use tauri::Manager;
    let dir = app.path().app_data_dir()?.join(PERSIST_SUBDIR);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Copy a temp screenshot into the durable screenshots dir and return the new
/// path. Idempotent: returns the durable path directly if already persisted.
pub fn persist_screenshot(
    app: &tauri::AppHandle,
    src: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let src_path = std::path::Path::new(src);
    let dir = screenshots_dir(app)?;
    if src_path.starts_with(&dir) {
        return Ok(src.to_string());
    }
    let file_name = src_path
        .file_name()
        .ok_or("Invalid screenshot path")?;
    let dest = dir.join(file_name);
    if !dest.exists() {
        std::fs::copy(src_path, &dest)?;
        eprintln!("[screenshot] persisted {:?} -> {:?}", src_path, dest);
    }
    Ok(dest.to_string_lossy().to_string())
}

/// Reap screenshots that are no longer needed:
///  - durable screenshots not referenced by any todo (`keep` paths), and
///  - stale `taskly_screenshot_*.png` temp files older than the TTL that are
///    not referenced either.
/// Returns the number of files removed.
pub fn cleanup_screenshots(
    app: &tauri::AppHandle,
    keep: &[String],
) -> Result<usize, Box<dyn std::error::Error>> {
    use std::collections::HashSet;
    use std::ffi::OsString;

    let keep_names: HashSet<OsString> = keep
        .iter()
        .filter_map(|p| std::path::Path::new(p).file_name().map(|n| n.to_os_string()))
        .collect();
    let mut removed = 0usize;

    // Durable dir: drop anything no todo references anymore.
    let dir = screenshots_dir(app)?;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || keep_names.contains(&entry.file_name()) {
                continue;
            }
            if std::fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }

    // Temp dir: reap stale captures, but never one a todo still points at.
    let now = std::time::SystemTime::now();
    if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy().to_string();
            if !name_str.starts_with("taskly_screenshot_") || !name_str.ends_with(".png") {
                continue;
            }
            if keep_names.contains(&name) {
                continue;
            }
            let stale = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| now.duration_since(t).ok())
                .map(|age| age.as_secs() > TEMP_TTL_SECS)
                .unwrap_or(false);
            if stale && std::fs::remove_file(entry.path()).is_ok() {
                removed += 1;
            }
        }
    }

    if removed > 0 {
        eprintln!("[screenshot] cleanup removed {} file(s)", removed);
    }
    Ok(removed)
}

/// Capture a screenshot of the monitored (frontmost, whitelisted) window on macOS.
/// Returns the file path of the saved screenshot.
///
/// We resolve the real CoreGraphics window number of the frontmost app and pass
/// it to `screencapture -l`, so only that single window is captured instead of
/// the whole desktop. Capturing the whole screen produced very noisy OCR output
/// (file trees, editors, dev tools, etc.).
pub fn capture_focused_window(whitelist: &[String]) -> Result<String, Box<dyn std::error::Error>> {
    let temp_dir = std::env::temp_dir();
    let filename = format!("taskly_screenshot_{}.png", chrono_timestamp());
    let filepath = temp_dir.join(&filename);

    let filepath_str = filepath
        .to_str()
        .ok_or("Invalid temporary path for screenshot")?;
    let app_name = crate::window_monitor::get_frontmost_app().unwrap_or_default();
    let window_id = frontmost_window_cg_id(&app_name, whitelist);
    eprintln!(
        "[screenshot] frontmost app={:?} cg_window_id={:?} -> {}",
        app_name, window_id, filepath_str
    );

    let output = match window_id {
        Some(id) => Command::new("screencapture")
            .args(["-l", &id.to_string(), "-o", "-x", filepath_str])
            .output()?,
        None => {
            // Fallback: capture the entire main display.
            eprintln!(
                "[screenshot] no CG window id for {:?}, capturing full screen",
                app_name
            );
            Command::new("screencapture")
                .args(["-x", filepath_str])
                .output()?
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[screenshot] screencapture failed: {}", stderr);
        return Err(format!("screencapture failed: {}", stderr).into());
    }

    // Verify the file was actually written and is non-empty.
    match std::fs::metadata(&filepath) {
        Ok(meta) if meta.len() > 0 => {
            eprintln!("[screenshot] captured {} bytes", meta.len());
        }
        Ok(_) => {
            eprintln!("[screenshot] WARNING: screenshot file is empty (check Screen Recording permission)");
            return Err(
                "Screenshot file empty; grant Screen Recording permission to Taskly".into(),
            );
        }
        Err(e) => {
            eprintln!("[screenshot] WARNING: screenshot file missing: {}", e);
            return Err(format!("Screenshot not created: {}", e).into());
        }
    }

    Ok(filepath.to_string_lossy().to_string())
}

/// Find the CoreGraphics window number of the frontmost on-screen window that
/// belongs to a whitelisted (monitored) app. Returns `None` if none is found.
#[cfg(target_os = "macos")]
fn frontmost_window_cg_id(_app_name: &str, whitelist: &[String]) -> Option<i64> {
    use std::ffi::{c_void, CStr};

    type CFRef = *const c_void;

    const KCG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1 << 0;
    const KCG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS: u32 = 1 << 4;
    const KCG_NULL_WINDOW_ID: u32 = 0;
    const KCF_NUMBER_SINT64_TYPE: isize = 4;
    const KCF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        static kCGWindowOwnerName: CFRef;
        static kCGWindowNumber: CFRef;
        static kCGWindowLayer: CFRef;
        fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: u32) -> CFRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(arr: CFRef) -> isize;
        fn CFArrayGetValueAtIndex(arr: CFRef, idx: isize) -> CFRef;
        fn CFDictionaryGetValue(dict: CFRef, key: CFRef) -> CFRef;
        fn CFNumberGetValue(num: CFRef, the_type: isize, value_ptr: *mut c_void) -> bool;
        fn CFStringGetCString(s: CFRef, buf: *mut i8, buf_size: isize, encoding: u32) -> bool;
        fn CFRelease(cf: CFRef);
    }

    unsafe fn dict_get_i64(dict: CFRef, key: CFRef) -> Option<i64> {
        let val = CFDictionaryGetValue(dict, key);
        if val.is_null() {
            return None;
        }
        let mut out: i64 = 0;
        let ok = CFNumberGetValue(
            val,
            KCF_NUMBER_SINT64_TYPE,
            &mut out as *mut i64 as *mut c_void,
        );
        if ok {
            Some(out)
        } else {
            None
        }
    }

    unsafe fn dict_get_string(dict: CFRef, key: CFRef) -> Option<String> {
        let val = CFDictionaryGetValue(dict, key);
        if val.is_null() {
            return None;
        }
        let mut buf = [0i8; 512];
        let ok = CFStringGetCString(
            val,
            buf.as_mut_ptr(),
            buf.len() as isize,
            KCF_STRING_ENCODING_UTF8,
        );
        if !ok {
            return None;
        }
        CStr::from_ptr(buf.as_ptr())
            .to_str()
            .ok()
            .map(|s| s.to_string())
    }

    unsafe {
        let options =
            KCG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY | KCG_WINDOW_LIST_EXCLUDE_DESKTOP_ELEMENTS;
        let arr = CGWindowListCopyWindowInfo(options, KCG_NULL_WINDOW_ID);
        if arr.is_null() {
            return None;
        }

        let count = CFArrayGetCount(arr);
        let mut result = None;
        // The list is ordered front-to-back, so the first match is the frontmost
        // window of the monitored app.
        for i in 0..count {
            let dict = CFArrayGetValueAtIndex(arr, i);
            if dict.is_null() {
                continue;
            }
            // Only consider normal application windows (layer 0); this filters
            // out the menu bar, dock, shadows and other system chrome.
            if dict_get_i64(dict, kCGWindowLayer) != Some(0) {
                continue;
            }
            if let Some(owner) = dict_get_string(dict, kCGWindowOwnerName) {
                if crate::window_monitor::is_whitelisted(&owner, whitelist) {
                    if let Some(num) = dict_get_i64(dict, kCGWindowNumber) {
                        eprintln!(
                            "[screenshot] matched window owner={:?} number={}",
                            owner, num
                        );
                        result = Some(num);
                        break;
                    }
                }
            }
        }

        CFRelease(arr);
        result
    }
}

#[cfg(not(target_os = "macos"))]
fn frontmost_window_cg_id(_app_name: &str, _whitelist: &[String]) -> Option<i64> {
    None
}

fn chrono_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}
