#!/usr/bin/env node
/**
 * Stamp a release version across the monorepo so a git tag drives the built
 * artifacts. Accepts a tag like `v0.2.0` (or a bare `0.2.0`) and writes the
 * normalized semver into:
 *   - package.json                                   (root)
 *   - apps/desktop/package.json                      (@taskly/desktop)
 *   - apps/desktop/src-tauri/tauri.conf.json         (bundled app version)
 *   - apps/desktop/src-tauri/Cargo.toml              ([package] version)
 *
 * Usage: node scripts/set-version.mjs <tag>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const rawArg = process.argv[2];
if (!rawArg) {
  console.error("usage: node scripts/set-version.mjs <tag>");
  process.exit(1);
}

// Normalize: strip a leading `v`, drop any pre-release/build suffix for the
// numeric fields Cargo/Tauri require (e.g. v1.2.3-beta.1 -> 1.2.3).
const version = rawArg.replace(/^v/, "").trim();
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`invalid version derived from tag: ${rawArg} -> ${version}`);
  process.exit(1);
}
const coreVersion = version.match(/^\d+\.\d+\.\d+/)[0];

function updateJson(relPath, mutate) {
  const abs = join(repoRoot, relPath);
  const json = JSON.parse(readFileSync(abs, "utf8"));
  mutate(json);
  writeFileSync(abs, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`[set-version] ${relPath} -> ${version}`);
}

updateJson("package.json", (j) => (j.version = version));
updateJson("apps/desktop/package.json", (j) => (j.version = version));
// Tauri/Cargo want plain numeric semver (no pre-release metadata).
updateJson("apps/desktop/src-tauri/tauri.conf.json", (j) => (j.version = coreVersion));

// Cargo.toml: replace only the first `version = "..."` inside [package].
const cargoRel = "apps/desktop/src-tauri/Cargo.toml";
const cargoAbs = join(repoRoot, cargoRel);
const cargo = readFileSync(cargoAbs, "utf8");
let seenPackage = false;
let replaced = false;
const nextCargo = cargo
  .split("\n")
  .map((line) => {
    if (/^\s*\[package\]\s*$/.test(line)) seenPackage = true;
    else if (/^\s*\[/.test(line)) seenPackage = false;
    if (seenPackage && !replaced && /^\s*version\s*=/.test(line)) {
      replaced = true;
      return `version = "${coreVersion}"`;
    }
    return line;
  })
  .join("\n");
if (!replaced) {
  console.error(`[set-version] could not find [package] version in ${cargoRel}`);
  process.exit(1);
}
writeFileSync(cargoAbs, nextCargo);
console.log(`[set-version] ${cargoRel} -> ${coreVersion}`);
