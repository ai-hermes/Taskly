import { invoke } from "@tauri-apps/api/core";

export async function setDebuggerConsole(enabled: boolean): Promise<void> {
  await invoke("set_debugger_console", { enabled });
}
