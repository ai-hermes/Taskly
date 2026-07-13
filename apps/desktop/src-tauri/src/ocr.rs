use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use ocr_rs::{OcrEngine, OcrEngineConfig};
use reqwest::blocking::Client;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResponse {
    pub success: bool,
    pub text: String,
    pub details: Vec<OcrText>,
    pub image_width: u32,
    pub image_height: u32,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OcrText {
    pub text: String,
    pub confidence: f32,
    #[serde(rename = "box")]
    pub box_: Vec<Vec<f32>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrModelAssetInfo {
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrModelInfo {
    pub ready: bool,
    pub engine_cached: bool,
    pub selected_profile: String,
    pub models_dir: Option<String>,
    pub source_label: Option<String>,
    pub assets: Vec<OcrModelAssetInfo>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrDownloadProgress {
    pub file_name: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub done: bool,
}

struct CachedOcrEngine {
    profile_id: &'static str,
    engine: OcrEngine,
}

struct ModelProfileSpec {
    id: &'static str,
    det_exact: &'static [&'static str],
    det_prefix: &'static [&'static str],
    rec_exact: &'static [&'static str],
    rec_prefix: &'static [&'static str],
    charset_exact: &'static [&'static str],
    charset_prefix: &'static [&'static str],
    download_det: &'static [&'static str],
    download_rec: &'static [&'static str],
    download_charset: &'static [&'static str],
}

const PROFILE_V4: ModelProfileSpec = ModelProfileSpec {
    id: "ppocrv4",
    det_exact: &["ch_PP-OCRv4_det_infer.mnn"],
    det_prefix: &[],
    rec_exact: &["ch_PP-OCRv4_rec_infer.mnn"],
    rec_prefix: &[],
    charset_exact: &["ppocr_keys_v4.txt", "ppocr_keys.txt"],
    charset_prefix: &[],
    download_det: &["ch_PP-OCRv4_det_infer.mnn"],
    download_rec: &["ch_PP-OCRv4_rec_infer.mnn"],
    download_charset: &["ppocr_keys_v4.txt"],
};

const PROFILE_V5: ModelProfileSpec = ModelProfileSpec {
    id: "ppocrv5_mobile",
    det_exact: &["PP-OCRv5_mobile_det.mnn", "PP-OCRv5_mobile_det_fp16.mnn"],
    det_prefix: &[],
    rec_exact: &[],
    rec_prefix: &["PP-OCRv5_mobile_rec", "PP-OCRv5_server_rec"],
    charset_exact: &["ppocr_keys_v5.txt", "ppocr_keys.txt"],
    charset_prefix: &["ppocr_keys_"],
    download_det: &["PP-OCRv5_mobile_det.mnn"],
    download_rec: &["PP-OCRv5_mobile_rec.mnn", "PP-OCRv5_server_rec.mnn"],
    download_charset: &["ppocr_keys_v5.txt"],
};

const PROFILE_V5_FP16: ModelProfileSpec = ModelProfileSpec {
    id: "ppocrv5_mobile_fp16",
    det_exact: &["PP-OCRv5_mobile_det_fp16.mnn", "PP-OCRv5_mobile_det.mnn"],
    det_prefix: &[],
    rec_exact: &["PP-OCRv5_mobile_rec_fp16.mnn"],
    rec_prefix: &["PP-OCRv5_mobile_rec"],
    charset_exact: &["ppocr_keys_v5.txt", "ppocr_keys.txt"],
    charset_prefix: &["ppocr_keys_"],
    download_det: &["PP-OCRv5_mobile_det_fp16.mnn", "PP-OCRv5_mobile_det.mnn"],
    download_rec: &["PP-OCRv5_mobile_rec_fp16.mnn", "PP-OCRv5_mobile_rec.mnn"],
    download_charset: &["ppocr_keys_v5.txt"],
};

const PROFILE_V6_TINY: ModelProfileSpec = ModelProfileSpec {
    id: "ppocrv6_tiny",
    det_exact: &["PP-OCRv6_tiny_det.mnn"],
    det_prefix: &[],
    rec_exact: &["PP-OCRv6_tiny_rec.mnn"],
    rec_prefix: &[],
    charset_exact: &["ppocr_keys_v6_tiny.txt"],
    charset_prefix: &[],
    download_det: &["PP-OCRv6_tiny_det.mnn"],
    download_rec: &["PP-OCRv6_tiny_rec.mnn"],
    download_charset: &["ppocr_keys_v6_tiny.txt"],
};

