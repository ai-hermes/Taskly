import type { TodoItem, Tombstone } from "@/types";

/** Similarity threshold above which two titles are treated as the same todo. */
export const SIMILARITY_THRESHOLD = 0.85;

/** Frame-level OCR cache tuning (used by MonitorService). */
export const FRAME_CACHE_SIZE = 15;
export const FRAME_CACHE_TTL_MS = 3 * 60 * 1000;

// Common spoken-language prefixes that add no meaning to a task title.
const PREFIX_PATTERN =
  /^(?:请|麻烦|帮我|帮忙|记得|别忘了|不要忘记|需要|要|请你|你|我们|大家|一定要|务必|记住|note[:：]?|todo[:：]?|reminder[:：]?|please\s+)+/i;

/**
 * Normalize a title for fingerprinting / similarity:
 * trim, lowercase (latin), collapse whitespace, drop punctuation/emoji,
 * and strip common spoken-language prefixes.
 */
export function normalizeTitle(input: string): string {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  // Remove emoji and pictographs.
  s = s.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
    ""
  );
  // Strip spoken-language lead-ins (may repeat, e.g. "麻烦帮我...").
  let prev: string;
  do {
    prev = s;
    s = s.replace(PREFIX_PATTERN, "");
  } while (s !== prev && s.length > 0);
  // Drop punctuation (ASCII + CJK) but keep letters, digits, CJK, spaces.
  s = s.replace(
    /[\s]+|[!-/:-@[-`{-~\u3000-\u303F\uFF00-\uFFEF\u2000-\u206F]/gu,
    (m) => (/\s/.test(m) ? " " : "")
  );
  return s.replace(/\s+/g, " ").trim();
}

/** Normalize an ISO date-ish value down to a YYYY-MM-DD day bucket, if parseable. */
function normalizeDueDay(dueDate?: string): string {
  if (!dueDate) return "";
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** Small, stable non-cryptographic hash (FNV-1a) rendered as hex. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Fingerprint = hash(normalizedTitle [+ due-day]). */
export function fingerprint(todo: Pick<TodoItem, "title" | "dueDate">): string {
  const norm = normalizeTitle(todo.title);
  const day = normalizeDueDay(todo.dueDate);
  return hashString(day ? `${norm}|${day}` : norm);
}

/** Token set of a normalized title (per-character for CJK-friendliness + words). */
function tokenize(norm: string): Set<string> {
  const tokens = new Set<string>();
  if (!norm) return tokens;
  for (const word of norm.split(" ")) {
    if (word) tokens.add(word);
  }
  // Character bigrams to catch CJK near-duplicates without word boundaries.
  const chars = norm.replace(/\s+/g, "");
  for (let i = 0; i < chars.length - 1; i++) {
    tokens.add(chars.slice(i, i + 2));
  }
  if (chars.length === 1) tokens.add(chars);
  return tokens;
}

/** Jaccard similarity over token sets of two already-normalized titles. */
export function similarity(normA: string, normB: string): number {
  if (!normA && !normB) return 1;
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  const a = tokenize(normA);
  const b = tokenize(normB);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Return true if `norm` is fuzzily similar to any of the provided normalized titles. */
function fuzzyHit(norm: string, others: string[], threshold: number): boolean {
  for (const o of others) {
    if (similarity(norm, o) >= threshold) return true;
  }
  return false;
}

export interface DedupResult {
  /** Incoming items that survived dedup and should be added. */
  added: TodoItem[];
  /** Tombstones that were dropped because they expired during this pass. */
  liveTombstones: Tombstone[];
}

/**
 * Deduplicate incoming todos against existing todos and (unexpired) tombstones.
 *
 * Layers:
 *  - within-batch dedup by fingerprint
 *  - exact dedup vs existing (by fingerprint)
 *  - fuzzy dedup vs existing (normalized-title similarity >= threshold)
 *  - tombstone dedup: drop items matching an unexpired tombstone (exact or fuzzy)
 */
export function dedupTodos(
  incoming: TodoItem[],
  existing: TodoItem[],
  tombstones: Tombstone[],
  ttlMs: number,
  now: number = Date.now(),
  threshold: number = SIMILARITY_THRESHOLD
): DedupResult {
  // Prune expired tombstones (ttlMs <= 0 disables tombstones entirely).
  const liveTombstones =
    ttlMs > 0
      ? tombstones.filter((t) => t.deletedAt + ttlMs > now)
      : [];

  const existingFps = new Set(existing.map((t) => t.fingerprint || fingerprint(t)));
  const existingNorms = existing.map((t) => normalizeTitle(t.title));

  const tombFps = new Set(liveTombstones.map((t) => t.fingerprint));
  const tombNorms = liveTombstones.map((t) => t.normalizedTitle);

  const seenFps = new Set<string>();
  const acceptedNorms: string[] = [];
  const added: TodoItem[] = [];

  for (const item of incoming) {
    const fp = item.fingerprint || fingerprint(item);
    const norm = normalizeTitle(item.title);

    if (seenFps.has(fp)) continue; // within-batch exact
    if (existingFps.has(fp)) continue; // exact vs existing
    if (tombFps.has(fp)) continue; // exact vs tombstone
    if (fuzzyHit(norm, acceptedNorms, threshold)) continue; // within-batch fuzzy
    if (fuzzyHit(norm, existingNorms, threshold)) continue; // fuzzy vs existing
    if (fuzzyHit(norm, tombNorms, threshold)) continue; // fuzzy vs tombstone

    seenFps.add(fp);
    acceptedNorms.push(norm);
    added.push({ ...item, fingerprint: fp });
  }

  return { added, liveTombstones };
}

/**
 * Sweep near-duplicates out of the pending-confirmation section.
 *
 * A pending (not-done, reviewStatus === "pending_confirmation") todo is dropped
 * when it exactly or fuzzily matches:
 *  - any non-pending todo (confirmed or done), or
 *  - an earlier-kept pending todo (first occurrence wins).
 *
 * Returns the original array reference when nothing was removed.
 */
export function dedupPendingTodos(
  todos: TodoItem[],
  threshold: number = SIMILARITY_THRESHOLD
): TodoItem[] {
  const isPending = (t: TodoItem) =>
    !t.done && t.reviewStatus === "pending_confirmation";

  const anchorFps = new Set<string>();
  const anchorNorms: string[] = [];
  for (const t of todos) {
    if (!isPending(t)) {
      anchorFps.add(t.fingerprint || fingerprint(t));
      anchorNorms.push(normalizeTitle(t.title));
    }
  }

  const keptPendingFps = new Set<string>();
  const keptPendingNorms: string[] = [];
  const result: TodoItem[] = [];
  let removed = false;

  for (const t of todos) {
    if (!isPending(t)) {
      result.push(t);
      continue;
    }
    const fp = t.fingerprint || fingerprint(t);
    const norm = normalizeTitle(t.title);
    if (
      anchorFps.has(fp) ||
      keptPendingFps.has(fp) ||
      fuzzyHit(norm, anchorNorms, threshold) ||
      fuzzyHit(norm, keptPendingNorms, threshold)
    ) {
      removed = true;
      continue;
    }
    keptPendingFps.add(fp);
    keptPendingNorms.push(norm);
    result.push(t);
  }

  return removed ? result : todos;
}

/** Build a tombstone record for a deleted todo. */
export function makeTombstone(todo: TodoItem, now: number = Date.now()): Tombstone {
  return {
    fingerprint: todo.fingerprint || fingerprint(todo),
    normalizedTitle: normalizeTitle(todo.title),
    deletedAt: now,
  };
}

/** Prune expired tombstones (ttlMs <= 0 clears all). */
export function pruneTombstones(
  tombstones: Tombstone[],
  ttlMs: number,
  now: number = Date.now()
): Tombstone[] {
  if (ttlMs <= 0) return [];
  return tombstones.filter((t) => t.deletedAt + ttlMs > now);
}
