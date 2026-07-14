#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command, Option } from "commander";
import {
  OpenAIProvider,
  dedupTodos,
  fingerprint,
  uuid,
  type OcrRegion,
  type TodoItem,
  type TodoKind,
} from "@taskly/core";
import {
  loadConfig,
  loadRawConfig,
  saveConfig,
  setConfigKey,
  redactedConfig,
} from "./config.js";
import { configPath } from "./paths.js";
import {
  loadStore,
  saveStore,
  findTodoIndex,
  deleteTodo,
  withFingerprint,
  TOMBSTONE_TTL_MS,
} from "./store.js";
import {
  formatTodoLine,
  formatTodoDetail,
  printJson,
  readStdin,
  shortId,
  c,
} from "./util.js";
import { ocrImage } from "./ocr.js";
import { notify } from "./notify.js";
import { syncPush, syncPull } from "./sync.js";
import { installSkill } from "./skill.js";

const program = new Command();

program
  .name("taskly")
  .description("Taskly — capture, manage and remind todos from chat text. Pairs with codex.")
  .version("0.1.0");

function fail(msg: string): never {
  process.stderr.write(`${c.red("error")}: ${msg}\n`);
  process.exit(1);
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseKind(v?: string): TodoKind {
  return v === "notification" ? "notification" : "actionable";
}

function parsePriority(v?: string): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(3, Math.trunc(n))) : 0;
}

// ---------------------------------------------------------------- config
program
  .command("config")
  .description("Show or edit CLI configuration (~/.taskly/config.json)")
  .option("--set <key=value...>", "set a config value (llm.baseUrl, llm.apiKey, llm.model, serverUrl)")
  .option("--get <key>", "print a single config value")
  .option("--path", "print the config file path")
  .option("--json", "output as JSON")
  .action((opts) => {
    if (opts.path) {
      process.stdout.write(configPath() + "\n");
      return;
    }
    if (opts.set) {
      const cfg = loadRawConfig();
      for (const pair of opts.set as string[]) {
        const eq = pair.indexOf("=");
        if (eq < 0) fail(`invalid --set entry "${pair}" (expected key=value)`);
        setConfigKey(cfg, pair.slice(0, eq).trim(), pair.slice(eq + 1));
      }
      saveConfig(cfg);
      process.stdout.write(c.green("✔ config saved") + "\n");
      return;
    }
    const cfg = loadConfig();
    if (opts.get) {
      const map: Record<string, string> = {
        "llm.baseUrl": cfg.llm.baseUrl,
        "llm.apiKey": cfg.llm.apiKey,
        "llm.model": cfg.llm.model,
        serverUrl: cfg.serverUrl,
        deviceId: cfg.deviceId,
      };
      const val = map[opts.get];
      if (val === undefined) fail(`unknown key "${opts.get}"`);
      process.stdout.write(val + "\n");
      return;
    }
    if (opts.json) return printJson(redactedConfig(cfg));
    const r = redactedConfig(cfg);
    process.stdout.write(
      [
        `${c.gray("llm.baseUrl")}  ${r.llm.baseUrl}`,
        `${c.gray("llm.model")}    ${r.llm.model}`,
        `${c.gray("llm.apiKey")}   ${r.llm.apiKey || c.yellow("(unset)")}`,
        `${c.gray("serverUrl")}    ${r.serverUrl}`,
        `${c.gray("deviceId")}     ${r.deviceId}`,
      ].join("\n") + "\n"
    );
  });

