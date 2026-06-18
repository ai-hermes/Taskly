import { Command } from "@tauri-apps/plugin-shell";
import type { OcrResult } from "@/types";

let sidecarProcess: any = null;

/**
 * Start the OCR sidecar process
 */
export async function startOcrEngine(): Promise<void> {
  if (sidecarProcess) return;

  const command = Command.sidecar("ocr-engine");
  sidecarProcess = await command.spawn();

  // Wait for ready signal
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OCR engine timeout")), 30000);

    command.stdout.on("data", (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.status === "ready") {
          clearTimeout(timeout);
          resolve();
        }
      } catch {
        // ignore non-JSON output
      }
    });

    command.on("error", (err: string) => {
      clearTimeout(timeout);
      reject(new Error(`OCR engine error: ${err}`));
    });
  });
}

/**
 * Send a command to the OCR engine and get response
 */
async function sendCommand(cmd: object): Promise<any> {
  if (!sidecarProcess) {
    await startOcrEngine();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OCR command timeout")), 60000);

    // Listen for response
    const handler = (data: string) => {
      try {
        const response = JSON.parse(data);
        clearTimeout(timeout);
        resolve(response);
      } catch {
        // wait for valid JSON
      }
    };

    sidecarProcess.stdout.on("data", handler);
    sidecarProcess.write(JSON.stringify(cmd) + "\n");
  });
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
  }
}
