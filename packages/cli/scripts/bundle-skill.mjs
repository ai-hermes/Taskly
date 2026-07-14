// Bundle the canonical codex skill (repo `skills/taskly`) into the CLI package
// (`packages/cli/skill`) so it ships with the published npm tarball.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..", "skills", "taskly");
const dest = join(here, "..", "skill");

if (!existsSync(join(src, "SKILL.md"))) {
  console.error(`[bundle-skill] source skill not found at ${src}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.error(`[bundle-skill] copied ${src} -> ${dest}`);