// ---------------------------------------------------------------- extract
program
  .command("extract")
  .description("Extract structured todos from chat text (or an image via local OCR)")
  .option("--text <text>", "text to extract from")
  .option("--file <path>", "read text from a file")
  .option("--image <path>", "recognize an image with the local OCR sidecar, then extract")
  .option("--profile <id>", "OCR model profile (sidecar-specific)")
  .option("--save", "add extracted todos to the local store (deduplicated)")
  .option("--confirmed", "mark saved todos as confirmed instead of pending")
  .option("--json", "output extracted todos as JSON")
  .action(async (opts) => {
    const cfg = loadConfig();
    if (!cfg.llm.apiKey) {
      fail("no LLM API key. Set it via `taskly config --set llm.apiKey=...` or OPENAI_API_KEY.");
    }

    let text = "";
    let ocrScreenshot: string | undefined;
    let ocrDetails: OcrRegion[] | undefined;

    if (opts.image) {
      try {
        const result = await ocrImage(opts.image, opts.profile);
        text = result.text;
        ocrScreenshot = opts.image;
        ocrDetails = result.details;
        if (!text.trim()) fail("OCR produced no text from the image.");
      } catch (e) {
        fail((e as Error).message);
      }
    } else if (opts.text) {
      text = opts.text;
    } else if (opts.file) {
      text = readFileSync(opts.file, "utf8");
    } else {
      text = await readStdin();
    }

    if (!text.trim()) {
      fail("no input text. Provide --text, --file, --image, or pipe text via stdin.");
    }

    const store = loadStore();
    const knownTitles = store.todos.filter((t) => !t.done).map((t) => t.title);

    const provider = new OpenAIProvider(cfg.llm.apiKey, cfg.llm.model, cfg.llm.baseUrl);
    let extracted: TodoItem[];
    try {
      extracted = await provider.extractTodos(text, {
        knownTitles,
        screenshotPath: ocrScreenshot,
        ocrDetails,
      });
    } catch (e) {
      return fail((e as Error).message);
    }

    if (opts.confirmed) {
      extracted = extracted.map((t) => ({ ...t, reviewStatus: "confirmed" as const }));
    }

    if (opts.save) {
      const { added } = dedupTodos(extracted, store.todos, store.tombstones, TOMBSTONE_TTL_MS);
      store.todos.push(...added);
      saveStore(store);
      if (opts.json) return printJson(added);
      process.stdout.write(
        c.green(`✔ extracted ${extracted.length}, added ${added.length} new todo(s)`) + "\n"
      );
      for (const t of added) process.stdout.write("  " + formatTodoLine(t) + "\n");
      return;
    }

    if (opts.json) return printJson(extracted);
    if (extracted.length === 0) {
      process.stdout.write(c.dim("no todos found") + "\n");
      return;
    }
    for (const t of extracted) process.stdout.write(formatTodoLine(t) + "\n");
    process.stdout.write(
      c.dim(`\n${extracted.length} todo(s). Re-run with --save to store them.`) + "\n"
    );
  });

// ---------------------------------------------------------------- add
program
  .command("add")
  .description("Add a todo manually")
  .argument("<title>", "todo title")
  .option("--desc <text>", "description")
  .option("--due <iso>", "due date (ISO-8601 or YYYY-MM-DD)")
  .option("--priority <0-3>", "priority 0 (low) to 3 (high)", "0")
  .addOption(new Option("--kind <kind>", "todo kind").choices(["actionable", "notification"]).default("actionable"))
  .option("--json", "output the created todo as JSON")
  .action((title, opts) => {
    const store = loadStore();
    const todo: TodoItem = {
      id: uuid(),
      title,
      description: opts.desc ?? "",
      done: false,
      source: "cli",
      priority: parsePriority(opts.priority),
      dueDate: opts.due ? new Date(opts.due).toISOString() : undefined,
      reviewStatus: "confirmed",
      todoKind: parseKind(opts.kind),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    todo.fingerprint = fingerprint(todo);
    store.todos.push(todo);
    saveStore(store);
    if (opts.json) return printJson(todo);
    process.stdout.write(c.green("✔ added ") + formatTodoLine(todo) + "\n");
  });

// ---------------------------------------------------------------- list
program
  .command("list")
  .alias("ls")
  .description("List todos")
  .addOption(new Option("--status <status>", "filter by status").choices(["open", "done", "pending", "all"]).default("open"))
  .addOption(new Option("--kind <kind>", "filter by kind").choices(["actionable", "notification"]))
  .option("--overdue", "only overdue todos")
  .option("--json", "output as JSON")
  .action((opts) => {
    const store = loadStore();
    let todos = store.todos.slice();
    switch (opts.status) {
      case "done":
        todos = todos.filter((t) => t.done);
        break;
      case "pending":
        todos = todos.filter((t) => !t.done && t.reviewStatus === "pending_confirmation");
        break;
      case "all":
        break;
      default: // open
        todos = todos.filter((t) => !t.done);
    }
    if (opts.kind) todos = todos.filter((t) => (t.todoKind ?? "actionable") === opts.kind);
    if (opts.overdue) {
      const now = Date.now();
      todos = todos.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now && !t.done);
    }
    // Sort: incomplete first, then by priority desc, then due date asc.
    todos.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.priority !== b.priority) return b.priority - a.priority;
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return ad - bd;
    });
    if (opts.json) return printJson(todos);
    if (todos.length === 0) {
      process.stdout.write(c.dim("no todos") + "\n");
      return;
    }
    for (const t of todos) process.stdout.write(formatTodoLine(t) + "\n");
    process.stdout.write(c.dim(`\n${todos.length} todo(s)`) + "\n");
  });

