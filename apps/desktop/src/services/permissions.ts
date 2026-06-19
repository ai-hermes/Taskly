import { invoke } from "@tauri-apps/api/core";

/**
 * Whether the app currently has macOS Screen Recording permission.
 * Always true on non-macOS platforms.
 */
export async function checkScreenRecordingPermission(): Promise<boolean> {
  try {
    return await invoke<boolean>("check_screen_recording_permission");
  } catch (err) {
    console.error("[permissions] check failed:", err);
    return false;
  }
}

/**
 * Trigger the macOS system permission prompt (adds the app to the
 * Screen Recording list on first call). Returns the current status.
 */
export async function requestScreenRecordingPermission(): Promise<boolean> {
  try {
    return await invoke<boolean>("request_screen_recording_permission");
  } catch (err) {
    console.error("[permissions] request failed:", err);
    return false;
  }
}

/**
 * Open the Screen Recording pane in macOS System Settings.
 */
export async function openScreenRecordingSettings(): Promise<void> {
  try {
    await invoke("open_screen_recording_settings");
  } catch (err) {
    console.error("[permissions] open settings failed:", err);
  }
}
