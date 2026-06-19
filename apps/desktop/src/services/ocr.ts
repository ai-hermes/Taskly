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

  const command = Command.sidecar("ocr-engine");
  sidecarProcess = await command.spawn();

  // Wait for ready signal and keep a single stdout listener for all responses.
  return new Promise(async (resolve, reject) => {
    const readyTimeout = setTimeout(() => {
      reject(new Error("OCR engine timeout"));
    }, 30000);

    command.stdout.on("data", (rawData: unknown) => {
      const data = typeof rawData === "string" ? rawData : String(rawData);
      try {
        const msg = JSON.parse(data);
        if (msg.status === "ready") {
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
    await startOcrEngine();
  }

  const run = new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingResolver?.timeout === timeout) {
        pendingResolver = null;
      }
      reject(new Error("OCR command timeout"));
    }, 60000);

    pendingResolver = { resolve, reject, timeout };
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
