import { homedir } from "node:os";
import { join } from "node:path";

/** Root directory for Taskly CLI state. Override with TASKLY_HOME. */
export function tasklyHome(): string {
  return process.env.TASKLY_HOME?.trim() || join(homedir(), ".taskly");
}

export function configPath(): string {
  return join(tasklyHome(), "config.json");
}

export function storePath(): string {
  return join(tasklyHome(), "todos.json");
}
