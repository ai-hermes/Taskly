use std::process::Command;

/// Default whitelist of monitored applications
const WHITELIST: &[&str] = &["微信", "WeChat"];

/// Get the name of the frontmost application on macOS
pub fn get_frontmost_app() -> Result<String, Box<dyn std::error::Error>> {
    let output = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events" to get name of first application process whose frontmost is true"#,
        ])
        .output()?;

    if !output.status.success() {
        return Err(format!(
            "Failed to get frontmost app: {}",
            String::from_utf8_lossy(&output.stderr)
        )
        .into());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Check if the given application name is in the whitelist
pub fn is_whitelisted(app_name: &str) -> bool {
    WHITELIST.iter().any(|&name| app_name.contains(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_whitelist_wechat() {
        assert!(is_whitelisted("微信"));
        assert!(is_whitelisted("WeChat"));
        assert!(!is_whitelisted("Safari"));
    }
}
