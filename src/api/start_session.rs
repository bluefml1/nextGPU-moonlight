use std::path::{Path, PathBuf};

use common::config::Config;
use log::{info, warn};

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

pub async fn run_start_session(script: &Path, domain_txt_path: Option<&Path>) -> Result<(), String> {
    #[cfg(windows)]
    {
        return run_start_session_windows(script, domain_txt_path).await;
    }

    #[cfg(not(windows))]
    {
        let _ = (script, domain_txt_path);
        Ok(())
    }
}

#[cfg(windows)]
async fn run_start_session_windows(
    script: &Path,
    domain_txt_path: Option<&Path>,
) -> Result<(), String> {
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
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let code = output.status.code();

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
