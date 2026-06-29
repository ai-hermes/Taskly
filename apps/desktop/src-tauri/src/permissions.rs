//! macOS screen recording permission helpers.
//!
//! Capturing other applications' windows via `screencapture` requires the
//! "Screen & System Audio Recording" permission. We use the official
//! CoreGraphics APIs to detect and request it.

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    /// Returns whether the current process already has screen capture access.
    /// Does not prompt the user.
    fn CGPreflightScreenCaptureAccess() -> bool;

    /// Requests screen capture access. On first call it adds the app to the
    /// Screen Recording list and prompts the user. Returns the current status.
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Whether the app currently has screen recording permission.
#[cfg(target_os = "macos")]
pub fn has_screen_recording_permission() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

/// Trigger the system permission prompt (first time) and return current status.
#[cfg(target_os = "macos")]
pub fn request_screen_recording_permission() -> bool {
    unsafe { CGRequestScreenCaptureAccess() }
}

/// Open the Screen Recording settings pane in System Settings.
#[cfg(target_os = "macos")]
pub fn open_screen_recording_settings() -> Result<(), Box<dyn std::error::Error>> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn()?;
    Ok(())
}

// Non-macOS stubs so the crate builds everywhere.
#[cfg(not(target_os = "macos"))]
pub fn has_screen_recording_permission() -> bool {
    true
}

#[cfg(not(target_os = "macos"))]
pub fn request_screen_recording_permission() -> bool {
    true
}

#[cfg(not(target_os = "macos"))]
pub fn open_screen_recording_settings() -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}