// ---------------------------------------------------------------- show
program
  .command("show")
  .description("Show a todo's full detail")
  .argument("<id>", "todo id or id-prefix")
  .option("--json", "output as JSON")
  .action((id, opts) => {
    const store = loadStore();
    const idx = findTodoIndex(store.todos, id);
    if (idx < 0) fail(`no todo found for "${id}"`);
    const todo = store.todos[idx];
    if (opts.json) return printJson(todo);
    process.stdout.write(formatTodoDetail(todo) + "\n");
  });

// ---------------------------------------------------------------- update
program
  .command("update")
  .description("Update fields of a todo")
  .argument("<id>", "todo id or id-prefix")
  .option("--title <text>")
  .option("--desc <text>")
  .option("--due <iso>", "due date (empty string clears)")
  .option("--priority <0-3>")
  .addOption(new Option("--kind <kind>").choices(["actionable", "notification"]))
  .option("--done", "mark done")
  .option("--undone", "mark not done")
  .option("--confirm", "mark reviewStatus confirmed")
  .addOption(new Option("--by <who>", "who completed it").choices(["manual", "agent"]))
  .option("--json", "output the updated todo as JSON")
  .action((id, opts) => {
    const store = loadStore();
    const idx = findTodoIndex(store.todos, id);
    if (idx < 0) fail(`no todo found for "${id}"`);
    const t = { ...store.todos[idx] };
    if (opts.title !== undefined) t.title = opts.title;
    if (opts.desc !== undefined) t.description = opts.desc;
    if (opts.due !== undefined) t.dueDate = opts.due ? new Date(opts.due).toISOString() : undefined;
    if (opts.priority !== undefined) t.priority = parsePriority(opts.priority);
    if (opts.kind !== undefined) t.todoKind = parseKind(opts.kind);
    if (opts.done) {
      t.done = true;
      t.completedBy = (opts.by as "manual" | "agent") ?? "manual";
    }
    if (opts.undone) {
      t.done = false;
      t.completedBy = undefined;
    }
    if (opts.confirm) t.reviewStatus = "confirmed";
    t.updatedAt = nowIso();
    t.fingerprint = fingerprint(t);
    store.todos[idx] = t;
    saveStore(store);
    if (opts.json) return printJson(t);
    process.stdout.write(c.green("✔ updated ") + formatTodoLine(t) + "\n");
  });

// ---------------------------------------------------------------- done / undone
program
  .command("done")
  .description("Mark a todo as done")
  .argument("<id>", "todo id or id-prefix")
  .addOption(new Option("--by <who>", "who completed it").choices(["manual", "agent"]).default("manual"))
  .option("--json", "output the updated todo as JSON")
  .action((id, opts) => {
    const store = loadStore();
    const idx = findTodoIndex(store.todos, id);
    if (idx < 0) fail(`no todo found for "${id}"`);
    const t = { ...store.todos[idx], done: true, completedBy: opts.by, updatedAt: nowIso() };
    store.todos[idx] = t;
    saveStore(store);
    if (opts.json) return printJson(t);
    process.stdout.write(c.green("✔ done ") + formatTodoLine(t) + "\n");
  });

program
  .command("undone")
  .description("Mark a todo as not done")
  .argument("<id>", "todo id or id-prefix")
  .option("--json", "output the updated todo as JSON")
  .action((id, opts) => {
    const store = loadStore();
    const idx = findTodoIndex(store.todos, id);
    if (idx < 0) fail(`no todo found for "${id}"`);
    const t = { ...store.todos[idx], done: false, completedBy: undefined, updatedAt: nowIso() };
    store.todos[idx] = t;
    saveStore(store);
    if (opts.json) return printJson(t);
    process.stdout.write(c.green("✔ reopened ") + formatTodoLine(t) + "\n");
  });

