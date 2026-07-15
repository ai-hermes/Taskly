# Plan 005: Characterize dedup with tests, then fix the UTC day-bucketing bug

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6a0cfa0..HEAD -- apps/desktop/src/services/dedup.ts`
> If the file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (tests land before the fix, inside this plan)
- **Category**: bug + tests
- **Planned at**: commit `6a0cfa0`, 2026-07-15

## Why this matters

`apps/desktop/src/services/dedup.ts` (287 lines) is the correctness core of
Taskly: it decides whether an OCR-extracted todo is new or a duplicate, via
CJK-aware normalization, fingerprinting, Jaccard + edit-distance similarity,
and tombstones. It has **zero tests**, and it contains a real bug:
`normalizeDueDay` buckets due dates with `toISOString()`, which converts to
UTC. For a user in Asia/Shanghai (UTC+8 — this app's primary audience; the
whole UI is Chinese), a due date of `2026-07-15T01:00:00+08:00` buckets to
`"2026-07-14"`. Two captures of the same todo whose parsed due-date strings
fall on different sides of the UTC midnight line get **different
fingerprints**, so exact dedup misses and only fuzzy title matching stands
between the user and duplicate todos. Order of work matters: characterization
tests first (locking in current behavior for everything else), then the
one-line timezone fix with its own regression tests.

## Current state

- `apps/desktop/src/services/dedup.ts` — the only file with logic changes.
  Exports: `SIMILARITY_THRESHOLD` (0.85), `normalizeTitle`, `hashString`,
  `fingerprint`, `similarity`, `dedupTodos`, `dedupPendingTodos`,
  `makeTombstone`, `pruneTombstones`. Internal (not exported):
  `normalizeDueDay`, `tokenize`, `editSimilarity`, `fuzzyHit`, `isActiveTodo`.

  The bug:

  ```ts
  // dedup.ts:53–59 (as of 6a0cfa0)
  /** Normalize an ISO date-ish value down to a YYYY-MM-DD day bucket, if parseable. */
  function normalizeDueDay(dueDate?: string): string {
    if (!dueDate) return "";
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);   // <-- UTC day, not local day
  }
  ```

  Fingerprint composition (why the bucket matters):

  ```ts
  // dedup.ts:71–76
  /** Fingerprint = hash(normalizedTitle [+ due-day]). */
  export function fingerprint(todo: Pick<TodoItem, "title" | "dueDate">): string {
    const norm = normalizeTitle(todo.title);
    const day = normalizeDueDay(todo.dueDate);
    return hashString(day ? `${norm}|${day}` : norm);
  }
  ```

  Dedup layering (from the `dedupTodos` doc comment, lines 158–168): within-batch
  by fingerprint → exact vs active existing → fuzzy vs existing (similarity ≥
  threshold) → tombstone dedup (exact or fuzzy). Completed todos are
  intentionally ignored — a finished item must not block re-capture later.

- `apps/desktop/src/types/index.ts` — `TodoItem` and `Tombstone` types.
  `Tombstone` is `{ fingerprint, normalizedTitle, deletedAt }`.
- Existing callers (do not modify): `store/index.ts` (`dedupTodos`,
  `dedupPendingTodos`, `makeTombstone`, `pruneTombstones`), `llm.ts`
  (`fingerprint`, `normalizeTitle`), `monitor.ts` (`hashString`,
  `normalizeTitle`, frame-cache constants).
- Test conventions: vitest, colocated `<name>.test.ts` — see
  `apps/desktop/src/services/fence.test.ts` (plain `describe`/`it`, small
  helper factory functions, Chinese-language fixture strings) and
  `apps/desktop/src/store/store.test.ts` (builds `TodoItem` fixtures with a
  `makeTodo(overrides)` helper). Match those.

## Commands you will need

| Purpose   | Command                                                | Expected on success |
|-----------|--------------------------------------------------------|---------------------|
| Install   | `pnpm install`                                          | exit 0              |
| Typecheck | `pnpm --filter @taskly/desktop exec tsc --noEmit`       | exit 0, no output   |
| Tests     | `pnpm --filter @taskly/desktop test`                    | all pass            |

## Scope

**In scope** (the only files you should modify):
- `apps/desktop/src/services/dedup.test.ts` (create)
- `apps/desktop/src/services/dedup.ts` (only `normalizeDueDay`, Step 3)

**Out of scope** (do NOT touch, even though they look related):
- `apps/desktop/src/store/index.ts` and `store.test.ts` — store-level dedup
  wiring already has tests; don't duplicate them.
- `apps/desktop/src/services/monitor.ts` frame cache — separate layer,
  separate plan (004 touches that file).
- `SIMILARITY_THRESHOLD`, the similarity algorithms, `PREFIX_PATTERN`,
  `CANONICAL_REPLACEMENTS` — characterize, do not "improve". No tuning.
- Migration of existing persisted fingerprints (see Maintenance notes).

## Git workflow

- Branch: `fix/dedup-timezone-bucketing` (repo uses `fix/*`, `feat/*`)
- Commit per step; conventional commits, e.g.
  `test(desktop): characterize dedup normalization and fingerprinting` then
  `fix(desktop): bucket due dates by local day in dedup fingerprint`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write characterization tests for the pure helpers

Create `apps/desktop/src/services/dedup.test.ts`. Add a `makeTodo(overrides)`
fixture helper (pattern: `store.test.ts`). Cover, asserting **current**
behavior:

- `normalizeTitle`: lowercasing; emoji stripped; repeated spoken prefixes
  stripped (`"麻烦帮我整理一下会议纪要"` → `"整理会议纪要"` — note
  `整理一下` → `整理` via CANONICAL_REPLACEMENTS); canonical replacements
  (`"测评"` → `"测试"`); ASCII + CJK punctuation dropped (`"完成报告！！"` →
  `"完成报告"`); whitespace collapsed; empty input → `""`.
- `hashString`: deterministic (same input twice), 8 hex chars, differs for
  different inputs.
- `fingerprint`: same title without dueDate is stable; same title with the
  same dueDate day is stable; title-only fingerprint ≠ title+dueDate
  fingerprint.
- `similarity`: identical normalized strings → 1; empty vs non-empty → 0;
  both empty → 1; near-duplicate CJK (`"测试 gpt"` vs `"测评 gpt"` — run both
  through `normalizeTitle` first) ≥ 0.85; unrelated titles < 0.85.

**Verify**: `pnpm --filter @taskly/desktop test` → all pass.

### Step 2: Write characterization tests for `dedupTodos` / `dedupPendingTodos` / tombstones

In the same file:

- `dedupTodos`: within-batch exact dup dropped; exact fingerprint match vs
  active existing dropped; fuzzy title match vs existing dropped (e.g.
  `"准备一下周会材料"` incoming vs existing `"准备周会材料"`); **done todos do
  not block** re-adding the same title; `pending_confirmation` existing todos
  DO block (they're "active" per `isActiveTodo`, lines 143–149); tombstone
  with unexpired TTL blocks, expired tombstone does not and is pruned from
  `liveTombstones`; `ttlMs = 0` disables tombstones entirely (returns
  `liveTombstones: []`).
- `dedupPendingTodos`: pending todo matching a confirmed active todo is
  removed; first-of-two near-identical pendings wins; returns the **same array
  reference** when nothing was removed (`expect(result).toBe(input)`).
- `makeTombstone` / `pruneTombstones`: fields populated from the todo;
  `ttlMs <= 0` clears all.

**Verify**: `pnpm --filter @taskly/desktop test` → all pass.

### Step 3: Fix `normalizeDueDay` to use the local day

Replace the body's last line (dedup.ts:58):

```ts
function normalizeDueDay(dueDate?: string): string {
  if (!dueDate) return "";
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
```

Do NOT add a date library; `date-fns` is already a dependency but a 4-line
local-parts formatting doesn't warrant an import here (keep the module
dependency-free — it's imported by `llm.ts` and `monitor.ts`).

**Verify**: `pnpm --filter @taskly/desktop test` → all pass (Step 1–2 tests
must not break: none of them may assert a UTC-shifted bucket).

### Step 4: Add regression tests for the timezone fix

Timezone-dependent tests must control TZ explicitly. Add a dedicated block
that documents the assumption:

- `fingerprint({title: "提交周报", dueDate: "2026-07-15T01:00:00+08:00"})`
  equals `fingerprint({title: "提交周报", dueDate: "2026-07-15T23:00:00+08:00"})`
  — same local day in any test TZ **only if** the test process runs in
  UTC+8. To make it TZ-independent, instead assert with local-constructed
  dates: `new Date(2026, 6, 15, 1).toISOString()` and
  `new Date(2026, 6, 15, 23).toISOString()` as the two `dueDate` inputs —
  both are 01:00 and 23:00 *local* on July 15, so after the fix they must
  produce equal fingerprints regardless of the runner's TZ. Before the fix,
  in any TZ east of UTC, they differ (that's the regression this catches).
- Different local days (`new Date(2026, 6, 15, 12)` vs
  `new Date(2026, 6, 16, 12)`) → different fingerprints.
- Unparseable dueDate (`"下周三"`) → same fingerprint as no dueDate.

**Verify**: `pnpm --filter @taskly/desktop test` → all pass. Then sanity-check
the regression actually bites: `git stash` the Step 3 change, run the test
file, confirm the new TZ tests **fail**, `git stash pop`, re-run, confirm
pass. (Skip this check if the runner's local TZ is exactly UTC — note that in
your report.)

## Test plan

Covered in Steps 1, 2, 4 — one new file `apps/desktop/src/services/dedup.test.ts`,
modeled on `fence.test.ts` / `store.test.ts`, ≥ 20 test cases across
normalization, hashing, fingerprinting, similarity, batch dedup, pending
sweep, tombstones, and the timezone regression.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm --filter @taskly/desktop exec tsc --noEmit` exits 0
- [ ] `pnpm --filter @taskly/desktop test` exits 0; `dedup.test.ts` exists with ≥20 passing tests
- [ ] `grep -n "toISOString" apps/desktop/src/services/dedup.ts` returns no matches
- [ ] Only in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `dedup.ts` no longer matches the "Current state" excerpts.
- Any Step 1/2 characterization test reveals behavior you believe is a *bug*
  other than the day-bucketing one — record it in your report, assert the
  current behavior anyway, and do NOT fix it here.
- The Step 4 stash check shows the TZ tests passing *without* the fix in a
  non-UTC timezone — the regression test is wrong; report instead of shipping
  a test that can't catch the bug.
- Fixing `normalizeDueDay` requires touching any caller.

## Maintenance notes

- **Persisted fingerprints**: todos stored before this fix carry
  UTC-bucketed fingerprints. `dedupTodos` recomputes via
  `t.fingerprint || fingerprint(t)` — the stored value wins, so an old todo
  and its re-capture may briefly coexist across one day boundary until the
  old one is done/deleted. This is accepted; a migration was deliberately
  deferred (low value, dedup's fuzzy layer still catches most cases).
- If a date library is later introduced for reminders, `normalizeDueDay`
  should migrate to it in the same change.
- Reviewer should scrutinize: no behavior change outside `normalizeDueDay`;
  characterization tests assert current (pre-existing) behavior verbatim.
