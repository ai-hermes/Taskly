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
