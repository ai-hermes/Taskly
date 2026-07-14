/**
 * Framework-agnostic shared data model for Taskly.
 *
 * These types are the canonical todo model used by the desktop app, the CLI,
 * and the server sync protocol. The desktop app extends `TodoItem` with UI /
 * agent-execution fields; consumers that only deal with the data model should
 * import from here.
 */

export type TodoReviewStatus = "confirmed" | "pending_confirmation";

export type TodoKind = "actionable" | "notification";

export interface OcrRegion {
  text: string;
  confidence: number;
  box: number[][];
}

export interface TodoSourceEvidence {
  screenshotPath?: string;
  matchedRegions: OcrRegion[];
}

/** Canonical todo record shared across desktop, CLI and server. */
export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  done: boolean;
  source: string;
  sourceText?: string;
  priority: number;
  dueDate?: string;
  reviewStatus?: TodoReviewStatus;
  todoKind?: TodoKind;
  sourceEvidence?: TodoSourceEvidence;
  createdAt: string;
  updatedAt: string;
  /** Normalized-title (+ due-day) hash used for deduplication. */
  fingerprint?: string;
  /** How the todo was completed (manual UI vs an agent run). */
  completedBy?: "manual" | "agent";
}

export interface Tombstone {
  fingerprint: string;
  normalizedTitle: string;
  /** Epoch millis when the todo was deleted. */
  deletedAt: number;
}

export interface ExtractTodoOptions {
  knownTitles?: string[];
  screenshotPath?: string;
  ocrDetails?: OcrRegion[];
}

export interface LLMProvider {
  name: string;
  extractTodos(ocrText: string, options?: ExtractTodoOptions): Promise<TodoItem[]>;
}

/** Sync payload exchanged with the Taskly server (`/api/v1/sync`). */
export interface SyncPayload {
  todos: TodoItem[];
  timestamp: number;
  deviceId: string;
}
