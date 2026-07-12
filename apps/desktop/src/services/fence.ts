import type { FenceRect, OcrRegion } from "@/types";

/** Clamp a fence to sane [0,1] bounds; returns null if degenerate. */
export function normalizeFence(fence: FenceRect): FenceRect | null {
  const x = Math.min(Math.max(fence.x, 0), 1);
  const y = Math.min(Math.max(fence.y, 0), 1);
  const width = Math.min(Math.max(fence.width, 0), 1 - x);
  const height = Math.min(Math.max(fence.height, 0), 1 - y);
  if (width <= 0.01 || height <= 0.01) return null;
  return { x, y, width, height };
}

/**
 * Coerce persisted fence data into a rect list. Tolerates the legacy
 * single-object shape and drops degenerate rects.
 */
export function normalizeFences(input: unknown): FenceRect[] {
  const raw = Array.isArray(input) ? input : input ? [input] : [];
  const out: FenceRect[] = [];
  for (const item of raw) {
    if (item && typeof item === "object") {
      const norm = normalizeFence(item as FenceRect);
      if (norm) out.push(norm);
    }
  }
  return out;
}

/** Center of an OCR polygon box (pixel coordinates). */
function boxCenter(box: number[][]): { x: number; y: number } | null {
  const xs = box?.map((p) => p?.[0]).filter((n): n is number => typeof n === "number");
  const ys = box?.map((p) => p?.[1]).filter((n): n is number => typeof n === "number");
  if (!xs?.length || !ys?.length) return null;
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/** True if a point (pixels) lies inside the relative fence rect. */
function pointInFence(
  px: number,
  py: number,
  fence: FenceRect,
  imageWidth: number,
  imageHeight: number
): boolean {
  const left = fence.x * imageWidth;
  const top = fence.y * imageHeight;
  const right = (fence.x + fence.width) * imageWidth;
  const bottom = (fence.y + fence.height) * imageHeight;
  return px >= left && px <= right && py >= top && py <= bottom;
}

/**
 * Keep only OCR regions whose center falls inside ANY of the fence rects.
 * Regions without usable box coordinates are kept (never silently drop text
 * we can't locate). Returns the input array if no valid fence filters anything.
 */
export function filterRegionsByFences(
  regions: OcrRegion[],
  fences: FenceRect[],
  imageWidth: number,
  imageHeight: number
): OcrRegion[] {
  const norm = normalizeFences(fences);
  if (norm.length === 0 || imageWidth <= 0 || imageHeight <= 0) return regions;

  const kept = regions.filter((r) => {
    const c = boxCenter(r.box);
    if (!c) return true;
    return norm.some((f) => pointInFence(c.x, c.y, f, imageWidth, imageHeight));
  });
  return kept.length === regions.length ? regions : kept;
}

/**
 * Rebuild OCR plain text from regions, sorted top-to-bottom then
 * left-to-right, matching the reading order of the original OCR output.
 */
export function rebuildText(regions: OcrRegion[]): string {
  const sortable = regions.map((r) => {
    const c = boxCenter(r.box);
    return { text: r.text, x: c?.x ?? 0, y: c?.y ?? 0 };
  });
  sortable.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
  return sortable
    .map((r) => r.text)
    .filter(Boolean)
    .join("\n");
}
