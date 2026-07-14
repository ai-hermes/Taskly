import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { OcrRegion } from "@taskly/core";

export interface OcrOutput {
  text: string;
  details?: OcrRegion[];
}

/**
 * Locate the optional `taskly-ocr` sidecar binary.
 *
 * Resolution order:
 *  1. TASKLY_OCR_BIN env var (explicit path)
 *  2. a `bin/taskly-ocr` bundled next to the CLI package
 *  3. `taskly-ocr` on PATH
 *
 * Returns null when no local sidecar can be found.
 */
export function resolveOcrBin(): string | null {
  const explicit = process.env.TASKLY_OCR_BIN?.trim();
  if (explicit) return existsSync(explicit) ? explicit : explicit; // let spawn error surface

  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = [
    join(here, "..", "bin", "taskly-ocr"),
    join(here, "..", "bin", "taskly-ocr.exe"),
  ];
  for (const p of bundled) if (existsSync(p)) return p;

  return "taskly-ocr"; // fall back to PATH; spawn ENOENT if absent
}

/**
 * Run local OCR on an image via the sidecar. The sidecar must print JSON
 * `{ "text": string, "details"?: OcrRegion[] }` to stdout.
 *
 * Throws a helpful error when the sidecar is not installed, so callers can
 * fall back to text-only extraction.
 */
export function ocrImage(imagePath: string, profile?: string): Promise<OcrOutput> {
  const bin = resolveOcrBin();
  if (!bin) {
    return Promise.reject(new Error("OCR sidecar not found"));
  }
  const args = [imagePath];
  if (profile) args.push("--profile", profile);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        reject(
          new Error(
            "OCR sidecar 'taskly-ocr' not installed. Set TASKLY_OCR_BIN or build apps/ocr-sidecar. Falling back to text-only."
          )
        );
      } else {
        reject(e);
      }
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`taskly-ocr exited ${code}: ${err.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(out) as OcrOutput;
        resolve({ text: parsed.text ?? "", details: parsed.details });
      } catch {
        // Non-JSON output: treat the whole stdout as recognized text.
        resolve({ text: out.trim() });
      }
    });
  });
}
