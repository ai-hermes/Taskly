//! Per-todo workspace management and pi-coding-agent execution.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};
use tokio::sync::Mutex as AsyncMutex;

const LOG_EVENT: &str = "todo-exec://log";
const PHASE_EVENT: &str = "todo-exec://phase";
const AGENT_EVENT: &str = "todo-exec://agent-event";
const UI_REQUEST_EVENT: &str = "todo-exec://ui-request";
const TAIL_LIMIT: usize = 4000;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PreparedWorkspace {
    pub workspace_id: String,
    pub workspace_path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAsset {
    pub id: String,
    pub name: String,
    pub source_path: String,
    pub copied_path: String,
    pub size_bytes: u64,
    pub mime_type: String,
    pub added_at: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub command: String,
    pub exit_code: i32,
    pub ok: bool,
    pub stdout_tail: String,
    pub stderr_tail: String,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentLlmConfig {
    /// Provider id understood by pi (currently only "openai").
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteTodoRequest {
    pub run_id: String,
    pub todo_id: String,
    pub workspace_path: String,
    pub workdir: String,
    pub prompt: String,
    /// Custom agent command; None/empty means use the bundled sidecar.
    pub agent_command: Option<String>,
    pub timeout_sec: u64,
    #[serde(default = "default_permission_mode")]
    pub permission_mode: String,
    pub validation_commands: Vec<String>,
    /// Model/API config reused from Taskly settings for the bundled agent.
    #[serde(default)]
    pub llm: Option<AgentLlmConfig>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteTodoResult {
    pub run_id: String,
    pub agent_ok: bool,
    pub agent_exit_code: Option<i32>,
    pub validation_results: Vec<ValidationResult>,
    pub summary: String,
    pub log_tail: String,
    pub log_file_path: String,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogEvent<'a> {
    run_id: &'a str,
    todo_id: &'a str,
    stream: &'a str,
    line: &'a str,
    ts: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PhaseEvent<'a> {
    run_id: &'a str,
    todo_id: &'a str,
    phase: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<&'a str>,
    ts: u64,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn now_iso() -> String {
    // RFC3339-ish without pulling in chrono: rely on SystemTime seconds.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("@{}", secs)
}

fn tail(s: &str, limit: usize) -> String {
    if s.len() <= limit {
        return s.to_string();
    }
    let start = s.len() - limit;
    // Snap to a char boundary.
    let mut idx = start;
    while !s.is_char_boundary(idx) {
        idx += 1;
    }
    s[idx..].to_string()
}

fn guess_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "txt" | "md" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

/// Resolve the base directory that holds all todo workspaces.
/// Default (no override): `~/.taskly/workspace`.
fn workspaces_base(app: &tauri::AppHandle, base_dir: Option<&str>) -> Result<PathBuf, String> {
    if let Some(dir) = base_dir {
        if !dir.trim().is_empty() {
            return Ok(PathBuf::from(dir).join("workspace"));
        }
    }
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("Cannot resolve home dir: {}", e))?;
    Ok(home.join(".taskly").join("workspace"))
}

/// Stable short hex hash of the task name (FNV-1a, 64-bit).
fn hash_name(name: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in name.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

fn workspace_dir(
    app: &tauri::AppHandle,
    base_dir: Option<&str>,
    todo_title: &str,
) -> Result<PathBuf, String> {
    Ok(workspaces_base(app, base_dir)?.join(hash_name(todo_title)))
}

/// Resolved agent invocation: program, fixed args, and extra env vars.
struct AgentInvocation {
    program: String,
    args: Vec<String>,
    envs: Vec<(String, String)>,
}

/// Locate the pi-package dir (holds package.json + assets) among known layouts.
fn find_pi_package_dir(exe_dir: &Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = vec![
        exe_dir.join("pi-package"),
        exe_dir.join("binaries").join("pi-package"),
    ];
    if let Some(parent) = exe_dir.parent() {
        // macOS .app: MacOS/ -> ../Resources/...
        candidates.push(parent.join("Resources").join("pi-package"));
        candidates.push(parent.join("Resources").join("binaries").join("pi-package"));
        candidates.push(
            parent
                .join("Resources")
                .join("_up_")
                .join("binaries")
                .join("pi-package"),
        );
    }
    // Dev: src-tauri/binaries/pi-package.
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join("pi-package"),
    );
    candidates
        .into_iter()
        .find(|p| p.join("package.json").exists())
}

/// Default permission posture when a request omits it.
fn default_permission_mode() -> String {
    "ask".to_string()
}

/// Clamp a permission mode string to a known value.
fn normalize_permission_mode(mode: &str) -> String {
    match mode.trim().to_lowercase().as_str() {
        "explore" => "explore".to_string(),
        "auto" => "auto".to_string(),
        _ => "ask".to_string(),
    }
}

/// Locate the bundled Taskly permission-gate extension (ships inside pi-package).
fn find_permission_gate_ext() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?.to_path_buf();
    let pkg = find_pi_package_dir(&exe_dir)?;
    let p = pkg
        .join("taskly-extensions")
        .join("permission-gate.ts");
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// Build the extra CLI args (`-e <ext>`) and env vars that activate the
/// permission gate for a run in the given mode.
fn permission_gate_wiring(mode: &str) -> (Vec<String>, Vec<(String, String)>) {
    let mode = normalize_permission_mode(mode);
    let mut args = Vec::new();
    if let Some(ext) = find_permission_gate_ext() {
        args.push("-e".to_string());
        args.push(ext.to_string_lossy().to_string());
    }
    let envs = vec![("TASKLY_PERMISSION_MODE".to_string(), mode)];
    (args, envs)
}

/// Resolve the agent executable: custom command wins, else bundled sidecar.
fn resolve_agent_command(custom: Option<&str>) -> Result<AgentInvocation, String> {
    if let Some(cmd) = custom {
        let cmd = cmd.trim();
        if !cmd.is_empty() {
            let mut parts = cmd.split_whitespace().map(String::from);
            let program = parts.next().ok_or("Empty agent command")?;
            return Ok(AgentInvocation {
                program,
                args: parts.collect(),
                envs: vec![],
            });
        }
    }
    // Bundled sidecar lives next to the app executable in production, or in
    // src-tauri/binaries during development. The compiled pi binary resolves
    // its package.json via PI_PACKAGE_DIR.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe
        .parent()
        .ok_or("Cannot resolve executable directory")?
        .to_path_buf();
    let name = "pi-coding-agent";
    let candidates = [exe_dir.join(name), exe_dir.join(format!("{}.exe", name))];
    let pkg_env = |exe_dir: &Path| {
        find_pi_package_dir(exe_dir)
            .map(|d| vec![("PI_PACKAGE_DIR".into(), d.to_string_lossy().to_string())])
            .unwrap_or_default()
    };
    for c in &candidates {
        if c.exists() {
            return Ok(AgentInvocation {
                program: c.to_string_lossy().to_string(),
                args: vec![],
                envs: pkg_env(&exe_dir),
            });
        }
    }
    // Dev fallback: binaries dir with host triple suffix.
    let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if dev_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&dev_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.starts_with("pi-coding-agent-") && entry.path().is_file() {
                    return Ok(AgentInvocation {
                        program: entry.path().to_string_lossy().to_string(),
                        args: vec![],
                        envs: pkg_env(&dev_dir),
                    });
                }
            }
        }
    }
    Err("未找到内置 pi-coding-agent，可在设置中指定自定义命令".into())
}

/// Env var mapping the API key for each supported provider.
fn provider_api_key_env(provider: &str) -> &'static str {
    match provider {
        "anthropic" => "ANTHROPIC_API_KEY",
        "deepseek" => "DEEPSEEK_API_KEY",
        "google" => "GEMINI_API_KEY",
        _ => "OPENAI_API_KEY",
    }
}

