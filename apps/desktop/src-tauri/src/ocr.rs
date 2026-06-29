use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use ocr_rs::{OcrEngine, OcrEngineConfig};
use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
pub struct OcrResponse {
    pub success: bool,
    pub text: String,
    pub details: Vec<OcrText>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OcrText {
    pub text: String,
    pub confidence: f32,
    #[serde(rename = "box")]
    pub box_: Vec<Vec<f32>>,
}

static OCR_ENGINE: Mutex<Option<OcrEngine>> = Mutex::new(None);

pub fn recognize_image(app: &AppHandle, image_path: &str) -> Result<OcrResponse, String> {
    let image_path = Path::new(image_path);
    if !image_path.exists() {
        return Ok(OcrResponse::error(format!(
            "Image not found: {}",
            image_path.display()
        )));
    }

    let models_dir = match resolve_models_dir(app) {
        Ok(dir) => dir,
        Err(error) => return Ok(OcrResponse::error(error)),
    };
    let image = match image::open(image_path) {
        Ok(image) => image,
        Err(error) => {
            return Ok(OcrResponse::error(format!(
                "Failed to open image: {}",
                error
            )));
        }
    };

    let mut engine_lock = match OCR_ENGINE.lock() {
        Ok(lock) => lock,
        Err(_) => return Ok(OcrResponse::error("OCR engine lock poisoned".to_string())),
    };

    if engine_lock.is_none() {
        match create_engine(&models_dir) {
            Ok(engine) => *engine_lock = Some(engine),
            Err(error) => return Ok(OcrResponse::error(error)),
        }
    }

    let Some(engine) = engine_lock.as_mut() else {
        return Ok(OcrResponse::error("Failed to cache OCR engine".to_string()));
    };
    let results = match engine.recognize(&image) {
        Ok(results) => results,
        Err(error) => {
            return Ok(OcrResponse::error(format!(
                "OCR recognition failed: {}",
                error
            )));
        }
    };

    let details: Vec<OcrText> = results
        .into_iter()
        .map(|item| OcrText {
            text: item.text,
            confidence: item.confidence,
            box_: text_box_points(&item.bbox),
        })
        .collect();
    let text = details
        .iter()
        .map(|item| item.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    Ok(OcrResponse {
        success: true,
        text,
        details,
        error: None,
    })
}

fn create_engine(models_dir: &Path) -> Result<OcrEngine, String> {
    let det_model = models_dir.join("PP-OCRv6_small_det.mnn");
    let rec_model = models_dir.join("PP-OCRv6_small_rec.mnn");
    let charset = models_dir.join("ppocr_keys_v6_small.txt");
    for path in [&det_model, &rec_model, &charset] {
        if !path.exists() {
            return Err(format!("OCR model asset missing: {}", path.display()));
        }
    }

    let config = OcrEngineConfig::fast().with_min_result_confidence(0.45);
    OcrEngine::new(det_model, rec_model, charset, Some(config))
        .map_err(|e| format!("Failed to initialize OCR engine: {}", e))
}

fn resolve_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("models"));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("models"));
        candidates.push(current_dir.join("apps/desktop/src-tauri/models"));
    }

    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models"));

    candidates
        .into_iter()
        .find(|path| path.join("PP-OCRv6_small_det.mnn").exists())
        .ok_or_else(|| "Unable to find bundled OCR models".to_string())
}

fn text_box_points(text_box: &ocr_rs::TextBox) -> Vec<Vec<f32>> {
    if let Some(points) = text_box.points {
        return points
            .iter()
            .map(|point| vec![point.x, point.y])
            .collect::<Vec<_>>();
    }

    let left = text_box.rect.left() as f32;
    let top = text_box.rect.top() as f32;
    let right = text_box.rect.right() as f32;
    let bottom = text_box.rect.bottom() as f32;

    vec![
        vec![left, top],
        vec![right, top],
        vec![right, bottom],
        vec![left, bottom],
    ]
}

impl OcrResponse {
    fn error(error: String) -> Self {
        Self {
            success: false,
            text: String::new(),
            details: Vec::new(),
            error: Some(error),
        }
    }
}
