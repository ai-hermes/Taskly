use std::process::Command;

/// Capture a screenshot of the currently focused window on macOS.
/// Returns the file path of the saved screenshot.
pub fn capture_focused_window() -> Result<String, Box<dyn std::error::Error>> {
    // Use macOS screencapture command for the focused window
    let temp_dir = std::env::temp_dir();
    let filename = format!("taskly_screenshot_{}.png", chrono_timestamp());
    let filepath = temp_dir.join(&filename);

    let output = Command::new("screencapture")
        .args(["-l", &get_focused_window_id()?, filepath.to_str().unwrap()])
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "screencapture failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    Ok(filepath.to_string_lossy().to_string())
}

/// Get the window ID of the currently focused window using AppleScript
fn get_focused_window_id() -> Result<String, Box<dyn std::error::Error>> {
    let output = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events"
                set frontApp to name of first application process whose frontmost is true
                tell process frontApp
                    set winId to id of front window
                end tell
                return winId
            end tell"#,
        ])
        .output()?;

    if !output.status.success() {
        // Fallback: capture the entire screen of the focused app
        return Ok("0".to_string());
    }

    let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(id)
}

fn chrono_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}
