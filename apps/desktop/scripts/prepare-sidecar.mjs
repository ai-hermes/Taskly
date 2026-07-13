#!/usr/bin/env node
/**
 * Ensure Tauri sidecar resources exist before `tauri dev/build`.
 *
 * Strategy:
 * 1) If sidecar + pi-package already exist, do nothing.
 * 2) If bun exists, build the real sidecar via build-pi-sidecar.mjs.
 * 3) Otherwise create a local dev shim so Rust/Tauri build can proceed.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = join(desktopDir, "src-tauri", "binaries");

function hostTriple() {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const m = out.match(/^host:\s*(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    // fall through to manual mapping
  }

  const archMap = { arm64: "aarch64", x64: "x86_64" };
  const arch = archMap[process.arch];
  if (!arch) throw new Error(`Unsupported arch: ${process.arch}`);

  switch (process.platform) {
    case "darwin":
      return `${arch}-apple-darwin`;
    case "linux":
      return `${arch}-unknown-linux-gnu`;
    case "win32":
      return `${arch}-pc-windows-msvc`;
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function hasBun() {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureStubPackage(pkgDir) {
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(join(pkgDir, "theme"), { recursive: true });
  mkdirSync(join(pkgDir, "assets"), { recursive: true });
  mkdirSync(join(pkgDir, "export-html"), { recursive: true });
  const pkgJson = join(pkgDir, "package.json");
  if (!existsSync(pkgJson)) {
    writeFileSync(
      pkgJson,
      JSON.stringify(
        {
          name: "@taskly/pi-sidecar-dev-stub",
          version: "0.0.0-dev",
          private: true,
          description: "Local dev stub for Taskly sidecar",
        },
        null,
        2
      ) + "\n"
    );
  }
}

function ensureStubSidecar(binPath, pkgDir) {
  mkdirSync(dirname(binPath), { recursive: true });
  if (process.platform === "win32") {
    throw new Error(
      "Missing sidecar and bun is not installed. Please run `pnpm build:sidecar` first."
    );
  }
  const script = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "pi-coding-agent-dev-stub 0.0.0"
  exit 0
fi
echo "Taskly sidecar stub: real pi-coding-agent is not built yet." 1>&2
echo "Run: cd apps/desktop && pnpm build:sidecar" 1>&2
exit 1
`;
  writeFileSync(binPath, script);
  chmodSync(binPath, 0o755);
  ensureStubPackage(pkgDir);
}

const triple = hostTriple();
const binExt = process.platform === "win32" ? ".exe" : "";
const binPath = join(binariesDir, `pi-coding-agent-${triple}${binExt}`);
const pkgDir = join(binariesDir, "pi-package");
const pkgJson = join(pkgDir, "package.json");

const ready = existsSync(binPath) && existsSync(pkgJson);
if (ready) {
  process.exit(0);
}

if (hasBun()) {
  console.log("[sidecar] missing sidecar detected, building with bun...");
  execFileSync("node", [join(desktopDir, "scripts", "build-pi-sidecar.mjs")], {
    stdio: "inherit",
  });
  process.exit(0);
}

console.warn(
  "[sidecar] bun not found; creating dev stub sidecar so tauri build can continue."
);
ensureStubSidecar(binPath, pkgDir);
const current = readFileSync(pkgJson, "utf8");
if (!current.includes("@taskly/pi-sidecar-dev-stub")) {
  console.warn(
    "[sidecar] existing pi-package is non-stub; keeping as-is and only ensuring files exist."
  );
}
