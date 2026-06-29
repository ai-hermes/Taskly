import { invoke } from "@tauri-apps/api/core";

export async function showMainWindow(): Promise<void> {
  await invoke("show_main_window");
}