/// Request dialect pi should use for the provider's endpoint. Defaults to the
/// widely-compatible OpenAI Completions API (`/chat/completions`), which most
/// self-hosted / proxy OpenAI-compatible endpoints implement (unlike the newer
/// Responses API that built-in models default to and that returns 404 there).
fn provider_api_dialect(provider: &str) -> &'static str {
    match provider {
        "anthropic" => "anthropic-messages",
        "google" => "google-generative-ai",
        _ => "openai-completions",
    }
}

/// Configure the bundled pi agent to use Taskly's model settings by writing a
/// dedicated `models.json` (provider baseUrl + apiKey + model) into a private
/// agent dir, and returning the extra CLI args + env vars to point pi at it.
fn setup_llm_env(
    app: &tauri::AppHandle,
    llm: &AgentLlmConfig,
) -> Result<(Vec<String>, Vec<(String, String)>), String> {
    let provider = if llm.provider.trim().is_empty() {
        "openai"
    } else {
        llm.provider.trim()
    };
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("无法定位用户目录: {}", e))?;
    let agent_dir = home.join(".taskly").join("pi-agent");
    std::fs::create_dir_all(&agent_dir).map_err(|e| format!("创建 agent 目录失败: {}", e))?;

    let mut provider_cfg = serde_json::Map::new();
    if !llm.base_url.trim().is_empty() {
        provider_cfg.insert("baseUrl".into(), serde_json::json!(llm.base_url.trim()));
    }
    if !llm.api_key.trim().is_empty() {
        provider_cfg.insert("apiKey".into(), serde_json::json!(llm.api_key.trim()));
    }
    // Force the compatible request dialect so custom/proxy endpoints resolve.
    let dialect = provider_api_dialect(provider);
    provider_cfg.insert("api".into(), serde_json::json!(dialect));
    // Register the chosen model id so any custom/proxy model name resolves.
    provider_cfg.insert(
        "models".into(),
        serde_json::json!([{ "id": llm.model.trim(), "api": dialect }]),
    );
    let models_json = serde_json::json!({
        "providers": { provider: serde_json::Value::Object(provider_cfg) }
    });
    let models_path = agent_dir.join("models.json");
    std::fs::write(
        &models_path,
        serde_json::to_string_pretty(&models_json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("写入 models.json 失败: {}", e))?;

    let args = vec![
        "--provider".to_string(),
        provider.to_string(),
        "--model".to_string(),
        llm.model.trim().to_string(),
    ];
    let mut envs = vec![(
        "PI_CODING_AGENT_DIR".to_string(),
        agent_dir.to_string_lossy().to_string(),
    )];
    if !llm.api_key.trim().is_empty() {
        envs.push((
            provider_api_key_env(provider).to_string(),
            llm.api_key.trim().to_string(),
        ));
    }
    Ok((args, envs))
}

struct RunLogger {
    file: std::fs::File,
    path: PathBuf,
    tail_buf: String,
}

impl RunLogger {
    fn new(workspace_path: &Path, run_id: &str) -> Result<Self, String> {
        let logs_dir = workspace_path.join("logs");
        std::fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
        let path = logs_dir.join(format!("{}.log", run_id));
        let file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
        Ok(Self {
            file,
            path,
            tail_buf: String::new(),
        })
    }

    fn write(&mut self, stream: &str, line: &str) {
        let entry = format!("[{}][{}] {}\n", now_millis(), stream, line);
        let _ = self.file.write_all(entry.as_bytes());
        self.tail_buf.push_str(&entry);
        if self.tail_buf.len() > TAIL_LIMIT * 2 {
            self.tail_buf = tail(&self.tail_buf, TAIL_LIMIT);
        }
    }

    fn tail(&self) -> String {
        tail(&self.tail_buf, TAIL_LIMIT)
    }
}

fn emit_log(app: &tauri::AppHandle, run_id: &str, todo_id: &str, stream: &str, line: &str) {
    let _ = app.emit(
        LOG_EVENT,
        LogEvent {
            run_id,
            todo_id,
            stream,
            line,
            ts: now_millis(),
        },
    );
}

