# Plan 006: Constrain validation-command execution in the agent runner

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 6a0cfa0..HEAD -- apps/desktop/src-tauri/src/agent.rs apps/desktop/src/components/WorkspacePrepareModal.tsx`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security (defensive maintenance)
- **Planned at**: commit `6a0cfa0`, 2026-07-15

## Why this matters

After an agent run, Taskly executes per-todo "validation commands" via
`sh -lc <command>` in the todo's workspace. Today those commands are entered
by the user in a modal textarea, so this is user-consented local execution —
by design. But the hardening gap is real: `sanitize_validation_commands` only
strips blanks and placeholder strings ("无", "N/A"), and the strings are
persisted on the todo (`TodoItem.workspace.validationCommands`) — an object
whose other fields (title, description) already come from OCR'd chat text and
an LLM. Nothing at the execution boundary distinguishes "the user typed this"
from "this arrived via data flow". If any future feature prefills validation
commands from the LLM (a natural next step given the workspace-prepare flow),
untrusted chat content would flow straight into `sh -lc`. This plan adds a
defensive boundary now, while the change is small: a syntactic guard at the
Rust execution site plus an explicit confirmation surface in the UI, without
changing the intended power-user capability.

## Current state

- `apps/desktop/src-tauri/src/agent.rs` (1627 lines) — the Rust agent runner.
  Relevant sites:

  Execution (inside `run_validations`, lines ~684–712):

  ```rust
  // agent.rs:700–706 (as of 6a0cfa0)
  let output = Command::new("sh")
      .arg("-lc")
      .arg(cmd)
      .current_dir(workdir)
      .stdin(Stdio::null())
      .output()
      .await;
  ```

  Sanitizer (lines 1519–1530):

  ```rust
  /// Drop blank / placeholder validation commands (fixes legacy dirty data like
  /// `["无"]` that produced `sh: 无: command not found`).
  fn sanitize_validation_commands(commands: &[String]) -> Vec<String> {
      const PLACEHOLDERS: [&str; 6] = ["无", "无。", "none", "n/a", "na", "-"];
      commands
          .iter()
          .map(|c| c.trim())
          .filter(|c| !c.is_empty())
          .filter(|c| !PLACEHOLDERS.contains(&c.to_ascii_lowercase().as_str()))
          .map(|c| c.to_string())
          .collect()
  }
  ```

  Two call sites of the sanitizer, both feeding `run_validations`:
  - `execute_todo_once` (`agent.rs:815`): `let commands = sanitize_validation_commands(&req.validation_commands);`
  - `finish_agent_session` (`agent.rs:1440–1460`): same pattern.

  Existing unit tests live in `#[cfg(test)] mod tests` at `agent.rs:1532+`;
  `sanitize_drops_blanks_and_placeholders` (around line 1570) is the pattern
  to extend. Windows note: this file is compiled on Windows CI too — check
  whether `run_validations` has a Windows variant (`cmd /C` or similar) before
  assuming `sh` is the only path; as of the planning read, only `sh -lc`
  appears at this site.

- `apps/desktop/src/components/WorkspacePrepareModal.tsx` (201 lines) — the
  only UI where validation commands are entered: a `Textarea` initialized from
  `workspace?.validationCommands ?? []).join("\n")` (line 45–47), saved via
  `useTodoStore().setValidationCommands`. Commands originate here today —
  `prepareWorkspace` in `apps/desktop/src/services/agent.ts:113–132` only
  carries forward `existing?.validationCommands ?? []`, it does not generate
  any.

- Conventions: Rust errors are `Result<_, String>` with Chinese user-facing
  messages (e.g. `"未设置工作目录"`, `agent.rs:806`); log lines go through
  `logger.write(...)` + `emit_log(...)` pairs (see `run_validations`). Match
  both. Rust CI runs `cargo fmt --check`, `cargo clippy`, `cargo test`.

## Commands you will need

