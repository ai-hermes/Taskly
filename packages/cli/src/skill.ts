import {
  cpSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Locate the canonical Taskly skill directory.
 *
 * Works both when installed from npm (a `skill/` copy is bundled next to
 * `dist/`) and in the monorepo during development (repo `skills/taskly`).
 */
export function resolveSkillSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "skill"), // bundled copy in the published package
    join(here, "..", "..", "..", "skills", "taskly"), // monorepo: repo/skills/taskly
    join(here, "..", "..", "..", "..", "skills", "taskly"),
  ];
  for (const p of candidates) {
    if (existsSync(join(p, "SKILL.md"))) return p;
  }
  throw new Error(
    "Could not locate the Taskly skill source (expected a bundled `skill/` dir or repo `skills/taskly`)."
  );
}

export interface InstallSkillOptions {
  dir?: string;
  force?: boolean;
}

/** Install (copy) the Taskly skill into the codex skills directory. */
export function installSkill(opts: InstallSkillOptions = {}): string {
  const src = resolveSkillSource();
  const skillsDir = opts.dir?.trim() || join(homedir(), ".codex", "skills");
  const dest = join(skillsDir, "taskly");

  if (existsSync(dest) && !opts.force) {
    throw new Error(`${dest} already exists. Re-run with --force to overwrite.`);
  }

  mkdirSync(skillsDir, { recursive: true });
  cpSync(src, dest, { recursive: true });
  return dest;
}
