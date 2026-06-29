import { invoke } from "@tauri-apps/api/core";
import type { OcrResult } from "@/types";

/**
 * Perform OCR on an image file using the native Rust OCR engine.
 */
export async function recognizeImage(imagePath: string): Promise<OcrResult> {
  return invoke<OcrResult>("recognize_image", { imagePath });
}
