#!/usr/bin/env node
/**
 * Build the pi-coding-agent sidecar binary for Tauri bundling.
 *
 * Installs @mariozechner/pi-coding-agent into a temp dir, compiles it into a
 * self-contained executable with `bun build --compile`, and drops it at
 * src-tauri/binaries/pi-coding-agent-{target-triple} (Tauri externalBin
 * naming convention).
 *
 * Usage: node scripts/build-pi-sidecar.mjs [--version <npm-version>]
 * Requires: bun >= 1.1, npm.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "@mariozechner/pi-coding-agent";
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(desktopDir, "src-tauri", "binaries");

// On Windows, bun ships as `bun.exe`. Node's execFileSync does not perform
// PATHEXT resolution, so the bare name fails with ENOENT. (npm is a `.cmd`
// shim and is handled separately via runNpm below.)
const isWindows = process.platform === "win32";
const BUN = isWindows ? "bun.exe" : "bun";

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

// On Windows, npm is a `.cmd` shim. Since Node 18.20/20.12/22 (CVE-2024-27980),
// execFile/spawn refuse to run `.cmd`/`.bat` files without `shell: true`,
// throwing EINVAL. Run npm through the shell on Windows to avoid this.
function runNpm(args, opts = {}) {
  if (isWindows) {
    // With shell:true, quote args to survive paths containing spaces.
    const quoted = args.map((a) => `"${a}"`).join(" ");
    execSync(`npm ${quoted}`, opts);
  } else {
    execFileSync("npm", args, opts);
  }
}

const versionIdx = process.argv.indexOf("--version");
const spec =
  versionIdx > -1 && process.argv[versionIdx + 1]
    ? `${PACKAGE}@${process.argv[versionIdx + 1]}`
    : `${PACKAGE}@latest`;

const triple = hostTriple();
const ext = process.platform === "win32" ? ".exe" : "";
const outFile = join(outDir, `pi-coding-agent-${triple}${ext}`);

const workDir = mkdtempSync(join(tmpdir(), "pi-sidecar-"));
try {
  console.log(`[sidecar] installing ${spec} ...`);
  runNpm(
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--prefix",
      workDir,
      spec,
      // Optional peer of transitive deps (@mistralai); bun --compile needs
      // every import resolvable.
      "@opentelemetry/api",
    ],
    { stdio: "inherit" }
  );

  const entry = join(
    workDir,
    "node_modules",
    "@mariozechner",
    "pi-coding-agent",
    "dist",
    "cli.js"
  );
  if (!existsSync(entry)) {
    throw new Error(`Entry not found: ${entry}`);
  }

  mkdirSync(outDir, { recursive: true });
  console.log(`[sidecar] compiling to ${outFile} ...`);
  execFileSync(
    BUN,
    ["build", "--compile", entry, "--outfile", outFile],
    { stdio: "inherit", cwd: workDir }
  );

  // pi resolves data assets (package.json, theme/, dist|src/modes/.../assets)
  // relative to PI_PACKAGE_DIR. Export the whole package (minus node_modules)
  // next to the binaries so the runtime can point PI_PACKAGE_DIR at it.
  const pkgSrcDir = join(
    workDir,
    "node_modules",
    "@mariozechner",
    "pi-coding-agent"
  );
  const pkgDir = join(outDir, "pi-package");
  rmSync(pkgDir, { recursive: true, force: true });
  mkdirSync(pkgDir, { recursive: true });
  cpSync(pkgSrcDir, pkgDir, {
    recursive: true,
    dereference: true,
    filter: (src) => src === pkgSrcDir || !src.startsWith(join(pkgSrcDir, "node_modules")),
  });

  // The bun-compiled binary (isBunBinary) resolves data assets from a FLAT
  // layout under PI_PACKAGE_DIR: theme/, assets/, export-html/. The npm
  // package ships these under dist/..., so mirror them to the expected paths.
  const flatAssets = [
    ["dist/modes/interactive/theme", "theme"],
    ["dist/modes/interactive/assets", "assets"],
    ["dist/core/export-html", "export-html"],
  ];
  for (const [from, to] of flatAssets) {
    const srcAsset = join(pkgDir, from);
    if (existsSync(srcAsset)) {
      cpSync(srcAsset, join(pkgDir, to), { recursive: true, dereference: true });
    } else {
      console.warn(`[sidecar] warning: expected asset dir missing: ${from}`);
    }
  }

  execFileSync(outFile, ["--version"], {
    stdio: "inherit",
    env: { ...process.env, PI_PACKAGE_DIR: pkgDir },
  });
  console.log(`[sidecar] done: ${outFile}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