// ---------------------------------------------------------------- rm
program
  .command("rm")
  .alias("remove")
  .description("Delete a todo (records a tombstone to block re-detection)")
  .argument("<id>", "todo id or id-prefix")
  .action((id) => {
    const store = loadStore();
    let removed;
    try {
      removed = deleteTodo(store, id);
    } catch (e) {
      return fail((e as Error).message);
    }
    saveStore(store);
    process.stdout.write(c.green("✔ removed ") + c.gray(shortId(removed.id)) + " " + removed.title + "\n");
  });

// ---------------------------------------------------------------- due / remind
program
  .command("due")
  .alias("remind")
  .description("List overdue and soon-due todos; optionally fire a system notification")
  .option("--within <hours>", "look-ahead window in hours", "24")
  .option("--notify", "fire a desktop notification for each item")
  .option("--json", "output as JSON")
  .action(async (opts) => {
    const store = loadStore();
    const now = Date.now();
    const windowMs = Number(opts.within) * 60 * 60 * 1000;
    const items = store.todos
      .filter((t) => !t.done && t.dueDate)
      .map((t) => ({ t, due: new Date(t.dueDate as string).getTime() }))
      .filter(({ due }) => Number.isFinite(due) && due <= now + windowMs)
      .sort((a, b) => a.due - b.due)
      .map(({ t }) => t);

    if (opts.json) return printJson(items);
    if (items.length === 0) {
      process.stdout.write(c.dim("nothing due") + "\n");
      return;
    }
    for (const t of items) process.stdout.write(formatTodoLine(t) + "\n");
    if (opts.notify) {
      for (const t of items) {
        const overdue = new Date(t.dueDate as string).getTime() < now;
        await notify(overdue ? "Taskly · 已逾期" : "Taskly · 即将到期", t.title);
      }
    }
  });

// ---------------------------------------------------------------- sync
const sync = program.command("sync").description("Sync todos with the Taskly server");
sync
  .command("push")
  .description("Push local todos to the server")
  .option("--server <url>", "override server URL")
  .action(async (opts) => {
    const cfg = loadConfig();
    const store = loadStore();
    try {
      const n = await syncPush(opts.server ?? cfg.serverUrl, store.todos, cfg.deviceId);
      process.stdout.write(c.green(`✔ pushed ${n} todo(s)`) + "\n");
    } catch (e) {
      fail((e as Error).message);
    }
  });
sync
  .command("pull")
  .description("Pull todos from the server and merge (deduplicated) into the local store")
  .option("--server <url>", "override server URL")
  .option("--replace", "replace local todos instead of merging")
  .action(async (opts) => {
    const cfg = loadConfig();
    const store = loadStore();
    try {
      const remote = (await syncPull(opts.server ?? cfg.serverUrl)).map(withFingerprint);
      if (opts.replace) {
        store.todos = remote;
        saveStore(store);
        process.stdout.write(c.green(`✔ replaced local with ${remote.length} todo(s)`) + "\n");
        return;
      }
      const existingIds = new Set(store.todos.map((t) => t.id));
      const { added } = dedupTodos(
        remote.filter((t) => !existingIds.has(t.id)),
        store.todos,
        store.tombstones,
        TOMBSTONE_TTL_MS
      );
      store.todos.push(...added);
      saveStore(store);
      process.stdout.write(c.green(`✔ pulled ${remote.length}, merged ${added.length} new`) + "\n");
    } catch (e) {
      fail((e as Error).message);
    }
  });

// ---------------------------------------------------------------- skill
program
  .command("skill")
  .description("Manage the Taskly codex skill")
  .argument("[action]", "action: install", "install")
  .option("--dir <path>", "target skills directory (default ~/.codex/skills)")
  .option("--force", "overwrite an existing install")
  .action((action, opts) => {
    if (action !== "install") fail(`unknown skill action "${action}" (expected: install)`);
    try {
      const dest = installSkill({ dir: opts.dir, force: opts.force });
      process.stdout.write(c.green("✔ installed Taskly skill to ") + dest + "\n");
    } catch (e) {
      fail((e as Error).message);
    }
  });

program.parseAsync(process.argv).catch((e) => fail((e as Error).message));
