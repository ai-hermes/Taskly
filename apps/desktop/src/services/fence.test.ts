import { describe, expect, it } from "vitest";
import { filterRegionsByFences, normalizeFence, normalizeFences, rebuildText } from "./fence";
import type { OcrRegion } from "@/types";

function region(text: string, cx: number, cy: number): OcrRegion {
  // 10x10 box centered at (cx, cy).
  return {
    text,
    confidence: 0.9,
    box: [
      [cx - 5, cy - 5],
      [cx + 5, cy - 5],
      [cx + 5, cy + 5],
      [cx - 5, cy + 5],
    ],
  };
}

describe("fence service", () => {
  const fences = [{ x: 0, y: 0, width: 1, height: 0.8 }]; // exclude bottom 20%

  it("keeps regions inside the fence and drops those outside", () => {
    const regions = [
      region("消息一", 500, 100),
      region("消息二", 500, 700),
      region("输入框草稿", 500, 950), // bottom 20% of a 1000px image
    ];
    const kept = filterRegionsByFences(regions, fences, 1000, 1000);
    expect(kept.map((r) => r.text)).toEqual(["消息一", "消息二"]);
  });

  it("keeps a region inside ANY of multiple rects", () => {
    // Left column + right column, gap in the middle excluded.
    const multi = [
      { x: 0, y: 0, width: 0.3, height: 1 },
      { x: 0.6, y: 0, width: 0.4, height: 1 },
    ];
    const regions = [
      region("左栏", 150, 500), // x=15%
      region("中间空档", 450, 500), // x=45% -> excluded
      region("右栏", 800, 500), // x=80%
    ];
    const kept = filterRegionsByFences(regions, multi, 1000, 1000);
    expect(kept.map((r) => r.text)).toEqual(["左栏", "右栏"]);
  });

  it("returns the same array when nothing is filtered", () => {
    const regions = [region("a", 100, 100)];
    expect(filterRegionsByFences(regions, fences, 1000, 1000)).toBe(regions);
  });

  it("keeps regions without usable boxes", () => {
    const regions: OcrRegion[] = [
      { text: "no box", confidence: 0.5, box: [] },
      region("bottom", 500, 950),
    ];
    const kept = filterRegionsByFences(regions, fences, 1000, 1000);
    expect(kept.map((r) => r.text)).toEqual(["no box"]);
  });

  it("ignores empty fences and bad image sizes", () => {
    const regions = [region("a", 500, 950)];
    expect(filterRegionsByFences(regions, [], 1000, 1000)).toBe(regions);
    expect(filterRegionsByFences(regions, fences, 0, 0)).toBe(regions);
  });

  it("normalizeFences coerces a legacy single object and drops degenerate rects", () => {
    expect(normalizeFences({ x: 0, y: 0, width: 1, height: 0.5 })).toEqual([
      { x: 0, y: 0, width: 1, height: 0.5 },
    ]);
    expect(
      normalizeFences([
        { x: 0, y: 0, width: 1, height: 0.5 },
        { x: 0.5, y: 0.5, width: 0.001, height: 0.5 }, // too small -> dropped
      ])
    ).toEqual([{ x: 0, y: 0, width: 1, height: 0.5 }]);
    expect(normalizeFences(undefined)).toEqual([]);
  });

  it("normalizeFence clamps out-of-range values", () => {
    expect(normalizeFence({ x: -0.2, y: 0.5, width: 2, height: 0.6 })).toEqual({
      x: 0,
      y: 0.5,
      width: 1,
      height: 0.5,
    });
    expect(normalizeFence({ x: 0.5, y: 0.5, width: 0.001, height: 0.5 })).toBeNull();
  });

  it("rebuildText sorts top-to-bottom then left-to-right", () => {
    const text = rebuildText([
      region("第二行", 100, 200),
      region("第一行右", 600, 100),
      region("第一行左", 100, 100),
    ]);
    expect(text).toBe("第一行左\n第一行右\n第二行");
  });
});
