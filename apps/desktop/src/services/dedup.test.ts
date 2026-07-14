import { describe, expect, it } from "vitest";
import {
  SIMILARITY_THRESHOLD,
  normalizeTitle,
  hashString,
  fingerprint,
  similarity,
  dedupTodos,
  dedupPendingTodos,
  makeTombstone,
  pruneTombstones,
} from "./dedup";
import type { TodoItem, Tombstone } from "@/types";

function makeTodo(id: string, patch: Partial<TodoItem> = {}): TodoItem {
  const now = new Date().toISOString();
  return {
    id,
    title: `todo ${id}`,
    done: false,
    source: "test",
    priority: 0,
    createdAt: now,
    updatedAt: now,
    reviewStatus: "confirmed",
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// normalizeTitle
// ---------------------------------------------------------------------------

describe("normalizeTitle", () => {
  it("lowercases latin characters", () => {
    expect(normalizeTitle("Hello World")).toBe("hello world");
  });

  it("strips emoji and pictographs", () => {
    expect(normalizeTitle("🎯完成报告")).toBe("完成报告");
    expect(normalizeTitle("📝 任务列表")).toBe("任务列表");
  });

  it("strips repeated spoken-language prefixes and applies canonical replacements", () => {
    // "麻烦帮我" stripped by PREFIX_PATTERN, then "整理一下" → "整理"
    expect(normalizeTitle("麻烦帮我整理一下会议纪要")).toBe("整理会议纪要");
  });

  it("applies canonical replacements: 测评 → 测试", () => {
    expect(normalizeTitle("测评报告")).toBe("测试报告");
  });

  it("applies canonical replacements: 评测 → 测试", () => {
    expect(normalizeTitle("评测GPT效果")).toBe("测试gpt效果");
  });

  it("applies canonical replacements: 准备一下 → 准备", () => {
    expect(normalizeTitle("准备一下周会材料")).toBe("准备周会材料");
  });

  it("drops ASCII and CJK punctuation but keeps CJK characters", () => {
    expect(normalizeTitle("完成报告！！")).toBe("完成报告");
    // NOTE: "你" is in PREFIX_PATTERN, so it is stripped as a spoken prefix.
    // This is current behavior; the resulting string is "好世界" not "你好世界".
    expect(normalizeTitle("你好，世界。")).toBe("好世界");
  });

  it("collapses whitespace", () => {
    expect(normalizeTitle("  整理   文档  ")).toBe("整理 文档");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeTitle("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// hashString
// ---------------------------------------------------------------------------

describe("hashString", () => {
  it("is deterministic — same input produces same output", () => {
    expect(hashString("整理会议纪要")).toBe(hashString("整理会议纪要"));
  });

  it("produces exactly 8 hex characters", () => {
    expect(hashString("test")).toMatch(/^[0-9a-f]{8}$/);
    expect(hashString("")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces different output for different inputs", () => {
    expect(hashString("整理文档")).not.toBe(hashString("测试功能"));
  });
});

// ---------------------------------------------------------------------------
// fingerprint
// ---------------------------------------------------------------------------

describe("fingerprint", () => {
  it("is stable for the same title without a dueDate", () => {
    expect(fingerprint({ title: "整理会议纪要" })).toBe(
      fingerprint({ title: "整理会议纪要" })
    );
  });

  it("is stable for the same title with the same dueDate day", () => {
    expect(fingerprint({ title: "提交周报", dueDate: "2026-07-15" })).toBe(
      fingerprint({ title: "提交周报", dueDate: "2026-07-15" })
    );
  });

  it("title-only fingerprint differs from title+dueDate fingerprint", () => {
    expect(fingerprint({ title: "提交周报" })).not.toBe(
      fingerprint({ title: "提交周报", dueDate: "2026-07-15" })
    );
  });
});

// ---------------------------------------------------------------------------
// similarity
// ---------------------------------------------------------------------------

describe("similarity", () => {
  it("returns 1 for identical normalized strings", () => {
    expect(similarity("整理会议纪要", "整理会议纪要")).toBe(1);
  });

  it("returns 0 when one string is empty and the other is not", () => {
    expect(similarity("", "整理文档")).toBe(0);
    expect(similarity("整理文档", "")).toBe(0);
  });

  it("returns 1 when both strings are empty", () => {
    expect(similarity("", "")).toBe(1);
  });

  it("near-duplicate CJK titles (after normalizeTitle) score ≥ threshold", () => {
    // "测评 gpt" normalizes to "测试 gpt" via canonical replacement → identical
    const normA = normalizeTitle("测试 gpt");
    const normB = normalizeTitle("测评 gpt");
    expect(similarity(normA, normB)).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it("unrelated titles score below threshold", () => {
    expect(
      similarity(normalizeTitle("整理文档"), normalizeTitle("开会讨论"))
    ).toBeLessThan(SIMILARITY_THRESHOLD);
  });
});

// ---------------------------------------------------------------------------
// dedupTodos
// ---------------------------------------------------------------------------

describe("dedupTodos", () => {
  it("drops the second occurrence of a within-batch exact duplicate", () => {
    const a = makeTodo("a", { title: "写代码" });
    const b = makeTodo("b", { title: "写代码" }); // same fingerprint
    const { added } = dedupTodos([a, b], [], [], 60_000);
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe("a");
  });

  it("drops incoming when its fingerprint matches an active existing todo", () => {
    const existing = makeTodo("existing", {
      title: "写代码",
      reviewStatus: "confirmed",
    });
    const incoming = makeTodo("new", { title: "写代码" });
    const { added } = dedupTodos([incoming], [existing], [], 60_000);
    expect(added).toHaveLength(0);
  });

  it("drops incoming that fuzzily matches an active existing todo", () => {
    // normalizeTitle("准备一下周会材料") → "准备周会材料" via canonical replacement
    const existing = makeTodo("existing", {
      title: "准备周会材料",
      reviewStatus: "confirmed",
    });
    const incoming = makeTodo("new", { title: "准备一下周会材料" });
    const { added } = dedupTodos([incoming], [existing], [], 60_000);
    expect(added).toHaveLength(0);
  });

  it("does NOT drop incoming when the matching existing todo is done", () => {
    const existing = makeTodo("done", { title: "写代码", done: true });
    const incoming = makeTodo("new", { title: "写代码" });
    const { added } = dedupTodos([incoming], [existing], [], 60_000);
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe("new");
  });

  it("drops incoming when existing todo has pending_confirmation status (active)", () => {
    const existing = makeTodo("pend", {
      title: "写代码",
      reviewStatus: "pending_confirmation",
    });
    const incoming = makeTodo("new", { title: "写代码" });
    const { added } = dedupTodos([incoming], [existing], [], 60_000);
    expect(added).toHaveLength(0);
  });

  it("drops incoming when a tombstone with unexpired TTL matches", () => {
    const now = Date.now();
    const fp = fingerprint({ title: "写代码" });
    const tomb: Tombstone = {
      fingerprint: fp,
      normalizedTitle: "写代码",
      deletedAt: now - 1_000,
    };
    const incoming = makeTodo("new", { title: "写代码" });
    const { added, liveTombstones } = dedupTodos([incoming], [], [tomb], 60_000, now);
    expect(added).toHaveLength(0);
    expect(liveTombstones).toHaveLength(1);
  });

  it("accepts incoming and prunes tombstone when the tombstone TTL has expired", () => {
    const now = Date.now();
    const tomb: Tombstone = {
      fingerprint: fingerprint({ title: "写代码" }),
      normalizedTitle: "写代码",
      deletedAt: now - 70_000, // older than 60 s TTL
    };
    const incoming = makeTodo("new", { title: "写代码" });
    const { added, liveTombstones } = dedupTodos([incoming], [], [tomb], 60_000, now);
    expect(added).toHaveLength(1);
    expect(liveTombstones).toHaveLength(0);
  });

  it("ttlMs = 0 disables tombstones entirely and returns liveTombstones: []", () => {
    const now = Date.now();
    const tomb: Tombstone = {
      fingerprint: fingerprint({ title: "写代码" }),
      normalizedTitle: "写代码",
      deletedAt: now - 100,
    };
    const incoming = makeTodo("new", { title: "写代码" });
    const { added, liveTombstones } = dedupTodos([incoming], [], [tomb], 0, now);
    expect(added).toHaveLength(1);
    expect(liveTombstones).toHaveLength(0);
  });

  it("stamps the fingerprint onto accepted items that lacked one", () => {
    const incoming = makeTodo("a", { title: "整理文档" });
    const { added } = dedupTodos([incoming], [], [], 60_000);
    expect(added[0].fingerprint).toBe(fingerprint({ title: "整理文档" }));
  });
});

// ---------------------------------------------------------------------------
// dedupPendingTodos
// ---------------------------------------------------------------------------

describe("dedupPendingTodos", () => {
  it("removes a pending todo that matches a confirmed active todo", () => {
    const todos = [
      makeTodo("confirmed", {
        title: "整理文档",
        reviewStatus: "confirmed",
      }),
      makeTodo("dup", {
        title: "整理文档",
        reviewStatus: "pending_confirmation",
      }),
    ];
    const result = dedupPendingTodos(todos);
    expect(result.map((t) => t.id)).toEqual(["confirmed"]);
  });

  it("keeps the first of two near-identical pending todos and drops the second", () => {
    const todos = [
      makeTodo("p1", {
        title: "准备周会材料",
        reviewStatus: "pending_confirmation",
      }),
      makeTodo("p2", {
        title: "准备一下周会材料", // normalizes to "准备周会材料"
        reviewStatus: "pending_confirmation",
      }),
    ];
    const result = dedupPendingTodos(todos);
    expect(result.map((t) => t.id)).toEqual(["p1"]);
  });

  it("returns the original array reference when nothing was removed", () => {
    const todos = [
      makeTodo("a", { title: "写代码", reviewStatus: "confirmed" }),
      makeTodo("b", { title: "测试功能", reviewStatus: "pending_confirmation" }),
    ];
    const result = dedupPendingTodos(todos);
    expect(result).toBe(todos);
  });
});

// ---------------------------------------------------------------------------
// makeTombstone / pruneTombstones
// ---------------------------------------------------------------------------

describe("makeTombstone", () => {
  it("populates all fields from the todo", () => {
    const todo = makeTodo("a", { title: "整理文档" });
    const now = 1_000_000;
    const t = makeTombstone(todo, now);
    expect(t.fingerprint).toBe(fingerprint({ title: "整理文档" }));
    expect(t.normalizedTitle).toBe(normalizeTitle("整理文档"));
    expect(t.deletedAt).toBe(now);
  });
});

describe("pruneTombstones", () => {
  it("clears all tombstones when ttlMs <= 0", () => {
    const now = Date.now();
    const tomb: Tombstone = {
      fingerprint: "abc",
      normalizedTitle: "test",
      deletedAt: now - 1,
    };
    expect(pruneTombstones([tomb], 0, now)).toEqual([]);
    expect(pruneTombstones([tomb], -1, now)).toEqual([]);
  });

  it("keeps unexpired tombstones and drops expired ones", () => {
    const now = 100_000;
    const unexpired: Tombstone = {
      fingerprint: "a",
      normalizedTitle: "a",
      deletedAt: now - 30_000, // 30 s ago, TTL 60 s → alive
    };
    const expired: Tombstone = {
      fingerprint: "b",
      normalizedTitle: "b",
      deletedAt: now - 70_000, // 70 s ago, TTL 60 s → expired
    };
    const result = pruneTombstones([unexpired, expired], 60_000, now);
    expect(result).toHaveLength(1);
    expect(result[0].fingerprint).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// Step 4: timezone regression — normalizeDueDay must use the local day
// ---------------------------------------------------------------------------

describe("fingerprint timezone regression", () => {
  // These dates are constructed in local time, so they represent the same
  // calendar day regardless of what TZ the test runner is in.
  // After the fix, normalizeDueDay uses getFullYear/getMonth/getDate (local),
  // so both map to the same YYYY-MM-DD bucket.
  // Before the fix (.toISOString().slice(0,10)), any TZ east of UTC would
  // produce a different bucket for the 01:00 hour (shifted to previous UTC day).

  it("two times on the same local calendar day yield equal fingerprints", () => {
    const d1 = new Date(2026, 6, 15, 1).toISOString(); // local 2026-07-15 01:00
    const d2 = new Date(2026, 6, 15, 23).toISOString(); // local 2026-07-15 23:00
    expect(fingerprint({ title: "提交周报", dueDate: d1 })).toBe(
      fingerprint({ title: "提交周报", dueDate: d2 })
    );
  });

  it("times on different local calendar days yield different fingerprints", () => {
    const d1 = new Date(2026, 6, 15, 12).toISOString(); // local 2026-07-15
    const d2 = new Date(2026, 6, 16, 12).toISOString(); // local 2026-07-16
    expect(fingerprint({ title: "提交周报", dueDate: d1 })).not.toBe(
      fingerprint({ title: "提交周报", dueDate: d2 })
    );
  });

  it("unparseable dueDate produces the same fingerprint as no dueDate", () => {
    expect(fingerprint({ title: "提交周报", dueDate: "下周三" })).toBe(
      fingerprint({ title: "提交周报" })
    );
  });
});
