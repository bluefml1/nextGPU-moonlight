use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use common::config::Config;
use log::{info, warn};
use serde::Deserialize;
use tokio::{sync::watch, time::sleep};

use crate::app::host::HostId;

/// A prep that finished this recently is reused by the next stream start for the same host.
const PREP_REUSE_WINDOW: Duration = Duration::from_secs(60);

/// Longest wait for the RentalUserReset task, so prep plus app launch stays under the
/// renter's 2-minute limit.
pub const RENTAL_RESET_WAIT: Duration = Duration::from_secs(95);

const RENTAL_RESET_POLL: Duration = Duration::from_secs(2);

/// `startSession.ps1` exit code: the RentalUserReset task is resetting the rental user.
#[cfg_attr(not(windows), allow(dead_code))]
const EXIT_RENTAL_RESET_PENDING: i32 = 3;

/// Written by `resetRentalUser.ps1` / `nextGpuSessionCommon.ps1` next to `startSession.ps1`.
const RENTAL_RESET_STATE_FILE: &str = "RentalReset-state.json";

#[derive(Clone, Debug)]
pub enum PrepStatus {
    Running,
    /// The RentalUserReset task is recreating and signing in the rental user.
    Cleaning { since: Instant },
    Done(Result<(), String>),
}

pub enum PrepWait {
    Ready,
    Pending(watch::Receiver<PrepStatus>),
}

enum PrepState {
    Running(watch::Receiver<PrepStatus>),
    Done(Instant),
}

#[cfg_attr(not(windows), allow(dead_code))]
enum StartSessionOutcome {
    Ready,
    RentalResetPending,
}

#[derive(Deserialize)]
struct RentalResetState {
    state: String,
    #[serde(default)]
    reason: String,
}

static PREP_STATES: LazyLock<Mutex<HashMap<HostId, PrepState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Make sure `startSession.ps1` has run for this host, at most one copy at a time.
///
/// The script recreates a Windows user, so it must never be killed halfway or run twice
/// in parallel. It runs in a detached task: a caller that gives up (timeout, closed socket)
/// leaves it running, and the next caller watches the same run instead of starting another.
pub fn ensure_prep(
    host_id: HostId,
    script: PathBuf,
    domain_txt_path: Option<PathBuf>,
) -> PrepWait {
    let mut states = PREP_STATES.lock().unwrap_or_else(|err| err.into_inner());
    match states.get(&host_id) {
        Some(PrepState::Done(at)) if at.elapsed() < PREP_REUSE_WINDOW => {
            info!("[StartSession]: host {host_id:?} was prepared {:?} ago, skipping prep", at.elapsed());
            PrepWait::Ready
        }
        Some(PrepState::Running(receiver)) => {
            info!("[StartSession]: prep already running for host {host_id:?}, waiting for it");
            PrepWait::Pending(receiver.clone())
        }
        _ => {
            let (sender, receiver) = watch::channel(PrepStatus::Running);
            states.insert(host_id, PrepState::Running(receiver.clone()));

            tokio::spawn(async move {
                let result = run_prep(&script, domain_txt_path.as_deref(), &sender).await;
                {
                    let mut states = PREP_STATES.lock().unwrap_or_else(|err| err.into_inner());
                    if result.is_ok() {
                        states.insert(host_id, PrepState::Done(Instant::now()));
                    } else {
                        states.remove(&host_id);
                    }
                }
                let _ = sender.send(PrepStatus::Done(result));
            });

            PrepWait::Pending(receiver)
        }
    }
}

/// The prep task died without reporting; let the next caller start a fresh one.
pub fn abandon_prep(host_id: HostId) {
    let mut states = PREP_STATES.lock().unwrap_or_else(|err| err.into_inner());
    if matches!(states.get(&host_id), Some(PrepState::Running(_))) {
        states.remove(&host_id);
    }
}

/// After a cancel the next stream start is a fresh rental and must not reuse a recent prep.
pub fn forget_prep(host_id: HostId) {
    let mut states = PREP_STATES.lock().unwrap_or_else(|err| err.into_inner());
    if matches!(states.get(&host_id), Some(PrepState::Done(_))) {
        states.remove(&host_id);
    }
}

async fn run_prep(
    script: &Path,
    domain_txt_path: Option<&Path>,
    sender: &watch::Sender<PrepStatus>,
) -> Result<(), String> {
    match run_start_session(script, domain_txt_path).await? {
        StartSessionOutcome::Ready => Ok(()),
        StartSessionOutcome::RentalResetPending => {
            let since = Instant::now();
            info!("[StartSession]: rental user reset running, waiting for {RENTAL_RESET_STATE_FILE}");
            let _ = sender.send(PrepStatus::Cleaning { since });

            wait_for_rental_reset(&script.with_file_name(RENTAL_RESET_STATE_FILE), since).await?;

            // The reset saved the new start_time, so this run takes the fast path.
            match run_start_session(script, domain_txt_path).await? {
                StartSessionOutcome::Ready => Ok(()),
                StartSessionOutcome::RentalResetPending => {
                    Err("machine reset did not finish".to_string())
                }
            }
        }
    }
}

