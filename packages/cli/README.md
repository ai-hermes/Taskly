# @taskly/cli

Taskly command line — capture, manage and remind todos from chat text. Designed
to pair with [codex](https://github.com/openai/codex) via the bundled skill.

```bash
taskly extract --file chat.txt --save --json   # chat text -> structured todos
taskly list                                     # show open todos
taskly done <id> --by agent                     # complete (agent-attributed)
taskly due --within 72 --notify                 # reminders
taskly skill install                            # install the codex skill
```

Data lives in `~/.taskly/todos.json` (override with `TASKLY_HOME`). See the repo
[README](../../README.md#taskly-cli对接-codex) for full docs.

## Configuration

`extract` needs an OpenAI-compatible LLM. Resolution order:

- API key: `TASKLY_LLM_API_KEY` → `OPENAI_API_KEY` → saved config
- Base URL: `TASKLY_LLM_BASE_URL` → `OPENAI_BASE_URL` → saved config
- Model: `TASKLY_LLM_MODEL` → `OPENAI_MODEL` → saved config

```bash
taskly config --set llm.apiKey=sk-... llm.model=gpt-4o-mini
```

## Commands

| Command | Description |
| --- | --- |
| `config` | Show / edit config (`--set k=v`, `--get k`, `--path`, `--json`) |
| `extract` | Extract todos from `--text` / `--file` / stdin / `--image`; `--save`, `--json` |
| `add <title>` | Add a todo (`--desc --due --priority --kind`) |
| `list` | List todos (`--status open\|done\|pending\|all`, `--kind`, `--overdue`, `--json`) |
| `show <id>` | Full detail |
| `update <id>` | Patch fields |
| `done` / `undone <id>` | Complete / reopen (`--by manual\|agent`) |
| `rm <id>` | Delete (tombstoned) |
| `due` | Overdue + due-soon (`--within <hours>`, `--notify`, `--json`) |
| `sync push\|pull` | Sync with the Taskly server (`--server`) |
| `skill install` | Install the codex skill to `~/.codex/skills` |

`<id>` accepts a full UUID or any unambiguous prefix (the 8-char short id works).

## Optional: local OCR

`taskly extract --image <path>` uses the optional `taskly-ocr` sidecar (build
`apps/ocr-sidecar`, then set `TASKLY_OCR_BIN`). Without it, use text input.
