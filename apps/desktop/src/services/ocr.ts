import { invoke } from "@tauri-apps/api/core";
import type { OcrModelInfo, OcrModelProfileId, OcrResult } from "@/types";

/**
 * The OCR engine is now initialized lazily in Rust through ocr-rs.
 */
export async function startOcrEngine(): Promise<void> {
  console.info("[OCR] using in-process ocr-rs engine");
}

/**
 * Perform OCR on an image file.
 */
export async function recognizeImage(
  imagePath: string,
  profile: OcrModelProfileId
): Promise<OcrResult> {
  return invoke<OcrResult>("recognize_image", { imagePath, profile });
}

export async function getOcrModelInfo(
  profile: OcrModelProfileId
): Promise<OcrModelInfo> {
  return invoke<OcrModelInfo>("get_ocr_model_info", { profile });
}

export async function ensureOcrModelProfile(
  profile: OcrModelProfileId
): Promise<OcrModelInfo> {
  return invoke<OcrModelInfo>("ensure_ocr_model_profile", { profile });
}

export async function resetOcrEngine(): Promise<void> {
  return invoke("reset_ocr_engine");
}

/**
 * ocr-rs runs in-process and is cached by the Rust backend.
 */
export async function stopOcrEngine(): Promise<void> {
  console.debug("[OCR] stop requested; in-process engine remains cached");
}
