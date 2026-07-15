# Plan 004: Make the LLM extraction pipeline fail loudly and prevent overlapping monitor ticks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6a0cfa0..HEAD -- apps/desktop/src/services/llm.ts apps/desktop/src/services/monitor.ts`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `6a0cfa0`, 2026-07-15

## Why this matters

Taskly's core loop is: screenshot → OCR → LLM extraction → todos. Two bugs make
this loop silently die or misbehave:

1. `OpenAIProvider.extractTodos` never checks `response.ok` and swallows all
   parse errors with a bare `catch { return [] }`. An expired API key, a rate
   limit, a wrong base URL, or a malformed model response all look identical to
   "no todos in this chat" — the user gets no error, no log, nothing. The
   monitor already has an `onError` callback wired to the UI, but it never
   fires for LLM failures because the error never propagates.
2. `MonitorService.start()` schedules `tick()` with `window.setInterval`
   without any in-flight guard. A tick that runs longer than the interval
   (LLM calls easily exceed 30 s on slow endpoints) overlaps with the next
   tick: duplicate concurrent OCR + LLM calls on the same frame, racing
   updates to `frameCache`, and duplicate todo batches.

After this plan: LLM/API failures surface through the existing `onError` path
(visible in the UI), parse failures are logged, and at most one tick runs at a
time.

## Current state

- `apps/desktop/src/services/llm.ts` — `OpenAIProvider` class; the fetch +
  parse happens in `extractTodos` (lines 33–85).

  ```ts
  // llm.ts:37–55 (as of 6a0cfa0)
  const response = await fetch(`${this.baseUrl}/chat/completions`, {
    method: "POST",
    headers: buildHeaders(this.apiKey),
    body: JSON.stringify({ ... }),
  });

  const data = await response.json();          // <-- no response.ok check
  const content = data.choices?.[0]?.message?.content;

  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed) ? parsed : parsed.todos || [];
    ...
  } catch {                                    // llm.ts:83–85
    return [];                                 // <-- silent swallow, no log
  }
  ```

- `apps/desktop/src/services/monitor.ts` — `MonitorService`; scheduling is in
  `start()` (lines 56–78), the async pipeline is `private async tick()`
  (lines 94–246). The class already has fields `intervalId`, `tickCount`,
  `frameCache` (lines 16–25) and an `onError?: (message: string) => void`
  callback (line 22) which the tick's catch block already invokes:

  ```ts
  // monitor.ts:71–77 (as of 6a0cfa0)
  this.intervalId = window.setInterval(
    () => this.tick(),                         // <-- unguarded, can overlap
    this.config.screenshotInterval * 1000
  );

  // Run immediately
  this.tick();
  ```

  ```ts
  // monitor.ts:239–245 — existing error funnel; LLM errors should land here
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    this.onError?.(message);
    console.error("[Monitor] tick error:", error);
  } finally {
    console.debug("[Monitor] tick done in %dms", Date.now() - startedAt);
  }
  ```

- Repo conventions: services log with `console.info/debug/warn/error` and a
  `[Monitor]` / `[LLM]`-style bracket prefix — see `monitor.ts:59–67` for the
  pattern. Errors intended for the user propagate as thrown `Error`s and are
  caught by the tick's catch block. Match both.
- Tests use vitest, colocated as `<name>.test.ts` next to the source — see
  `apps/desktop/src/services/fence.test.ts` for the structural pattern
  (plain `describe`/`it`/`expect`, small local helper factories).

## Commands you will need

| Purpose   | Command                                                | Expected on success |
|-----------|--------------------------------------------------------|---------------------|
| Install   | `pnpm install`                                          | exit 0              |
| Typecheck | `pnpm --filter @taskly/desktop exec tsc --noEmit`       | exit 0, no output   |
| Tests     | `pnpm --filter @taskly/desktop test`                    | all pass            |

(Verified during recon: the desktop package's `test` script is `vitest run`;
its `build` script runs `tsc && vite build`, so `tsc --noEmit` is the
standalone typecheck.)

## Scope

