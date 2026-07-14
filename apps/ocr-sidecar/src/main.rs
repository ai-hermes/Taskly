//! Standalone local OCR sidecar for the Taskly CLI.
//!
//! Reuses the same `ocr-rs` engine as the Taskly desktop app. Reads an image
//! path and prints JSON `{ "success", "text", "details": [{text, confidence,
//! box}] }` to stdout — the shape the CLI (`taskly extract --image`) expects.
//!
//! Usage:
//!   taskly-ocr <image> [--profile <id>] [--models-dir <dir>]
//!
//! Model files are resolved from (in order): `--models-dir`, the
//! `TASKLY_OCR_MODELS` env var, `./models`, and the workspace desktop models
//! dir. The default profile is `ppocrv6_small` (matches the bundled models).

use std::env;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use ocr_rs::{OcrEngine, OcrEngineConfig};
use serde::Serialize;

struct ProfileSpec {
    id: &'static str,
    det: &'static [&'static str],
    rec: &'static [&'static str],
    charset: &'static [&'static str],
}

const PROFILES: &[ProfileSpec] = &[
    ProfileSpec {
        id: "ppocrv6_small",
        det: &["PP-OCRv6_small_det.mnn"],
        rec: &["PP-OCRv6_small_rec.mnn"],
        charset: &["ppocr_keys_v6_small.txt"],
    },
    ProfileSpec {
        id: "ppocrv6_tiny",
        det: &["PP-OCRv6_tiny_det.mnn"],
        rec: &["PP-OCRv6_tiny_rec.mnn"],
        charset: &["ppocr_keys_v6_tiny.txt"],
    },
    ProfileSpec {
        id: "ppocrv6_medium",
        det: &["PP-OCRv6_medium_det.mnn"],
        rec: &["PP-OCRv6_medium_rec.mnn"],
        charset: &["ppocr_keys_v6_medium.txt"],
    },
    ProfileSpec {
        id: "ppocrv4",
        det: &["ch_PP-OCRv4_det_infer.mnn"],
        rec: &["ch_PP-OCRv4_rec_infer.mnn"],
        charset: &["ppocr_keys_v4.txt", "ppocr_keys.txt"],
    },
];

const DEFAULT_PROFILE: &str = "ppocrv6_small";

#[derive(Serialize)]
struct OcrText {
    text: String,
    confidence: f32,
    #[serde(rename = "box")]
    box_: Vec<Vec<f32>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrResponse {
    success: bool,
    text: String,
    details: Vec<OcrText>,
    image_width: u32,
    image_height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn find_profile(id: &str) -> Option<&'static ProfileSpec> {
    PROFILES.iter().find(|p| p.id == id)
}

/// Candidate model directories, most-specific first.
fn model_dirs(explicit: Option<&str>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(d) = explicit {
        dirs.push(PathBuf::from(d));
    }
    if let Ok(d) = env::var("TASKLY_OCR_MODELS") {
        if !d.trim().is_empty() {
            dirs.push(PathBuf::from(d));
        }
    }
    if let Ok(cwd) = env::current_dir() {
        dirs.push(cwd.join("models"));
        dirs.push(cwd.join("apps/desktop/src-tauri/models"));
    }
    // Relative to this crate: apps/ocr-sidecar -> apps/desktop/src-tauri/models
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    dirs.push(manifest.join("../desktop/src-tauri/models"));
    dirs
}

fn resolve_asset(dirs: &[PathBuf], names: &[&str]) -> Option<PathBuf> {
    for dir in dirs {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn box_points(text_box: &ocr_rs::TextBox) -> Vec<Vec<f32>> {
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

fn run() -> Result<OcrResponse, String> {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut image_path: Option<String> = None;
    let mut profile = DEFAULT_PROFILE.to_string();
    let mut models_dir: Option<String> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--profile" => {
                i += 1;
                profile = args.get(i).cloned().ok_or("--profile requires a value")?;
            }
            "--models-dir" => {
                i += 1;
                models_dir = Some(args.get(i).cloned().ok_or("--models-dir requires a value")?);
            }
            "-h" | "--help" => {
                return Err("usage: taskly-ocr <image> [--profile <id>] [--models-dir <dir>]".into());
            }
            other => {
                if image_path.is_none() {
                    image_path = Some(other.to_string());
                } else {
                    return Err(format!("unexpected argument: {other}"));
                }
            }
        }
        i += 1;
    }

    let image_path = image_path.ok_or("missing image path")?;
    if !Path::new(&image_path).is_file() {
        return Err(format!("image not found: {image_path}"));
    }

    let spec = find_profile(&profile)
        .ok_or_else(|| format!("unknown profile '{profile}'"))?;

    let dirs = model_dirs(models_dir.as_deref());
    let det = resolve_asset(&dirs, spec.det)
        .ok_or_else(|| format!("detection model missing for profile {}", spec.id))?;
    let rec = resolve_asset(&dirs, spec.rec)
        .ok_or_else(|| format!("recognition model missing for profile {}", spec.id))?;
    let charset = resolve_asset(&dirs, spec.charset)
        .ok_or_else(|| format!("charset file missing for profile {}", spec.id))?;

    let image = image::open(&image_path).map_err(|e| format!("failed to open image: {e}"))?;

    let config = OcrEngineConfig::fast().with_min_result_confidence(0.45);
    let engine = OcrEngine::new(det, rec, charset, Some(config))
        .map_err(|e| format!("failed to initialize OCR engine: {e}"))?;

    let results = engine
        .recognize(&image)
        .map_err(|e| format!("recognition failed: {e}"))?;

    let details: Vec<OcrText> = results
        .into_iter()
        .map(|item| OcrText {
            text: item.text,
            confidence: item.confidence,
            box_: box_points(&item.bbox),
        })
        .collect();

    let text = details
        .iter()
        .map(|d| d.text.as_str())
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

fn main() -> ExitCode {
    match run() {
        Ok(resp) => {
            println!("{}", serde_json::to_string(&resp).unwrap());
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("taskly-ocr: {err}");
            ExitCode::FAILURE
        }
    }
}