fn emit_phase(app: &tauri::AppHandle, run_id: &str, todo_id: &str, phase: &str, detail: Option<&str>) {
    let _ = app.emit(
        PHASE_EVENT,
        PhaseEvent {
            run_id,
            todo_id,
            phase,
            detail,
            ts: now_millis(),
        },
    );
}

#[tauri::command]
pub async fn prepare_todo_workspace(
    app: tauri::AppHandle,
    todo_id: String,
    todo_title: String,
    base_dir: Option<String>,
) -> Result<PreparedWorkspace, String> {
    let _ = todo_id;
    let dir = workspace_dir(&app, base_dir.as_deref(), &todo_title)?;
    std::fs::create_dir_all(dir.join("assets")).map_err(|e| format!("创建工作区失败: {}", e))?;
    std::fs::create_dir_all(dir.join("logs")).map_err(|e| format!("创建工作区失败: {}", e))?;
    Ok(PreparedWorkspace {
        workspace_id: format!("ws-{}", hash_name(&todo_title)),
        workspace_path: dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn copy_assets_to_workspace(
    app: tauri::AppHandle,
    todo_id: String,
    todo_title: String,
    base_dir: Option<String>,
    source_paths: Vec<String>,
) -> Result<Vec<WorkspaceAsset>, String> {
    let _ = todo_id;
    let assets_dir = workspace_dir(&app, base_dir.as_deref(), &todo_title)?.join("assets");
    std::fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;

    let mut assets = Vec::new();
    for src in source_paths {
        let src_path = PathBuf::from(&src);
        let name = src_path
            .file_name()
            .ok_or_else(|| format!("非法文件路径: {}", src))?
            .to_string_lossy()
            .to_string();
        let mut dest = assets_dir.join(&name);
        // Avoid overwriting an existing distinct file with the same name.
        if dest.exists() {
            let stem = src_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".into());
            let ext = src_path
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();
            dest = assets_dir.join(format!("{}-{}{}", stem, now_millis(), ext));
        }
        std::fs::copy(&src_path, &dest).map_err(|e| format!("复制 {} 失败: {}", src, e))?;
        let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        assets.push(WorkspaceAsset {
            id: format!("asset-{}-{}", now_millis(), assets.len()),
            name,
            source_path: src,
            copied_path: dest.to_string_lossy().to_string(),
            size_bytes: size,
            mime_type: guess_mime(&dest).to_string(),
            added_at: now_iso(),
        });
    }
    Ok(assets)
}

const SAFE_MODE_PREAMBLE: &str = "\
【安全模式约束】\n\
- 禁止执行 git push、部署、发布等任何对外发布动作。\n\
- 只允许在当前工作目录内修改文件。\n\
- 不要执行破坏性命令（如 rm -rf 非工作区路径）。\n\n";

/// Run the agent process, streaming output as events and into the log file.
async fn run_agent(
    app: &tauri::AppHandle,
    logger: &mut RunLogger,
    run_id: &str,
    todo_id: &str,
    workdir: &str,
    prompt: &str,
    agent_command: Option<&str>,
    timeout_sec: u64,
    permission_mode: &str,
    llm: Option<&AgentLlmConfig>,
) -> Result<Option<i32>, String> {
    let uses_custom = agent_command
        .map(|c| !c.trim().is_empty())
        .unwrap_or(false);
    let AgentInvocation {
        program,
        mut args,
        mut envs,
    } = resolve_agent_command(agent_command)?;
    // For the bundled sidecar, reuse Taskly's model settings (provider/model/
    // apiKey/baseUrl) so the user configures credentials once in Settings.
    if !uses_custom {
        if let Some(llm) = llm {
            if !llm.model.trim().is_empty() {
                let (mut llm_args, llm_envs) = setup_llm_env(app, llm)?;
                args.append(&mut llm_args);
                envs.extend(llm_envs);
            }
        }
    }
    // Activate the permission gate (Explore / Ask / Auto) for the bundled agent.
    if !uses_custom {
        let (mut gate_args, gate_envs) = permission_gate_wiring(permission_mode);
        args.append(&mut gate_args);
        envs.extend(gate_envs);
    }
    // Always prepend the safety guardrail preamble for the bundled agent.
    let full_prompt = format!("{}{}", SAFE_MODE_PREAMBLE, prompt);
    // Non-interactive mode: process the prompt and exit.
    args.push("-p".into());
    args.push(full_prompt);

    let line = format!("$ {} -p <prompt> (cwd: {})", program, workdir);
    logger.write("system", &line);
    emit_log(app, run_id, todo_id, "system", &line);

    let mut child = Command::new(&program)
        .args(&args)
        .envs(envs)
        .current_dir(workdir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("启动 agent 失败 ({}): {}", program, e))?;

    let stdout = child.stdout.take().ok_or("无法读取 agent stdout")?;
    let stderr = child.stderr.take().ok_or("无法读取 agent stderr")?;

    let mut out_lines = BufReader::new(stdout).lines();
    let mut err_lines = BufReader::new(stderr).lines();
    let deadline = Instant::now() + Duration::from_secs(timeout_sec.max(1));

    let mut out_done = false;
    let mut err_done = false;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            let _ = child.kill().await;
            let msg = format!("agent 执行超时（{}s），已终止", timeout_sec);
            logger.write("system", &msg);
            emit_log(app, run_id, todo_id, "system", &msg);
            return Err(msg);
        }
        tokio::select! {
            line = out_lines.next_line(), if !out_done => {
                match line.map_err(|e| e.to_string())? {
                    Some(l) => {
                        logger.write("stdout", &l);
                        emit_log(app, run_id, todo_id, "stdout", &l);
                    }
                    None => out_done = true,
                }
            }
            line = err_lines.next_line(), if !err_done => {
                match line.map_err(|e| e.to_string())? {
                    Some(l) => {
                        logger.write("stderr", &l);
                        emit_log(app, run_id, todo_id, "stderr", &l);
                    }
                    None => err_done = true,
                }
            }
            _ = tokio::time::sleep(remaining), if out_done && err_done => {}
        }
        if out_done && err_done {
            break;
        }
    }

    let remaining = deadline.saturating_duration_since(Instant::now());
    let status = tokio::time::timeout(remaining.max(Duration::from_secs(1)), child.wait())
        .await
        .map_err(|_| {
            let msg = format!("agent 执行超时（{}s）", timeout_sec);
            msg
        })?
        .map_err(|e| e.to_string())?;

    let code = status.code();
    let msg = format!("agent 退出码: {:?}", code);
    logger.write("system", &msg);
    emit_log(app, run_id, todo_id, "system", &msg);
    Ok(code)
}

/// Run validation commands sequentially; short-circuit on first failure.
async fn run_validations(
    app: &tauri::AppHandle,
    logger: &mut RunLogger,
    run_id: &str,
    todo_id: &str,
    workdir: &str,
    commands: &[String],
) -> Vec<ValidationResult> {
    let mut results = Vec::new();
    for cmd in commands {
        emit_phase(app, run_id, todo_id, "validating", Some(cmd));
        let line = format!("$ {}", cmd);
        logger.write("system", &line);
        emit_log(app, run_id, todo_id, "system", &line);

        let start = Instant::now();
        let output = Command::new("sh")
            .arg("-lc")
            .arg(cmd)
            .current_dir(workdir)
            .stdin(Stdio::null())
            .output()
            .await;
        let duration_ms = start.elapsed().as_millis() as u64;

        let result = match output {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let stderr = String::from_utf8_lossy(&out.stderr);
                for l in stdout.lines() {
                    logger.write("stdout", l);
                    emit_log(app, run_id, todo_id, "stdout", l);
                }
                for l in stderr.lines() {
                    logger.write("stderr", l);
                    emit_log(app, run_id, todo_id, "stderr", l);
                }
                let code = out.status.code().unwrap_or(-1);
                ValidationResult {
                    command: cmd.clone(),
                    exit_code: code,
                    ok: out.status.success(),
                    stdout_tail: tail(&stdout, 1000),
                    stderr_tail: tail(&stderr, 1000),
                    duration_ms,
                }
            }
            Err(e) => {
                let msg = format!("校验命令启动失败: {}", e);
                logger.write("system", &msg);
                emit_log(app, run_id, todo_id, "system", &msg);
                ValidationResult {
                    command: cmd.clone(),
                    exit_code: -1,
                    ok: false,
                    stdout_tail: String::new(),
                    stderr_tail: msg,
                    duration_ms,
                }
            }
        };
        let ok = result.ok;
        results.push(result);
        if !ok {
            break;
        }
    }
    results
}

