import { invoke } from "@tauri-apps/api/core";

export async function showMainWindow(): Promise<void> {
  await invoke("show_main_window");
}

export async function listRunningApps(): Promise<string[]> {
  return invoke<string[]>("list_running_apps");
}

export async function getActiveWindow(): Promise<string> {
  return invoke<string>("get_active_window");
}

/** Bring the given app to the foreground (macOS). Best-effort. */
export async function activateApp(appName: string): Promise<void> {
  await invoke("activate_app", { appName });
}