const PROFILE_V6_SMALL: ModelProfileSpec = ModelProfileSpec {
    id: "ppocrv6_small",
    det_exact: &["PP-OCRv6_small_det.mnn"],
    det_prefix: &[],
    rec_exact: &["PP-OCRv6_small_rec.mnn"],
    rec_prefix: &[],
    charset_exact: &["ppocr_keys_v6_small.txt"],
    charset_prefix: &[],
    download_det: &["PP-OCRv6_small_det.mnn"],
    download_rec: &["PP-OCRv6_small_rec.mnn"],
    download_charset: &["ppocr_keys_v6_small.txt"],
};

const PROFILE_V6_MEDIUM: ModelProfileSpec = ModelProfileSpec {
    id: "ppocrv6_medium",
    det_exact: &["PP-OCRv6_medium_det.mnn"],
    det_prefix: &[],
    rec_exact: &["PP-OCRv6_medium_rec.mnn"],
    rec_prefix: &[],
    charset_exact: &["ppocr_keys_v6_medium.txt"],
    charset_prefix: &[],
    download_det: &["PP-OCRv6_medium_det.mnn"],
    download_rec: &["PP-OCRv6_medium_rec.mnn"],
    download_charset: &["ppocr_keys_v6_medium.txt"],
};

const MODEL_PROFILES: [&ModelProfileSpec; 6] = [
    &PROFILE_V4,
    &PROFILE_V5,
    &PROFILE_V5_FP16,
    &PROFILE_V6_TINY,
    &PROFILE_V6_SMALL,
    &PROFILE_V6_MEDIUM,
];

const MODEL_BASE_URLS: [&str; 2] = [
    "https://raw.githubusercontent.com/zibo-chen/rust-paddle-ocr/next/models",
    "https://raw.githubusercontent.com/zibo-chen/rust-paddle-ocr/HEAD/models",
];

static OCR_ENGINE: Mutex<Option<CachedOcrEngine>> = Mutex::new(None);

pub fn recognize_image(
    app: &AppHandle,
    image_path: &str,
    profile: &str,
) -> Result<OcrResponse, String> {
    let image_path = Path::new(image_path);
    if !image_path.exists() {
        return Ok(OcrResponse::error(format!(
            "Image not found: {}",
            image_path.display()
        )));
    }

    let spec = resolve_profile(profile);
    let model_sources = collect_model_sources(app);
    if model_sources.is_empty() {
        return Ok(OcrResponse::error(
            "Unable to find OCR models directory".to_string(),
        ));
    }
    let model_paths: Vec<PathBuf> = model_sources.iter().map(|(path, _)| path.clone()).collect();
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

    let should_rebuild = match engine_lock.as_ref() {
        Some(cached) => cached.profile_id != spec.id,
        None => true,
    };

    if should_rebuild {
        match create_engine(&model_paths, spec) {
            Ok(engine) => {
                *engine_lock = Some(CachedOcrEngine {
                    profile_id: spec.id,
                    engine,
                })
            }
            Err(error) => return Ok(OcrResponse::error(error)),
        }
    }

    let Some(cached) = engine_lock.as_mut() else {
        return Ok(OcrResponse::error("Failed to cache OCR engine".to_string()));
    };
    let results = match cached.engine.recognize(&image) {
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
        image_width: image.width(),
        image_height: image.height(),
        error: None,
    })
}

fn create_engine(model_dirs: &[PathBuf], spec: &ModelProfileSpec) -> Result<OcrEngine, String> {
    let det_model = resolve_required_asset(model_dirs, spec.det_exact, spec.det_prefix)
        .ok_or_else(|| format!("OCR detection model missing for profile {}", spec.id))?;
    let rec_model = resolve_required_asset(model_dirs, spec.rec_exact, spec.rec_prefix)
        .ok_or_else(|| format!("OCR recognition model missing for profile {}", spec.id))?;
    let charset = resolve_required_asset(model_dirs, spec.charset_exact, spec.charset_prefix)
        .ok_or_else(|| format!("OCR charset file missing for profile {}", spec.id))?;

    let config = OcrEngineConfig::fast().with_min_result_confidence(0.45);
    OcrEngine::new(det_model, rec_model, charset, Some(config))
        .map_err(|e| format!("Failed to initialize OCR engine: {}", e))
}

fn collect_model_sources(app: &AppHandle) -> Vec<(PathBuf, String)> {
    let mut candidates = Vec::new();

    if let Ok(app_data_dir) = app.path().app_data_dir() {
        candidates.push((app_data_dir.join("models"), "user data models".to_string()));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push((resource_dir.join("models"), "bundled resource".to_string()));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push((current_dir.join("models"), "runtime models".to_string()));
        candidates.push((
            current_dir.join("apps/desktop/src-tauri/models"),
            "workspace models".to_string(),
        ));
    }

    candidates.push((
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models"),
        "manifest models".to_string(),
    ));

    let mut seen = Vec::<PathBuf>::new();
    candidates
        .into_iter()
        .filter(|(path, _)| {
            let canonical = path.canonicalize().unwrap_or_else(|_| path.clone());
            if seen.iter().any(|item| item == &canonical) {
                return false;
            }
            seen.push(canonical);
            path.is_dir()
        })
        .collect()
}