#[tauri::command]
pub async fn execute_todo_once(
    app: tauri::AppHandle,
    req: ExecuteTodoRequest,
) -> Result<ExecuteTodoResult, String> {
    // Safe-mode preconditions.
    if req.workdir.trim().is_empty() {
        return Err("未设置工作目录".into());
    }
    if !Path::new(&req.workdir).is_dir() {
        return Err(format!("工作目录不存在: {}", req.workdir));
    }
    // Bundled agent needs credentials; reuse Taskly's model settings.
    let uses_custom = req
        .agent_command
        .as_deref()
        .map(|c| !c.trim().is_empty())
        .unwrap_or(false);
    if !uses_custom {
        let has_key = req
            .llm
            .as_ref()
            .map(|l| !l.api_key.trim().is_empty() && !l.model.trim().is_empty())
            .unwrap_or(false);
        if !has_key {
            return Err("未配置模型 API Key，请在「设置」中填写 OpenAI 的 API Key 与模型后重试。".into());
        }
    }

    let workspace_path = PathBuf::from(&req.workspace_path);
    let mut logger = RunLogger::new(&workspace_path, &req.run_id)?;

    emit_phase(&app, &req.run_id, &req.todo_id, "preparing", None);
    logger.write("system", &format!("run {} start (todo {})", req.run_id, req.todo_id));

    emit_phase(&app, &req.run_id, &req.todo_id, "agent_running", None);
    let agent_result = run_agent(
        &app,
        &mut logger,
        &req.run_id,
        &req.todo_id,
        &req.workdir,
        &req.prompt,
        req.agent_command.as_deref(),
        req.timeout_sec,
        &req.permission_mode,
        req.llm.as_ref(),
    )
    .await;

    let (agent_exit_code, agent_ok, mut error) = match agent_result {
        Ok(code) => (code, code == Some(0), None),
        Err(e) => (None, false, Some(e)),
    };

    let validation_results = if agent_ok {
        let commands = sanitize_validation_commands(&req.validation_commands);
        run_validations(
            &app,
            &mut logger,
            &req.run_id,
            &req.todo_id,
            &req.workdir,
            &commands,
        )
        .await
    } else {
        if error.is_none() {
            error = Some(format!("agent 执行失败，退出码 {:?}", agent_exit_code));
        }
        Vec::new()
    };

    // With no validation commands, success == agent exited 0.
    let all_validations_ok = validation_results.iter().all(|v| v.ok);
    let succeeded = agent_ok && all_validations_ok;
    if agent_ok && !all_validations_ok && error.is_none() {
        let failed = validation_results
            .iter()
            .find(|v| !v.ok)
            .map(|v| v.command.clone())
            .unwrap_or_else(|| "（无校验结果）".into());
        error = Some(format!("校验失败: {}", failed));
    }

    let summary = if succeeded {
        if validation_results.is_empty() {
            "agent 执行成功（未配置校验命令）".into()
        } else {
            format!("agent 执行成功，{} 条校验全部通过", validation_results.len())
        }
    } else {
        error.clone().unwrap_or_else(|| "执行失败".into())
    };
    logger.write("system", &summary);
    emit_phase(
        &app,
        &req.run_id,
        &req.todo_id,
        if succeeded { "done" } else { "failed" },
        Some(&summary),
    );

    Ok(ExecuteTodoResult {
        run_id: req.run_id,
        agent_ok,
        agent_exit_code,
        validation_results,
        summary,
        log_tail: logger.tail(),
        log_file_path: logger.path.to_string_lossy().to_string(),
        error: if succeeded { None } else { error },
    })
}

