import { invoke } from "@tauri-apps/api/core";
import type { OcrResult } from "@/types";

/**
 * The OCR engine is now initialized lazily in Rust through ocr-rs.
 */
export async function startOcrEngine(): Promise<void> {
  console.info("[OCR] using in-process ocr-rs engine");
}

/**
 * Perform OCR on an image file.
 */
export async function recognizeImage(imagePath: string): Promise<OcrResult> {
  return invoke<OcrResult>("recognize_image", { imagePath });
}

/**
 * ocr-rs runs in-process and is cached by the Rust backend.
 */
export async function stopOcrEngine(): Promise<void> {
  console.debug("[OCR] stop requested; in-process engine remains cached");
}
