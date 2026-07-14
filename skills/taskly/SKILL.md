---
name: taskly
description: "Capture, manage and remind todos from chat text using the `taskly` CLI. Use when the user pastes chat logs / meeting notes / messages and wants the action items pulled out, or asks to add, list, complete, update, delete, or get reminders for todos. Extracted actionable todos should be executed by the agent itself, then marked done via `taskly done <id> --by agent`."
---

# Taskly

Taskly turns messy chat text into structured, deduplicated todos and keeps them in
a local store (`~/.taskly/todos.json`). It is the CLI companion to the Taskly
desktop app: same todo model, same server sync protocol.

Use the `taskly` command for anything involving the user's personal action items:
pulling todos out of pasted conversations, tracking them, reminding about due
dates, and (for actionable items) doing the work and marking it complete.

## When to use

- The user pastes chat / WeChat / Slack / email / meeting text and asks "what do I
  need to do?", "extract the todos", "整理一下待办".
- The user wants to add / list / complete / update / delete a personal todo.
- The user asks what's due or overdue, or wants a reminder.
- After you finish an actionable task the user asked for, record it as done.

Do **not** use it for project issue tracking that belongs in GitHub/Jira, or for
your own internal scratch todo list.

## Setup (first run)

Taskly needs an OpenAI-compatible LLM for `extract`. It reads, in order:
`TASKLY_LLM_API_KEY` → `OPENAI_API_KEY` → saved config. Same for base URL
(`TASKLY_LLM_BASE_URL` / `OPENAI_BASE_URL`) and model (`TASKLY_LLM_MODEL` /
`OPENAI_MODEL`).

If no key is configured, ask the user for one and save it:

```bash
taskly config --set llm.apiKey=sk-... llm.model=gpt-4o-mini
taskly config              # show current config (api key is masked)
```

`extract` is the only command that needs the LLM. `add`, `list`, `done`, etc. work
offline.

## Core workflow: capture from chat

Pass the raw text; Taskly extracts structured todos and (with `--save`)
deduplicates them against what's already stored. Always prefer `--json` when you
need to act on the result programmatically.

```bash
# Preview (does not store)
taskly extract --text "老板说周五前把设计稿交给张三，另外团队会议改到下午3点"

# Extract AND store, get JSON back
taskly extract --file chat.txt --save --json

# Pipe from stdin
pbpaste | taskly extract --save --json
```

Each todo has: `id`, `title`, `description`, `priority` (0–3), `dueDate`,
`todoKind` (`actionable` | `notification`), `reviewStatus`
(`pending_confirmation` until the user confirms). Saved-from-extract todos start
as `pending_confirmation`; use `--confirmed` to skip that, or confirm later with
`taskly update <id> --confirm`.

## Managing todos

```bash
taskly list                       # open todos, sorted by priority then due date
taskly list --status all --json   # everything, as JSON
taskly list --overdue             # only overdue
taskly show <id>                  # full detail (id or unambiguous id-prefix)
taskly add "写周报" --due 2026-07-15 --priority 2
taskly update <id> --due 2026-07-20 --priority 3
taskly done <id>                  # complete (manual)
taskly undone <id>                # reopen
taskly rm <id>                    # delete (tombstoned so it won't be re-detected)
```

`<id>` accepts a full UUID or any unambiguous prefix (the 8-char short id shown in
`list` works).

## Reminders

```bash
taskly due                        # overdue + due within 24h
taskly due --within 72            # within 72 hours
taskly due --notify               # also fire a desktop notification per item
```

## Executing actionable todos (this is you)

For `todoKind: actionable` todos, **you (the agent) do the work directly** — write
the code, draft the message, run the command, whatever the todo describes. Taskly
does not run a separate execution agent in this mode. When the work is done and
verified, mark it complete with the agent attribution:

```bash
taskly done <id> --by agent
```

For `todoKind: notification` todos, do not execute — they are informational
(e.g. "会议改到3点"). Surface them to the user; complete only when acknowledged.

Suggested loop:

1. `taskly extract --save --json` on the user's pasted text.
2. Show the user the extracted list; confirm scope.
3. For each actionable item the user approves, do the task, then
   `taskly done <id> --by agent`.
4. Report what was completed and what remains (`taskly list`).

## Sync (optional)

If the user runs the Taskly server (or the desktop app is signed in), sync the
local store:

```bash
taskly sync push                  # local -> server
taskly sync pull                  # server -> local (merged, deduplicated)
taskly config --set serverUrl=http://127.0.0.1:8080
```

## Image input (optional)

`taskly extract --image screenshot.png` runs local OCR via an optional
`taskly-ocr` sidecar, then extracts. If the sidecar isn't installed the command
errors and you should fall back to asking the user to paste the text. Most of the
time, text input is the right path.

## JSON contract for automation

Every read/write command supports `--json`. Use it whenever you need to chain
steps (e.g. read ids from `list --json`, act, then `done <id> --by agent`). Human
formatting (colors, short ids) is for the user; JSON is for you.