// ============================================================================
// Interactive (human-in-the-loop) agent sessions via pi `--mode rpc`.
// ============================================================================

/// Payload forwarded to the frontend for every raw RPC stdout event.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentEventPayload {
    run_id: String,
    todo_id: String,
    event: serde_json::Value,
    ts: u64,
}

/// Payload forwarded when the agent asks the user something (select/confirm/…).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UiRequestPayload {
    run_id: String,
    todo_id: String,
    request: serde_json::Value,
    ts: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSessionRequest {
    pub run_id: String,
    pub todo_id: String,
    pub workspace_path: String,
    pub workdir: String,
    pub prompt: String,
    pub agent_command: Option<String>,
    #[serde(default = "default_permission_mode")]
    pub permission_mode: String,
    #[serde(default)]
    pub llm: Option<AgentLlmConfig>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartSessionResult {
    pub run_id: String,
    pub log_file_path: String,
}

/// A live pi rpc session. Cloneable pieces are shared with the reader tasks so
/// commands can push into stdin and `finish` can reuse the shared logger.
struct SessionHandle {
    todo_id: String,
    workdir: String,
    stdin_tx: mpsc::UnboundedSender<String>,
    logger: Arc<AsyncMutex<RunLogger>>,
    reader_tasks: Vec<tokio::task::JoinHandle<()>>,
    /// Set to true before a deliberate finish/cancel so the exit watcher does
    /// not report the shutdown as an unexpected crash.
    deliberate: Arc<AtomicBool>,
    /// Signals the exit watcher to kill the child process.
    kill_tx: Option<oneshot::Sender<()>>,
    /// The process-exit watcher task (owns the child).
    monitor: Option<tokio::task::JoinHandle<()>>,
}

type SessionMap = AsyncMutex<HashMap<String, SessionHandle>>;

fn sessions() -> &'static SessionMap {
    static SESSIONS: OnceLock<SessionMap> = OnceLock::new();
    SESSIONS.get_or_init(|| AsyncMutex::new(HashMap::new()))
}

/// Derive a short, human-readable log line from a structured RPC event so the
/// existing console keeps showing progress even before the structured UI lands.
fn summarize_event(ev: &serde_json::Value) -> Option<(&'static str, String)> {
    let ty = ev.get("type").and_then(|v| v.as_str())?;
    match ty {
        "agent_start" => Some(("system", "▶ agent 开始处理".to_string())),
        "agent_end" => Some(("system", "⏸ 本回合结束，等待你的回复".to_string())),
        "auto_retry_start" => {
            let attempt = ev.get("attempt").and_then(|v| v.as_i64()).unwrap_or(0);
            let max = ev.get("maxAttempts").and_then(|v| v.as_i64()).unwrap_or(0);
            let emsg = ev
                .get("errorMessage")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Some((
                "stderr",
                format!("⟳ 连接/服务异常，正在自动重试（第 {}/{} 次）：{}", attempt, max, emsg),
            ))
        }
        "auto_retry_end" => {
            let ok = ev.get("success").and_then(|v| v.as_bool()).unwrap_or(false);
            if ok {
                Some(("system", "✔ 重试成功，继续执行".to_string()))
            } else {
                let fe = ev.get("finalError").and_then(|v| v.as_str()).unwrap_or("");
                Some(("stderr", format!("✖ 自动重试失败：{}", fe)))
            }
        }
        "message_end" => {
            // Surface a model/provider failure carried on the assistant message
            // (e.g. 404, missing API key) so it lands in the raw log too.
            let msg = ev.get("message")?;
            let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
            let stop = msg.get("stopReason").and_then(|v| v.as_str()).unwrap_or("");
            if role == "assistant" && stop == "error" {
                let em = msg
                    .get("errorMessage")
                    .and_then(|v| v.as_str())
                    .unwrap_or("模型返回错误");
                Some(("stderr", format!("⚠ 模型返回错误：{}", em)))
            } else {
                None
            }
        }
        "session_shutdown" => Some(("system", "● 会话已结束".to_string())),
        "tool_call" => {
            let name = ev.get("toolName").and_then(|v| v.as_str()).unwrap_or("?");
            Some(("system", format!("🔧 调用工具 {}", name)))
        }
        "error" => {
            let msg = ev
                .get("error")
                .and_then(|v| v.as_str())
                .or_else(|| ev.get("message").and_then(|v| v.as_str()))
                .unwrap_or("未知错误");
            Some(("stderr", format!("错误: {}", msg)))
        }
        "extension_ui_request" => {
            let title = ev
                .get("title")
                .and_then(|v| v.as_str())
                .or_else(|| ev.get("message").and_then(|v| v.as_str()))
                .unwrap_or("需要你的输入");
            Some(("system", format!("❓ {}", title)))
        }
        "response" => {
            let ok = ev.get("success").and_then(|v| v.as_bool()).unwrap_or(true);
            if ok {
                None
            } else {
                let err = ev.get("error").and_then(|v| v.as_str()).unwrap_or("");
                Some(("stderr", format!("命令失败: {}", err)))
            }
        }
        _ => None,
    }
}