fn preferred_models_dir_with_source(app: &AppHandle) -> Result<(PathBuf, String), String> {
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let dir = app_data_dir.join("models");
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Failed to create OCR models directory: {}", error))?;
        return Ok((dir, "user data models".to_string()));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        let dir = current_dir.join("models");
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Failed to create OCR models directory: {}", error))?;
        return Ok((dir, "runtime models".to_string()));
    }

    Err("Unable to create OCR models directory".to_string())
}

fn download_missing_asset(
    app: &AppHandle,
    target_dir: &Path,
    model_dirs: &[PathBuf],
    exact: &[&str],
    prefix: &[&str],
    downloads: &[&str],
) -> Result<(), String> {
    if resolve_required_asset(model_dirs, exact, prefix).is_some() {
        return Ok(());
    }

    let mut errors = Vec::new();
    for file_name in downloads {
        match download_model_file(app, target_dir, file_name) {
            Ok(()) => return Ok(()),
            Err(error) => errors.push(format!("{file_name}: {error}")),
        }
    }

    Err(format!(
        "Failed to download required OCR asset ({}): {}",
        asset_label(exact, prefix),
        errors.join("; ")
    ))
}

fn download_model_file(app: &AppHandle, target_dir: &Path, file_name: &str) -> Result<(), String> {
    let client = Client::builder()
        .build()
        .map_err(|error| format!("Failed to create download client: {}", error))?;

    let target_path = target_dir.join(file_name);
    if target_path.exists() {
        return Ok(());
    }

    let temp_path = target_dir.join(format!("{file_name}.download"));
    let mut last_error = None;

    for base_url in MODEL_BASE_URLS {
        let url = format!("{base_url}/{file_name}");
        match client.get(&url).send() {
            Ok(mut response) => {
                if !response.status().is_success() {
                    last_error = Some(format!("HTTP {}", response.status()));
                    continue;
                }

                let total = response.content_length();
                let mut file = fs::File::create(&temp_path)
                    .map_err(|error| format!("Failed to create temp model file: {}", error))?;

                let mut downloaded: u64 = 0;
                let mut buf = [0u8; 65536];
                loop {
                    let n = response
                        .read(&mut buf)
                        .map_err(|error| format!("Failed to read model file: {}", error))?;
                    if n == 0 {
                        break;
                    }
                    file.write_all(&buf[..n])
                        .map_err(|error| format!("Failed to write model file: {}", error))?;
                    downloaded += n as u64;
                    let _ = app.emit(
                        "ocr-model://download-progress",
                        OcrDownloadProgress {
                            file_name: file_name.to_string(),
                            downloaded,
                            total,
                            done: false,
                        },
                    );
                }

                file.flush()
                    .map_err(|error| format!("Failed to flush model file: {}", error))?;
                fs::rename(&temp_path, &target_path).map_err(|error| {
                    format!(
                        "Failed to finalize downloaded model {}: {}",
                        target_path.display(),
                        error
                    )
                })?;
                let _ = app.emit(
                    "ocr-model://download-progress",
                    OcrDownloadProgress {
                        file_name: file_name.to_string(),
                        downloaded,
                        total: Some(downloaded),
                        done: true,
                    },
                );
                return Ok(());
            }
            Err(error) => {
                last_error = Some(error.to_string());
            }
        }
    }

    let _ = fs::remove_file(&temp_path);
    Err(last_error.unwrap_or_else(|| "unknown download error".to_string()))
}

pub fn get_model_info(app: &AppHandle, profile: &str) -> OcrModelInfo {
    let spec = resolve_profile(profile);
    let engine_cached = OCR_ENGINE
        .lock()
        .map(|lock| {
            lock.as_ref()
                .map(|c| c.profile_id == spec.id)
                .unwrap_or(false)
        })
        .unwrap_or(false);

    let model_dirs: Vec<PathBuf> = collect_model_sources(app)
        .into_iter()
        .map(|(path, _)| path)
        .collect();

    match preferred_models_dir_with_source(app) {
        Ok((dir, source_label)) => {
            let assets = build_assets(&model_dirs, spec);
            let ready = assets.iter().all(|asset| asset.exists);
            OcrModelInfo {
                ready,
                engine_cached,
                selected_profile: spec.id.to_string(),
                models_dir: Some(dir.display().to_string()),
                source_label: Some(source_label),
                assets,
                error: None,
            }
        }
        Err(error) => OcrModelInfo {
            ready: false,
            engine_cached,
            selected_profile: spec.id.to_string(),
            models_dir: None,
            source_label: None,
            assets: build_missing_assets(spec),
            error: Some(error),
        },
    }
}