async fn wait_for_rental_reset(state_path: &Path, since: Instant) -> Result<(), String> {
    let mut seen_cleaning = false;
    loop {
        if since.elapsed() >= RENTAL_RESET_WAIT {
            warn!("[StartSession]: rental user reset still running after {RENTAL_RESET_WAIT:?}");
            return Err("machine reset timed out".to_string());
        }

        match read_rental_reset_state(state_path).await {
            Some(state) if state.state == "ready" => {
                info!("[StartSession]: rental user reset ready after {:?}", since.elapsed());
                return Ok(());
            }
            Some(state) if state.state == "failed" => {
                warn!("[StartSession]: rental user reset failed: {}", state.reason);
                return Err(if state.reason.is_empty() {
                    "machine reset failed".to_string()
                } else {
                    format!("machine reset failed: {}", state.reason)
                });
            }
            Some(_) => seen_cleaning = true,
            // startSession.ps1 deletes a finished state file when it starts again.
            None if seen_cleaning => return Ok(()),
            None => {}
        }

        sleep(RENTAL_RESET_POLL).await;
    }
}

async fn read_rental_reset_state(path: &Path) -> Option<RentalResetState> {
    let text = tokio::fs::read_to_string(path).await.ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

/// Resolve `startSession.ps1` from config or the Sunshine install `script` folder.
pub fn resolve_start_session_script(config: &Config) -> Option<PathBuf> {
    if let Some(path) = config.start_session_script_path.as_deref() {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
        warn!(
            "[StartSession]: configured start_session_script_path does not exist: {}",
            path.display()
        );
    }

    #[cfg(windows)]
    {
        return sunshine_program_files_start_session()
            .or_else(program_data_nextgpu_start_session)
            .or_else(env_repo_start_session);
    }

    #[cfg(not(windows))]
    None
}

#[cfg(windows)]
fn sunshine_program_files_start_session() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("SUNSHINE_START_SESSION_SCRIPT") {
        let path = PathBuf::from(path.trim());
        if path.is_file() {
            return Some(path);
        }
    }

    let program_files = std::env::var_os("ProgramFiles")?;
    let roots = [
        PathBuf::from(&program_files).join("Sunshine"),
        PathBuf::from(&program_files).join("LizardByte").join("Sunshine"),
    ];
    let script_dirs = ["script", "scripts"];

    for root in &roots {
        for dir in script_dirs {
            let script = root.join(dir).join("startSession.ps1");
            if script.is_file() {
                return Some(script);
            }
        }
    }

    None
}

#[cfg(windows)]
fn program_data_nextgpu_start_session() -> Option<PathBuf> {
    let program_data = std::env::var_os("ProgramData")?;
    let marker = PathBuf::from(program_data)
        .join("nextGPU")
        .join("repo-root.txt");
    let repo_root = std::fs::read_to_string(&marker)
        .ok()?
        .trim()
        .trim_end_matches('\\')
        .to_string();
    if repo_root.is_empty() {
        return None;
    }
    let script = PathBuf::from(repo_root).join("startSession.ps1");
    script.is_file().then_some(script)
}

#[cfg(windows)]
fn env_repo_start_session() -> Option<PathBuf> {
    let root = std::env::var_os("NEXTGPU_REPO_ROOT")?;
    let script = PathBuf::from(root).join("startSession.ps1");
    script.is_file().then_some(script)
}

async fn run_start_session(
    script: &Path,
    domain_txt_path: Option<&Path>,
) -> Result<StartSessionOutcome, String> {
    #[cfg(windows)]
    {
        return run_start_session_windows(script, domain_txt_path).await;
    }

    #[cfg(not(windows))]
    {
        let _ = (script, domain_txt_path);
        Ok(StartSessionOutcome::Ready)
    }
}

#[cfg(windows)]
async fn run_start_session_windows(
    script: &Path,
    domain_txt_path: Option<&Path>,
) -> Result<StartSessionOutcome, String> {
    use std::process::Stdio;

    use tokio::process::Command;

    info!("[StartSession]: running {}", script.display());

    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(script)
        // [string]$SunshinePrep in the script — use 0/1 (not [bool]) for reliable -File parsing.
        .args(["-Username", "nextGPU", "-SunshinePrep", "0"]);

    if let Some(domain_txt_path) = domain_txt_path {
        command
            .arg("-DomainTxtPath")
            .arg(domain_txt_path);
    }

    let output = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|err| format!("failed to spawn powershell for startSession.ps1: {err}"))?;

    if output.status.success() {
        info!("[StartSession]: completed successfully");
        return Ok(StartSessionOutcome::Ready);
    }

    let code = output.status.code();
    if code == Some(EXIT_RENTAL_RESET_PENDING) {
        info!("[StartSession]: rental user reset requested");
        return Ok(StartSessionOutcome::RentalResetPending);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);

    if !stdout.trim().is_empty() {
        warn!("[StartSession]: stdout: {stdout}");
    }
    if !stderr.trim().is_empty() {
        warn!("[StartSession]: stderr: {stderr}");
    }

    let detail = summarize_start_session_output(&stdout, &stderr);
    if detail.is_empty() {
        Err(format!(
            "startSession.ps1 exited with code {code:?} (see StartSession_*.log on host)"
        ))
    } else {
        Err(format!("startSession.ps1 failed: {detail}"))
    }
}

fn summarize_start_session_output(stdout: &str, stderr: &str) -> String {
    let mut highlights: Vec<String> = Vec::new();

    for line in stdout.lines().chain(stderr.lines()) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.contains("[FAIL]")
            || trimmed.contains("FAILED:")
            || trimmed.contains("Could not recreate")
            || trimmed.contains("Failed to create user")
        {
            highlights.push(trimmed.to_string());
        }
    }

    if !highlights.is_empty() {
        return highlights.join(" | ");
    }

    stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .rev()
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(" | ")
}