| Purpose        | Command                                                          | Expected on success |
|----------------|------------------------------------------------------------------|---------------------|
| Rust tests     | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`    | all pass            |
| Rust lint      | `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings` | exit 0 |
| Rust format    | `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check` | exit 0          |
| TS typecheck   | `pnpm --filter @taskly/desktop exec tsc --noEmit`                 | exit 0              |
| TS tests       | `pnpm --filter @taskly/desktop test`                              | all pass            |

Note: the first `cargo` build of this crate is slow (Tauri deps); use a long
timeout. If MNN/ocr-rs native deps fail to build on your machine, try
`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml agent::` — if
that also fails to build, treat it as a STOP condition.

## Scope

**In scope** (the only files you should modify):
- `apps/desktop/src-tauri/src/agent.rs`
- `apps/desktop/src/components/WorkspacePrepareModal.tsx`

**Out of scope** (do NOT touch, even though they look related):
- The agent subprocess spawn itself (`resolve_agent_command`, the pi sidecar
  invocation) — the custom agent command is an explicit power-user setting;
  by design.
- `sanitize_validation_commands`'s placeholder list — keep existing behavior.
- Any allowlist of "safe commands" — explicitly rejected: this is a developer
  tool, users legitimately run arbitrary project commands (`pnpm test`,
  `cargo build`, `make -C sub dir`). The boundary is *provenance + consent*,
  not command vocabulary.
- `apps/desktop/src/services/agent.ts`, `store/index.ts` — no TS data-flow
  changes.

## Git workflow

- Branch: `fix/validation-command-guard`
- Conventional commits, e.g. `fix(agent): reject control-operator injection in validation commands`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a syntactic guard in Rust

In `agent.rs`, add a function next to `sanitize_validation_commands`:

```rust
/// Reject validation commands containing shell control operators or
/// substitution syntax. Validation commands are single commands, not scripts;
/// anything needing `&&`, `;`, `|`, backticks, `$(...)`, or redirection should
/// be a script file in the repo invoked as one command.
fn validate_command_syntax(cmd: &str) -> Result<(), String> {
    const FORBIDDEN: [&str; 9] = ["&&", "||", ";", "|", "`", "$(", ">", "<", "&"];
    for pat in FORBIDDEN {
        if cmd.contains(pat) {
            return Err(format!(
                "校验命令包含不允许的 shell 操作符 {:?}：{}。如需组合命令，请写成脚本文件后调用。",
                pat, cmd
            ));
        }
    }
    if cmd.contains('\n') || cmd.contains('\r') {
        return Err(format!("校验命令不能包含换行: {}", cmd));
    }
    Ok(())
}
```

Wire it into `run_validations`: at the top of the per-command loop (before
`emit_phase(... "validating" ...)`), call `validate_command_syntax(cmd)`; on
`Err(msg)`, `logger.write("system", &msg)`, `emit_log(app, run_id, todo_id,
"system", &msg)`, push a failing `ValidationResult { command: cmd.clone(),
exit_code: -1, ok: false, stdout_tail: String::new(), stderr_tail: msg,
duration_ms: 0 }`, and `break` (matching the existing short-circuit-on-failure
behavior at the loop's end).

Keep `sh -lc` for execution — with control operators rejected, the remaining
shell value (PATH resolution via login shell, quoted-arg splitting) is what
users rely on.

**Verify**: `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check` → exit 0.

### Step 2: Add Rust unit tests

In the existing `mod tests` (pattern: `sanitize_drops_blanks_and_placeholders`,
`agent.rs:~1570`), add `validate_command_syntax` cases:

- Accepts: `"pnpm test"`, `"cargo build --release"`,
  `"./scripts/check.sh"`, `"python -m pytest tests/"`.
- Rejects (each returns `Err`): `"pnpm test && echo done"`,
  `"echo $(whoami)"`, `"cat foo | grep bar"`, `"pnpm test; ls"`,
  `"echo hi > out.txt"`, a command containing a backtick, a command containing
  `"\n"`.

**Verify**: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` →
all pass, including the new tests. Then
`cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`
→ exit 0.

### Step 3: Make the consent boundary visible in the UI

In `WorkspacePrepareModal.tsx`, under the validation-commands `Textarea`
(lines ~45–47 initialize it; find the `Field` that renders it), add/extend a
`FieldDescription` (component already imported) with a Chinese hint matching
the Rust rule:

> 每行一条命令，将在工作目录中直接执行；不支持 `&&`、`;`、`|`、重定向等
> shell 操作符 —— 组合逻辑请写入脚本文件后调用。

No functional TS change — this documents the contract the Rust side now
enforces so users aren't surprised by a failing validation.

**Verify**: `pnpm --filter @taskly/desktop exec tsc --noEmit` → exit 0, and
`pnpm --filter @taskly/desktop test` → all pass.

## Test plan

- Rust: the Step 2 unit tests (≥ 11 cases) in `agent.rs`'s existing
  `mod tests`, modeled on `sanitize_drops_blanks_and_placeholders`.
- TS: no new tests (copy-only change); existing suite must stay green.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` exits 0, incl. new `validate_command_syntax` tests
- [ ] `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings` exits 0
- [ ] `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check` exits 0
- [ ] `grep -n "validate_command_syntax" apps/desktop/src-tauri/src/agent.rs` shows the definition + a call inside `run_validations` + tests
- [ ] `pnpm --filter @taskly/desktop exec tsc --noEmit` exits 0
- [ ] Only in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `run_validations` or the sanitizer no longer matches the excerpts (drifted).
- You find validation commands are *already* LLM-prefilled somewhere (grep TS
  for `setValidationCommands` and `validationCommands` producers first) — the
  risk model changes and the guard may need to be stricter; report.
- The Rust crate does not build on your machine because of native OCR/MNN
  dependencies, even for `cargo test agent::` — do not attempt to fix the
  build; report.
- There is a Windows-specific execution path for validations you'd need to
  modify — report rather than guessing at `cmd.exe` semantics.

## Maintenance notes

- If a future feature prefills validation commands from the LLM/agent, the
  guard here is the backstop but NOT sufficient consent — that feature must
  add an explicit user-approval step before persisting the commands.
- Reviewer should scrutinize: the guard runs on every command in **both**
  entry paths (`execute_todo_once` and `finish_agent_session` both route
  through `run_validations` — confirm no third path exists); error messages
  don't echo anything beyond the command itself.
- Deferred: moving API-key handoff to the sidecar out of `models.json`
  plaintext (finding #6 of the audit) — separate concern, separate plan if
  selected later.