pub fn ensure_model_profile(app: &AppHandle, profile: &str) -> Result<OcrModelInfo, String> {
    let spec = resolve_profile(profile);
    let (target_dir, _) = preferred_models_dir_with_source(app)?;
    let source_dirs = collect_model_sources(app);
    let model_dirs: Vec<PathBuf> = source_dirs.iter().map(|(path, _)| path.clone()).collect();

    download_missing_asset(
        app,
        &target_dir,
        &model_dirs,
        spec.det_exact,
        spec.det_prefix,
        spec.download_det,
    )?;
    download_missing_asset(
        app,
        &target_dir,
        &model_dirs,
        spec.rec_exact,
        spec.rec_prefix,
        spec.download_rec,
    )?;
    download_missing_asset(
        app,
        &target_dir,
        &model_dirs,
        spec.charset_exact,
        spec.charset_prefix,
        spec.download_charset,
    )?;

    Ok(get_model_info(app, profile))
}

pub fn reset_engine() -> Result<(), String> {
    let mut engine_lock = OCR_ENGINE
        .lock()
        .map_err(|_| "OCR engine lock poisoned".to_string())?;
    *engine_lock = None;
    Ok(())
}

fn build_assets(model_dirs: &[PathBuf], spec: &ModelProfileSpec) -> Vec<OcrModelAssetInfo> {
    let det = build_asset_info(model_dirs, "检测模型", spec.det_exact, spec.det_prefix);
    let rec = build_asset_info(model_dirs, "识别模型", spec.rec_exact, spec.rec_prefix);
    let charset = build_asset_info(
        model_dirs,
        "字符集",
        spec.charset_exact,
        spec.charset_prefix,
    );
    vec![det, rec, charset]
}

fn build_missing_assets(spec: &ModelProfileSpec) -> Vec<OcrModelAssetInfo> {
    vec![
        OcrModelAssetInfo {
            name: "检测模型".to_string(),
            path: asset_label(spec.det_exact, spec.det_prefix),
            exists: false,
            size_bytes: None,
        },
        OcrModelAssetInfo {
            name: "识别模型".to_string(),
            path: asset_label(spec.rec_exact, spec.rec_prefix),
            exists: false,
            size_bytes: None,
        },
        OcrModelAssetInfo {
            name: "字符集".to_string(),
            path: asset_label(spec.charset_exact, spec.charset_prefix),
            exists: false,
            size_bytes: None,
        },
    ]
}

fn build_asset_info(
    model_dirs: &[PathBuf],
    label: &str,
    exact: &[&str],
    prefix: &[&str],
) -> OcrModelAssetInfo {
    if let Some(path) = resolve_required_asset(model_dirs, exact, prefix) {
        let metadata = fs::metadata(&path).ok();
        OcrModelAssetInfo {
            name: label.to_string(),
            path: path.display().to_string(),
            exists: true,
            size_bytes: metadata.map(|m| m.len()),
        }
    } else {
        OcrModelAssetInfo {
            name: label.to_string(),
            path: asset_label(exact, prefix),
            exists: false,
            size_bytes: None,
        }
    }
}

fn resolve_required_asset(
    model_dirs: &[PathBuf],
    exact: &[&str],
    prefix: &[&str],
) -> Option<PathBuf> {
    for models_dir in model_dirs {
        for name in exact {
            let path = models_dir.join(name);
            if path.exists() {
                return Some(path);
            }
        }
    }

    if prefix.is_empty() {
        return None;
    }

    for models_dir in model_dirs {
        let Ok(entries) = fs::read_dir(models_dir) else {
            continue;
        };
        let mut names: Vec<String> = entries
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect();
        names.sort();

        for file_name in names {
            if prefix.iter().any(|prefix| file_name.starts_with(prefix)) {
                return Some(models_dir.join(file_name));
            }
        }
    }

    None
}

fn asset_label(exact: &[&str], prefix: &[&str]) -> String {
    if !exact.is_empty() {
        return exact.join(" 或 ");
    }
    if !prefix.is_empty() {
        return prefix
            .iter()
            .map(|item| format!("{item}*"))
            .collect::<Vec<_>>()
            .join(" 或 ");
    }
    "-".to_string()
}

fn resolve_profile(profile: &str) -> &'static ModelProfileSpec {
    MODEL_PROFILES
        .iter()
        .copied()
        .find(|spec| spec.id == profile)
        .unwrap_or(&PROFILE_V6_SMALL)
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
            image_width: 0,
            image_height: 0,
            error: Some(error),
        }
    }
}