**In scope** (the only files you should modify):
- `apps/desktop/src/services/llm.ts`
- `apps/desktop/src/services/monitor.ts`
- `apps/desktop/src/services/llm.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `apps/desktop/src/services/dedup.ts` — timezone/dedup issues are handled by
  plan 005.
- `apps/desktop/src/App.tsx` and the `onError` wiring — the UI plumbing
  already exists; do not change how errors are displayed.
- `apps/desktop/src/services/ocr.ts` — OCR failures already report via
  `ocrResult.success`.
- The retry/backoff behavior — do NOT add retries; a failed tick simply
  reports and waits for the next interval.

## Git workflow

- Branch: `fix/llm-monitor-robustness` (repo uses `fix/*`, `feat/*` branches)
- Commit style: conventional commits, e.g. `fix(desktop): surface LLM extraction errors and guard monitor tick overlap` (matches `git log`, e.g. `fix(desktop): run npm via shell on Windows in sidecar build`)
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Check `response.ok` in `extractTodos`

In `apps/desktop/src/services/llm.ts`, immediately after the `fetch` call
(currently line 46, before `response.json()`), add:

```ts
if (!response.ok) {
  const body = await response.text().catch(() => "");
  throw new Error(
    `LLM API error ${response.status} ${response.statusText}: ${body.slice(0, 200)}`
  );
}
```

The thrown error propagates out of `extractTodos` to the monitor tick's catch
block, which calls `this.onError?.(message)` — that is the intended path; do
not catch it inside `llm.ts`.

**Verify**: `pnpm --filter @taskly/desktop exec tsc --noEmit` → exit 0.

### Step 2: Log parse failures instead of swallowing them

In the same file, change the bare `catch` at lines 83–85 to log before
returning:

```ts
} catch (e) {
  console.error("[LLM] failed to parse todo extraction response:", e, {
    contentPreview: String(content).slice(0, 200),
  });
  return [];
}
```

Keep the `return []` — a malformed response should not abort the tick, only a
transport/API failure should. Do not log the API key or full headers anywhere.

**Verify**: `pnpm --filter @taskly/desktop exec tsc --noEmit` → exit 0.

### Step 3: Add an in-flight guard to `MonitorService.tick`

In `apps/desktop/src/services/monitor.ts`:

1. Add a private field next to `tickCount` (line 20):
   ```ts
   private tickInFlight = false;
   ```
2. At the very top of `private async tick()` (line 94, before
   `const tickId = ++this.tickCount;`), add:
   ```ts
   if (this.tickInFlight) {
     console.debug("[Monitor] skip: previous tick still running");
     return;
   }
   this.tickInFlight = true;
   ```
3. In the existing `finally` block (lines 243–245), add
   `this.tickInFlight = false;` before the `console.debug` line.

Do not change the `setInterval` scheduling itself — the guard makes
overlapping fires a no-op, which preserves the existing cadence behavior.

**Verify**: `pnpm --filter @taskly/desktop exec tsc --noEmit` → exit 0.

### Step 4: Add unit tests for the new `llm.ts` behavior

Create `apps/desktop/src/services/llm.test.ts` (model after
`apps/desktop/src/services/fence.test.ts`), stubbing global `fetch` with
`vi.stubGlobal` / `vi.fn()`. Cases to cover are listed in the Test plan.

**Verify**: `pnpm --filter @taskly/desktop test` → all pass, including the new
file.

## Test plan

New file `apps/desktop/src/services/llm.test.ts`, using vitest with a mocked
`fetch` (`vi.stubGlobal("fetch", vi.fn(...))`; restore in `afterEach` via
`vi.unstubAllGlobals()`):

1. **Happy path** — mock 200 response whose
   `choices[0].message.content` is a JSON array with one todo (`title`,
   `priority`, `todoKind: "actionable"`); expect one `TodoItem` back with
   `reviewStatus: "pending_confirmation"` and a non-empty `fingerprint`.
2. **Object-wrapped array** — content is `{"todos": [...]}`; expect items
   extracted (covers the `parsed.todos` branch at line 55).
3. **Non-OK response** — mock `{ ok: false, status: 401, statusText:
   "Unauthorized", text: () => Promise.resolve("...") }`; expect
   `extractTodos` to **reject** with an error whose message contains `401`.
4. **Malformed content** — content is `"not json {"`; expect it to resolve
   with `[]` (and not throw).
5. **Missing content** — `choices` empty; expect `[]`.

Note: `TodoItem.id` uses `crypto.randomUUID()` — available in vitest's node
environment ≥ 19; if it's undefined in the test env, stub it with
`vi.stubGlobal("crypto", { randomUUID: () => "test-id" })`.

No unit test for the monitor guard is required (constructing `MonitorService`
pulls in Tauri APIs); the guard is verified by review + typecheck. Do NOT
build a Tauri mock harness for this plan.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm --filter @taskly/desktop exec tsc --noEmit` exits 0
- [ ] `pnpm --filter @taskly/desktop test` exits 0; `llm.test.ts` exists with ≥5 passing tests
- [ ] `grep -n "response.ok" apps/desktop/src/services/llm.ts` returns a match
- [ ] `grep -n "catch {" apps/desktop/src/services/llm.ts` returns no matches (the bare catch is gone)
- [ ] `grep -n "tickInFlight" apps/desktop/src/services/monitor.ts` returns ≥3 matches (field, guard, reset)
- [ ] Only in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the cited lines doesn't match the "Current state" excerpts.
- `extractTodos` has grown a retry mechanism or an internal error callback
  since planning — the error-propagation design here would conflict with it.
- The test for case 3 fails because something upstream already catches the
  thrown error inside `llm.ts` — that means the control flow assumption is
  wrong; report instead of restructuring.
- You find `tick()` is also called from anywhere other than `start()`
  (grep `\.tick(` first) — the guard placement assumption would need review.

## Maintenance notes

- If a retry/backoff policy is added later, it belongs inside `extractTodos`
  *below* the `response.ok` check, and the monitor's in-flight guard becomes
  even more important (retries lengthen ticks).
- Reviewer should scrutinize: no API key or Authorization header appears in
  any new log statement; the guard reset lives in `finally` so a thrown error
  can't wedge the monitor permanently.
- Deferred: surfacing LLM errors as a distinct UI state (vs. the generic
  `onError` toast) — product decision, not in scope.
