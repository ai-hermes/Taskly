/**
 * Deduplication + fingerprint helpers.
 *
 * The core logic now lives in `@taskly/core` so it can be shared with the
 * Taskly CLI. This module re-exports it and keeps the desktop-only frame-cache
 * tuning constants used by the OCR monitor.
 */
export * from "@taskly/core";

/** Frame-level OCR cache tuning (used by MonitorService). */
export const FRAME_CACHE_SIZE = 15;
export const FRAME_CACHE_TTL_MS = 3 * 60 * 1000;
