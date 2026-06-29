use std::{error::Error, process::Command};

/// Capture a screenshot of the currently focused window on macOS.
/// Returns the file path of the saved screenshot.
pub fn capture_focused_window() -> Result<String, Box<dyn Error>> {
    // Use macOS screencapture command for the focused window
    let temp_dir = std::env::temp_dir();
    let filename = format!("taskly_screenshot_{}.png", chrono_timestamp());
    let filepath = temp_dir.join(&filename);

    let filepath_str = filepath
        .to_str()
        .ok_or("Invalid temporary path for screenshot")?;

    let focused_capture_error = match get_focused_window_id() {
        Ok(window_id) if !window_id.is_empty() => {
            let window_arg = format!("-l{}", window_id);
            match run_screencapture(&["-x", &window_arg, filepath_str]) {
                Ok(()) => return Ok(filepath.to_string_lossy().to_string()),
                Err(error) => error.to_string(),
            }
        }
        Ok(_) => "focused window id was empty".to_string(),
        Err(error) => format!("could not resolve focused window id: {}", error),
    };

    if let Err(fallback_error) = run_screencapture(&["-x", filepath_str]) {
        return Err(format!(
            "focused-window capture failed ({}); full-screen fallback failed ({})",
            focused_capture_error, fallback_error
        )
        .into());
    }

    Ok(filepath.to_string_lossy().to_string())
}

/// Get the window ID of the currently focused window using AppleScript
fn get_focused_window_id() -> Result<String, Box<dyn Error>> {
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
        return Err(format!(
            "Failed to get focused window id: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }

    let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if id.is_empty() {
        return Err("Focused window id was empty".into());
    }

    Ok(id)
}

fn run_screencapture(args: &[&str]) -> Result<(), Box<dyn Error>> {
    let output = Command::new("screencapture").args(args).output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!("screencapture failed with status {}", output.status)
        } else {
            format!("screencapture failed: {}", stderr)
        };
        return Err(message.into());
    }

    Ok(())
}

fn chrono_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}
