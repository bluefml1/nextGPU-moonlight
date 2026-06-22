use std::path::{Path, PathBuf};

use common::config::Config;
use log::{info, warn};

/// Resolve `cancelSession.ps1` from config or the Sunshine install `script` folder.
pub fn resolve_cancel_session_script(config: &Config) -> Option<PathBuf> {
    if let Some(path) = config.cancel_session_script_path.as_deref() {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
        warn!(
            "[CancelSession]: configured cancel_session_script_path does not exist: {}",
            path.display()
        );
    }

    #[cfg(windows)]
    {
        return sunshine_program_files_cancel_session()
            .or_else(program_data_nextgpu_cancel_session)
            .or_else(env_repo_cancel_session);
    }

    #[cfg(not(windows))]
    None
}

#[cfg(windows)]
fn sunshine_program_files_cancel_session() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("SUNSHINE_CANCEL_SESSION_SCRIPT") {
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
            let script = root.join(dir).join("cancelSession.ps1");
            if script.is_file() {
                return Some(script);
            }
        }
    }

    None
}

#[cfg(windows)]
fn program_data_nextgpu_cancel_session() -> Option<PathBuf> {
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
    let script = PathBuf::from(repo_root).join("cancelSession.ps1");
    script.is_file().then_some(script)
}

#[cfg(windows)]
fn env_repo_cancel_session() -> Option<PathBuf> {
    let root = std::env::var_os("NEXTGPU_REPO_ROOT")?;
    let script = PathBuf::from(root).join("cancelSession.ps1");
    script.is_file().then_some(script)
}

pub async fn run_cancel_session(script: &Path, domain_txt_path: Option<&Path>) -> Result<(), String> {
    #[cfg(windows)]
    {
        return run_cancel_session_windows(script, domain_txt_path).await;
    }

    #[cfg(not(windows))]
    {
        let _ = (script, domain_txt_path);
        Ok(())
    }
}

#[cfg(windows)]
async fn run_cancel_session_windows(
    script: &Path,
    domain_txt_path: Option<&Path>,
) -> Result<(), String> {
    use std::process::Stdio;

    use tokio::process::Command;

    info!("[CancelSession]: running {}", script.display());

    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(script)
        .args(["-Username", "nextGPU"]);

    if let Some(domain_txt_path) = domain_txt_path {
        command.arg("-DomainTxtPath").arg(domain_txt_path);
    }

    let output = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|err| format!("failed to spawn powershell for cancelSession.ps1: {err}"))?;

    if output.status.success() {
        info!("[CancelSession]: completed successfully");
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let code = output.status.code();

    if !stdout.trim().is_empty() {
        warn!("[CancelSession]: stdout: {stdout}");
    }
    if !stderr.trim().is_empty() {
        warn!("[CancelSession]: stderr: {stderr}");
    }

    let detail = summarize_cancel_session_output(&stdout, &stderr);
    if detail.is_empty() {
        Err(format!(
            "cancelSession.ps1 exited with code {code:?} (see CancelSession_*.log on host)"
        ))
    } else {
        Err(format!("cancelSession.ps1 failed: {detail}"))
    }
}

fn summarize_cancel_session_output(stdout: &str, stderr: &str) -> String {
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
