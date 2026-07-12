import { invoke } from "@tauri-apps/api/core";
import type { TodoItem } from "@/types";

/**
 * Copy evidence screenshots of freshly captured todos from the OS temp dir
 * into the app data dir so they survive temp cleanup. Returns todos with
 * their sourceEvidence.screenshotPath rewritten to the durable location.
 */
export async function persistEvidenceScreenshots(
  todos: TodoItem[]
): Promise<TodoItem[]> {
  const cache = new Map<string, string>();
  const out: TodoItem[] = [];
  for (const todo of todos) {
    const src = todo.sourceEvidence?.screenshotPath;
    if (!src) {
      out.push(todo);
      continue;
    }
    let durable = cache.get(src);
    if (durable === undefined) {
      try {
        durable = await invoke<string>("persist_screenshot", { path: src });
      } catch (err) {
        console.warn("[screenshots] persist failed for %s:", src, err);
        durable = src;
      }
      cache.set(src, durable);
    }
    out.push(
      durable === src
        ? todo
        : {
            ...todo,
            sourceEvidence: { ...todo.sourceEvidence!, screenshotPath: durable },
          }
    );
  }
  return out;
}

/**
 * Remove screenshots no todo references anymore (durable dir) and stale
 * temp captures. Screenshots still referenced by a todo are always kept.
 */
export async function cleanupScreenshots(todos: TodoItem[]): Promise<void> {
  const keepPaths = todos
    .map((t) => t.sourceEvidence?.screenshotPath)
    .filter((p): p is string => Boolean(p));
  try {
    await invoke("cleanup_screenshots", { keepPaths });
  } catch (err) {
    console.warn("[screenshots] cleanup failed:", err);
  }
}