/// Spawn the stdout/stderr reader tasks that parse RPC JSON lines and forward
/// them as structured Tauri events + into the shared run log.
fn spawn_readers(
    app: tauri::AppHandle,
    run_id: String,
    todo_id: String,
    logger: Arc<AsyncMutex<RunLogger>>,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
) -> Vec<tokio::task::JoinHandle<()>> {
    let out_app = app.clone();
    let out_run = run_id.clone();
    let out_todo = todo_id.clone();
    let out_logger = logger.clone();
    let out_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            // Always persist the raw line.
            {
                let mut lg = out_logger.lock().await;
                lg.write("rpc", trimmed);
            }
            match serde_json::from_str::<serde_json::Value>(trimmed) {
                Ok(ev) => {
                    let ty = ev.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    // Structured event for the rich console.
                    let _ = out_app.emit(
                        AGENT_EVENT,
                        AgentEventPayload {
                            run_id: out_run.clone(),
                            todo_id: out_todo.clone(),
                            event: ev.clone(),
                            ts: now_millis(),
                        },
                    );
                    match ty {
                        "agent_start" => {
                            emit_phase(&out_app, &out_run, &out_todo, "agent_running", None)
                        }
                        "agent_end" => {
                            emit_phase(&out_app, &out_run, &out_todo, "waiting_input", None)
                        }
                        "auto_retry_start" => {
                            // Retryable error: pi is backing off and will retry.
                            // Keep the badge on "running" so the UI reflects that
                            // the agent is still busy rather than idle-waiting.
                            emit_phase(
                                &out_app,
                                &out_run,
                                &out_todo,
                                "agent_running",
                                Some("自动重试中"),
                            )
                        }
                        "extension_ui_request" => {
                            let _ = out_app.emit(
                                UI_REQUEST_EVENT,
                                UiRequestPayload {
                                    run_id: out_run.clone(),
                                    todo_id: out_todo.clone(),
                                    request: ev.clone(),
                                    ts: now_millis(),
                                },
                            );
                            emit_phase(&out_app, &out_run, &out_todo, "waiting_input", None);
                        }
                        _ => {}
                    }
                    if let Some((stream, human)) = summarize_event(&ev) {
                        emit_log(&out_app, &out_run, &out_todo, stream, &human);
                    }
                }
                Err(_) => {
                    // Non-JSON line (e.g. a stray banner): forward as a log line.
                    emit_log(&out_app, &out_run, &out_todo, "stdout", trimmed);
                }
            }
        }
    });

    let err_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            {
                let mut lg = logger.lock().await;
                lg.write("stderr", &line);
            }
            emit_log(&app, &run_id, &todo_id, "stderr", &line);
        }
    });

    vec![out_task, err_task]
}

/// Spawn a task that owns the child process and waits for it to exit. On an
/// unexpected exit (not a deliberate finish/cancel) it unsticks the UI by
/// emitting an error event + a terminal `failed` phase, and evicts the session
/// from the map. A deliberate shutdown signals via `kill_rx` and reaps quietly.
fn spawn_exit_watcher(
    app: tauri::AppHandle,
    run_id: String,
    todo_id: String,
    logger: Arc<AsyncMutex<RunLogger>>,
    mut child: Child,
    deliberate: Arc<AtomicBool>,
    kill_rx: oneshot::Receiver<()>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let status = tokio::select! {
            s = child.wait() => s.ok(),
            _ = kill_rx => {
                let _ = child.start_kill();
                child.wait().await.ok()
            }
        };

        if deliberate.load(Ordering::SeqCst) {
            // Finish/cancel already drives the terminal state; nothing to do.
            return;
        }

        // Unexpected exit: report it so the session doesn't hang in "running".
        let code = status.and_then(|s| s.code());
        let detail = match code {
            Some(0) => "agent 进程已退出（可能已完成，但未收到结束标记）".to_string(),
            Some(c) => format!("agent 进程异常退出（退出码 {}），请检查模型配置或日志", c),
            None => "agent 进程已被终止".to_string(),
        };
        {
            let mut lg = logger.lock().await;
            lg.write("system", &detail);
        }
        // Forward as an error event so the chat timeline can surface it.
        let _ = app.emit(
            AGENT_EVENT,
            AgentEventPayload {
                run_id: run_id.clone(),
                todo_id: todo_id.clone(),
                event: serde_json::json!({ "type": "error", "error": detail }),
                ts: now_millis(),
            },
        );
        emit_log(&app, &run_id, &todo_id, "stderr", &detail);
        emit_phase(&app, &run_id, &todo_id, "failed", Some(&detail));

        // Evict the now-dead session so its runId can't be reused by mistake.
        sessions().lock().await.remove(&run_id);
    })
}

/// Build the `pi --mode rpc` invocation (program, args, envs) reusing the same
/// credential wiring as the one-shot path.
fn resolve_rpc_invocation(
    app: &tauri::AppHandle,
    agent_command: Option<&str>,
    llm: Option<&AgentLlmConfig>,
    permission_mode: &str,
) -> Result<AgentInvocation, String> {
    let uses_custom = agent_command.map(|c| !c.trim().is_empty()).unwrap_or(false);
    let AgentInvocation {
        program,
        mut args,
        mut envs,
    } = resolve_agent_command(agent_command)?;
    args.push("--mode".into());
    args.push("rpc".into());
    args.push("--no-session".into());
    if !uses_custom {
        if let Some(llm) = llm {
            if !llm.model.trim().is_empty() {
                let (mut llm_args, llm_envs) = setup_llm_env(app, llm)?;
                args.append(&mut llm_args);
                envs.extend(llm_envs);
            }
        }
        // Activate the permission gate (Explore / Ask / Auto).
        let (mut gate_args, gate_envs) = permission_gate_wiring(permission_mode);
        args.append(&mut gate_args);
        envs.extend(gate_envs);
    }
    Ok(AgentInvocation {
        program,
        args,
        envs,
    })
}

