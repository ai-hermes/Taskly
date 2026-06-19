import { Command } from "@tauri-apps/plugin-shell";
import type { OcrResult } from "@/types";

let sidecarProcess: any = null;
let commandQueue: Promise<unknown> = Promise.resolve();
let pendingResolver:
  | {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  | null = null;

/**
 * Start the OCR sidecar process
 */
export async function startOcrEngine(): Promise<void> {
  if (sidecarProcess) return;

  console.info("[OCR] spawning sidecar 'binaries/ocr-engine'...");
  const command = Command.sidecar("binaries/ocr-engine");

  command.stdout.on("data", (rawData: unknown) => {
    const data = typeof rawData === "string" ? rawData : String(rawData);
    console.debug("[OCR] stdout:", data.trim());
  });
  command.stderr.on("data", (rawData: unknown) => {
    const data = typeof rawData === "string" ? rawData : String(rawData);
    console.warn("[OCR] stderr:", data.trim());
  });
  command.on("close", (payload: unknown) => {
    console.warn("[OCR] sidecar closed:", payload);
    sidecarProcess = null;
  });
  command.on("error", (err: unknown) => {
    console.error("[OCR] sidecar error:", err);
  });

  sidecarProcess = await command.spawn();
  console.info("[OCR] sidecar spawned pid=%o, waiting for ready...", sidecarProcess?.pid);

  // Wait for ready signal and keep a single stdout listener for all responses.
  return new Promise((resolve, reject) => {
    const readyTimeout = setTimeout(() => {
      console.error("[OCR] timed out waiting for ready signal (30s)");
      reject(new Error("OCR engine timeout"));
    }, 30000);

    command.stdout.on("data", (rawData: unknown) => {
      const data = typeof rawData === "string" ? rawData : String(rawData);
      try {
        const msg = JSON.parse(data);
        if (msg.status === "ready") {
          console.info("[OCR] ready signal received (version=%o)", msg.version);
          clearTimeout(readyTimeout);
          resolve();
          return;
        }

        if (pendingResolver) {
          clearTimeout(pendingResolver.timeout);
          pendingResolver.resolve(msg);
          pendingResolver = null;
        }
      } catch {
        // ignore non-JSON output
      }
    });

    command.stderr.on("data", (rawData: unknown) => {
      const data = typeof rawData === "string" ? rawData : String(rawData);
      if (pendingResolver) {
        clearTimeout(pendingResolver.timeout);
        pendingResolver.reject(new Error(`OCR engine stderr: ${data}`));
        pendingResolver = null;
      }
    });

    command.on("error", (err: string) => {
      clearTimeout(readyTimeout);
      if (pendingResolver) {
        clearTimeout(pendingResolver.timeout);
        pendingResolver.reject(new Error(`OCR engine error: ${err}`));
        pendingResolver = null;
      }
      reject(new Error(`OCR engine error: ${err}`));
    });
  });
}

/**
 * Send a command to the OCR engine and get response
 */
async function sendCommand(cmd: object): Promise<unknown> {
  if (!sidecarProcess) {
    console.debug("[OCR] no sidecar, starting before command...");
    await startOcrEngine();
  }

  const cmdName = (cmd as { cmd?: string }).cmd ?? "unknown";
  const run = new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error("[OCR] command '%s' timed out (60s)", cmdName);
      if (pendingResolver?.timeout === timeout) {
        pendingResolver = null;
      }
      reject(new Error("OCR command timeout"));
    }, 60000);

    pendingResolver = { resolve, reject, timeout };
    console.debug("[OCR] -> sending command '%s'", cmdName);
    sidecarProcess.write(`${JSON.stringify(cmd)}\n`);
  });

  commandQueue = commandQueue.then(() => run, () => run);
  return commandQueue;
}

/**
 * Perform OCR on an image file
 */
export async function recognizeImage(imagePath: string): Promise<OcrResult> {
  const result = await sendCommand({ cmd: "ocr", image_path: imagePath });
  return result as OcrResult;
}

/**
 * Stop the OCR engine
 */
export async function stopOcrEngine(): Promise<void> {
  if (sidecarProcess) {
    await sendCommand({ cmd: "quit" });
    sidecarProcess = null;
    pendingResolver = null;
    commandQueue = Promise.resolve();
  }
}
