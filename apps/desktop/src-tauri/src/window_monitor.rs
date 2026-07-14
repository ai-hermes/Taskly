use std::process::Command;

/// Default whitelist of monitored applications, used when the caller does not
/// provide an explicit (user-configured) whitelist.
pub const DEFAULT_WHITELIST: &[&str] = &["微信", "WeChat", "Weixin"];

/// Get the name of the frontmost application on macOS
pub fn get_frontmost_app() -> Result<String, Box<dyn std::error::Error>> {
    let output = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events" to get name of first application process whose frontmost is true"#,
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[window] failed to get frontmost app: {}", stderr.trim());
        return Err(format!("Failed to get frontmost app: {}", stderr).into());
    }

    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    eprintln!("[window] frontmost app = {:?}", name);
    Ok(name)
}

/// List the currently running GUI applications on macOS.
///
/// Uses System Events to enumerate application processes that are not
/// background-only, i.e. apps that appear in the Dock / have a UI. Results are
/// sorted and de-duplicated for a stable picker experience.
pub fn list_running_apps() -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let output = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events" to get name of every application process whose background only is false"#,
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[window] failed to list running apps: {}", stderr.trim());
        return Err(format!("Failed to list running apps: {}", stderr).into());
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let mut apps: Vec<String> = raw
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    apps.sort_by_key(|name| name.to_lowercase());
    apps.dedup();
    Ok(apps)
}

/// Bring the given application to the foreground on macOS.
///
/// Uses System Events to set the matching application *process* frontmost, which
/// works with the process names surfaced by [`list_running_apps`] /
/// [`get_frontmost_app`] (e.g. "WeChat", "微信"). This lets the capture-fence
/// wizard pull the target app forward automatically before taking a screenshot.
pub fn activate_app(app_name: &str) -> Result<(), Box<dyn std::error::Error>> {
    let name = app_name.trim();
    if name.is_empty() {
        return Err("empty app name".into());
    }
    // Escape embedded double quotes for the AppleScript string literal.
    let escaped = name.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        r#"tell application "System Events" to set frontmost of (first application process whose name is "{escaped}") to true"#
    );
    let output = Command::new("osascript").args(["-e", &script]).output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[window] failed to activate app {:?}: {}", name, stderr.trim());
        return Err(format!("Failed to activate app: {}", stderr).into());
    }

    eprintln!("[window] activated app = {:?}", name);
    Ok(())
}

/// Check if the given application name matches the provided whitelist.
///
/// When `whitelist` is empty (e.g. no user configuration was passed), falls
/// back to [`DEFAULT_WHITELIST`]. Matching is a case-sensitive substring test,
/// consistent with the frontend monitor check.
pub fn is_whitelisted(app_name: &str, whitelist: &[String]) -> bool {
    let patterns: Vec<&str> = whitelist
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    if patterns.is_empty() {
        return DEFAULT_WHITELIST
            .iter()
            .any(|&name| app_name.contains(name));
    }

    patterns.iter().any(|name| app_name.contains(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wl(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn test_whitelist_default_fallback() {
        // Empty config -> default whitelist applies.
        assert!(is_whitelisted("微信", &[]));
        assert!(is_whitelisted("WeChat", &[]));
        assert!(!is_whitelisted("Safari", &[]));
    }

    #[test]
    fn test_whitelist_custom_config() {
        let whitelist = wl(&["Slack", "钉钉"]);
        assert!(is_whitelisted("Slack", &whitelist));
        assert!(is_whitelisted("钉钉", &whitelist));
        // Default entries are no longer implied once a custom list is provided.
        assert!(!is_whitelisted("微信", &whitelist));
    }

    #[test]
    fn test_whitelist_ignores_blank_entries() {
        // A whitelist that only contains blanks behaves like an empty one.
        assert!(is_whitelisted("微信", &wl(&["", "  "])));
    }
}