/// Serialize + enqueue one RPC command line for a live session.
async fn send_rpc(run_id: &str, value: serde_json::Value) -> Result<(), String> {
    let line = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    let map = sessions().lock().await;
    let handle = map
        .get(run_id)
        .ok_or_else(|| format!("会话不存在或已结束: {}", run_id))?;
    handle
        .stdin_tx
        .send(line)
        .map_err(|_| "会话 stdin 已关闭".to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn start_agent_session(
    app: tauri::AppHandle,
    req: StartSessionRequest,
) -> Result<StartSessionResult, String> {
    if req.workdir.trim().is_empty() {
        return Err("未设置工作目录".into());
    }
    if !Path::new(&req.workdir).is_dir() {
        return Err(format!("工作目录不存在: {}", req.workdir));
    }
    let uses_custom = req
        .agent_command
        .as_deref()
        .map(|c| !c.trim().is_empty())
        .unwrap_or(false);
    if !uses_custom {
        let has_key = req
            .llm
            .as_ref()
            .map(|l| !l.api_key.trim().is_empty() && !l.model.trim().is_empty())
            .unwrap_or(false);
        if !has_key {
            return Err(
                "未配置模型 API Key，请在「设置」中填写 OpenAI 的 API Key 与模型后重试。".into(),
            );
        }
    }

    // Reject duplicate run ids for still-live sessions.
    if sessions().lock().await.contains_key(&req.run_id) {
        return Err(format!("会话已在运行: {}", req.run_id));
    }

    let workspace_path = PathBuf::from(&req.workspace_path);
    let mut logger = RunLogger::new(&workspace_path, &req.run_id)?;
    let log_file_path = logger.path.to_string_lossy().to_string();

    let AgentInvocation {
        program,
        args,
        envs,
    } = resolve_rpc_invocation(
        &app,
        req.agent_command.as_deref(),
        req.llm.as_ref(),
        &req.permission_mode,
    )?;

    emit_phase(&app, &req.run_id, &req.todo_id, "preparing", None);
    let banner = format!("$ {} --mode rpc (cwd: {})", program, req.workdir);
    logger.write("system", &banner);
    emit_log(&app, &req.run_id, &req.todo_id, "system", &banner);

    let mut child = Command::new(&program)
        .args(&args)
        .envs(envs)
        .current_dir(&req.workdir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("启动 agent 失败 ({}): {}", program, e))?;

    let stdin = child.stdin.take().ok_or("无法获取 agent stdin")?;
    let stdout = child.stdout.take().ok_or("无法获取 agent stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取 agent stderr")?;

    // Dedicated writer task serializes all stdin writes.
    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        let mut stdin = stdin;
        while let Some(line) = stdin_rx.recv().await {
            if stdin.write_all(line.as_bytes()).await.is_err() {
                break;
            }
            if stdin.write_all(b"\n").await.is_err() {
                break;
            }
            let _ = stdin.flush().await;
        }
    });

    let logger = Arc::new(AsyncMutex::new(logger));
    let reader_tasks = spawn_readers(
        app.clone(),
        req.run_id.clone(),
        req.todo_id.clone(),
        logger.clone(),
        stdout,
        stderr,
    );

    // Watch for the agent process exiting on its own (crash / error exit) so
    // the UI never gets stuck in "running" when pi dies without an agent_end.
    let deliberate = Arc::new(AtomicBool::new(false));
    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    let monitor = spawn_exit_watcher(
        app.clone(),
        req.run_id.clone(),
        req.todo_id.clone(),
        logger.clone(),
        child,
        deliberate.clone(),
        kill_rx,
    );

    let handle = SessionHandle {
        todo_id: req.todo_id.clone(),
        workdir: req.workdir.clone(),
        stdin_tx,
        logger,
        reader_tasks,
        deliberate,
        kill_tx: Some(kill_tx),
        monitor: Some(monitor),
    };
    sessions().lock().await.insert(req.run_id.clone(), handle);

    // Kick off the first turn with the safety guardrail preamble. Hard
    // permission gating is enforced by the loaded permission-gate extension.
    let full_prompt = format!("{}{}", SAFE_MODE_PREAMBLE, req.prompt);
    emit_phase(&app, &req.run_id, &req.todo_id, "agent_running", None);
    send_rpc(
        &req.run_id,
        serde_json::json!({ "type": "prompt", "message": full_prompt }),
    )
    .await?;

    Ok(StartSessionResult {
        run_id: req.run_id,
        log_file_path,
    })
}

#[tauri::command]
pub async fn send_agent_message(
    run_id: String,
    message: String,
    kind: Option<String>,
) -> Result<(), String> {
    let kind = kind.unwrap_or_else(|| "follow_up".into());
    let ty = match kind.as_str() {
        "steer" => "steer",
        "prompt" => "prompt",
        _ => "follow_up",
    };
    send_rpc(&run_id, serde_json::json!({ "type": ty, "message": message })).await
}

#[tauri::command]
pub async fn respond_agent_ui(
    run_id: String,
    request_id: String,
    value: Option<String>,
    confirmed: Option<bool>,
    cancelled: Option<bool>,
) -> Result<(), String> {
    let mut resp = serde_json::Map::new();
    resp.insert("type".into(), serde_json::json!("extension_ui_response"));
    resp.insert("id".into(), serde_json::json!(request_id));
    if cancelled.unwrap_or(false) {
        resp.insert("cancelled".into(), serde_json::json!(true));
    } else if let Some(c) = confirmed {
        // Keep compatibility with agents that read either `confirmed` or
        // generic string `value` for confirm prompts.
        resp.insert("confirmed".into(), serde_json::json!(c));
        resp.insert(
            "value".into(),
            serde_json::json!(if c { "true" } else { "false" }),
        );
    } else {
        resp.insert("value".into(), serde_json::json!(value.unwrap_or_default()));
    }
    send_rpc(&run_id, serde_json::Value::Object(resp)).await
}

#[tauri::command]
pub async fn abort_agent_turn(run_id: String) -> Result<(), String> {
    send_rpc(&run_id, serde_json::json!({ "type": "abort" })).await
}

/// Remove a session from the map and tear down its child + reader tasks.
async fn take_and_shutdown(run_id: &str) -> Option<SessionHandle> {
    let mut handle = sessions().lock().await.remove(run_id)?;
    // Mark deliberate so the exit watcher stays quiet, then best-effort graceful
    // stop followed by a kill signal to the watcher (which owns the child).
    handle.deliberate.store(true, Ordering::SeqCst);
    let _ = handle.stdin_tx.send("{\"type\":\"abort\"}".to_string());
    if let Some(tx) = handle.kill_tx.take() {
        let _ = tx.send(());
    }
    // Wait for the watcher to reap the child so validation runs cleanly.
    if let Some(monitor) = handle.monitor.take() {
        let _ = monitor.await;
    }
    for task in &handle.reader_tasks {
        task.abort();
    }
    Some(handle)
}

#[tauri::command]
pub async fn finish_agent_session(
    app: tauri::AppHandle,
    run_id: String,
    validation_commands: Vec<String>,
) -> Result<ExecuteTodoResult, String> {
    let handle = take_and_shutdown(&run_id)
        .await
        .ok_or_else(|| format!("会话不存在或已结束: {}", run_id))?;
    let todo_id = handle.todo_id.clone();
    let workdir = handle.workdir.clone();

    // Normalize validation commands (drop blanks / obvious placeholders).
    let commands = sanitize_validation_commands(&validation_commands);

    let mut logger = handle.logger.lock().await;
    let validation_results = if commands.is_empty() {
        Vec::new()
    } else {
        emit_phase(&app, &run_id, &todo_id, "validating", None);
        run_validations(&app, &mut logger, &run_id, &todo_id, &workdir, &commands).await
    };

    let all_ok = validation_results.iter().all(|v| v.ok);
    let succeeded = all_ok;
    let error = if succeeded {
        None
    } else {
        let failed = validation_results
            .iter()
            .find(|v| !v.ok)
            .map(|v| v.command.clone())
            .unwrap_or_else(|| "（无校验结果）".into());
        Some(format!("校验失败: {}", failed))
    };

    let summary = if succeeded {
        if validation_results.is_empty() {
            "已完成（未配置校验命令）".into()
        } else {
            format!("已完成，{} 条校验全部通过", validation_results.len())
        }
    } else {
        error.clone().unwrap_or_else(|| "校验失败".into())
    };
    logger.write("system", &summary);
    emit_phase(
        &app,
        &run_id,
        &todo_id,
        if succeeded { "done" } else { "failed" },
        Some(&summary),
    );

    Ok(ExecuteTodoResult {
        run_id,
        agent_ok: true,
        agent_exit_code: None,
        validation_results,
        summary,
        log_tail: logger.tail(),
        log_file_path: logger.path.to_string_lossy().to_string(),
        error,
    })
}

#[tauri::command]
pub async fn cancel_agent_session(app: tauri::AppHandle, run_id: String) -> Result<(), String> {
    if let Some(handle) = take_and_shutdown(&run_id).await {
        let todo_id = handle.todo_id.clone();
        {
            let mut logger = handle.logger.lock().await;
            logger.write("system", "用户已放弃本次执行");
        }
        emit_phase(&app, &run_id, &todo_id, "failed", Some("已放弃"));
    }
    Ok(())
}

/// Drop blank / placeholder validation commands (fixes legacy dirty data like
/// `["无"]` that produced `sh: 无: command not found`).
fn sanitize_validation_commands(commands: &[String]) -> Vec<String> {
    const PLACEHOLDERS: [&str; 6] = ["无", "无。", "none", "n/a", "na", "-"];
    commands
        .iter()
        .map(|c| c.trim())
        .filter(|c| !c.is_empty())
        .filter(|c| !PLACEHOLDERS.contains(&c.to_ascii_lowercase().as_str()))
        .map(|c| c.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_respects_char_boundaries() {
        let s = "中文日志内容测试";
        let t = tail(s, 5);
        assert!(s.ends_with(&t));
    }

    #[test]
    fn guess_mime_known_types() {
        assert_eq!(guess_mime(Path::new("a.docx")), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        assert_eq!(guess_mime(Path::new("a.PNG")), "image/png");
        assert_eq!(guess_mime(Path::new("a.unknown")), "application/octet-stream");
    }

    #[test]
    fn resolve_custom_command_splits_args() {
        let inv = resolve_agent_command(Some("npx pi --model gpt-4o")).unwrap();
        assert_eq!(inv.program, "npx");
        assert_eq!(inv.args, vec!["pi", "--model", "gpt-4o"]);
    }

    #[test]
    fn hash_name_is_deterministic() {
        assert_eq!(hash_name("制作RL相关PPT"), hash_name("制作RL相关PPT"));
        assert_ne!(hash_name("a"), hash_name("b"));
        assert_eq!(hash_name("x").len(), 16);
    }

    #[test]
    fn sanitize_drops_blanks_and_placeholders() {
        let input = vec![
            "  ".to_string(),
            "无".to_string(),
            "N/A".to_string(),
            "pnpm test".to_string(),
            "  cargo build ".to_string(),
        ];
        let out = sanitize_validation_commands(&input);
        assert_eq!(out, vec!["pnpm test".to_string(), "cargo build".to_string()]);
    }

    #[test]
    fn summarize_maps_known_event_types() {
        let ev = serde_json::json!({ "type": "agent_end", "messages": [] });
        assert_eq!(summarize_event(&ev).unwrap().0, "system");
        let ev = serde_json::json!({ "type": "tool_call", "toolName": "bash" });
        assert!(summarize_event(&ev).unwrap().1.contains("bash"));
        let ok = serde_json::json!({ "type": "response", "success": true });
        assert!(summarize_event(&ok).is_none());
        let bad = serde_json::json!({ "type": "response", "success": false, "error": "boom" });
        assert_eq!(summarize_event(&bad).unwrap().0, "stderr");
        let noise = serde_json::json!({ "type": "message_update" });
        assert!(summarize_event(&noise).is_none());
    }

    #[test]
    fn run_logger_writes_and_tails() {
        let dir = std::env::temp_dir().join(format!("taskly-test-{}", now_millis()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut logger = RunLogger::new(&dir, "run-x").unwrap();
        logger.write("stdout", "hello");
        logger.write("stderr", "boom");
        let tail = logger.tail();
        assert!(tail.contains("hello"));
        assert!(tail.contains("boom"));
        assert!(logger.path.exists());
        let content = std::fs::read_to_string(&logger.path).unwrap();
        assert!(content.contains("[stdout] hello"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn run_logger_tail_is_bounded() {
        let dir = std::env::temp_dir().join(format!("taskly-test-{}", now_millis() + 1));
        std::fs::create_dir_all(&dir).unwrap();
        let mut logger = RunLogger::new(&dir, "run-y").unwrap();
        for i in 0..5000 {
            logger.write("stdout", &format!("line {}", i));
        }
        assert!(logger.tail().len() <= TAIL_LIMIT);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
