//! Parse `domain.txt` written by NextGPU host registration.

use std::path::{Path, PathBuf};

use log::{info, warn};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DomainTxtIdentity {
    pub computer_name: Option<String>,
    pub public_ip: Option<String>,
}

/// Read identity fields from a domain.txt file.
pub fn read_domain_txt_identity(path: &Path) -> DomainTxtIdentity {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return DomainTxtIdentity::default(),
    };
    parse_domain_txt_identity_from_content(&content)
}

pub fn parse_domain_txt_identity_from_content(content: &str) -> DomainTxtIdentity {
    let mut identity = DomainTxtIdentity::default();
    for line in content.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("COMPUTER_NAME=") {
            let name = value.trim();
            if !name.is_empty() {
                identity.computer_name = Some(name.to_string());
            }
        } else if let Some(value) = line.strip_prefix("PUBLIC_IP=") {
            let ip = value.trim();
            if !ip.is_empty() {
                identity.public_ip = Some(ip.to_string());
            }
        }
    }
    identity
}

/// Resolve `domain_txt_path` (relative paths use the process current working directory).
pub fn load_domain_txt_identity(domain_txt_path: Option<&str>) -> Option<DomainTxtIdentity> {
    let path_str = domain_txt_path?.trim();
    if path_str.is_empty() {
        return None;
    }

    let path = resolve_domain_txt_path(path_str);
    let identity = read_domain_txt_identity(&path);
    if identity.computer_name.is_some() || identity.public_ip.is_some() {
        info!(
            "loaded domain.txt identity path={} computer_name={:?} public_ip={:?}",
            path.display(),
            identity.computer_name,
            identity.public_ip
        );
        Some(identity)
    } else {
        warn!(
            "domain.txt missing or empty identity (path={}); stream will use defaults",
            path.display()
        );
        None
    }
}

/// Convenience: machine display label from `COMPUTER_NAME`.
pub fn load_machine_label(domain_txt_path: Option<&str>) -> Option<String> {
    load_domain_txt_identity(domain_txt_path).and_then(|i| i.computer_name)
}

fn resolve_domain_txt_path(path_str: &str) -> PathBuf {
    let path = Path::new(path_str);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_identity() {
        let content = "DOMAIN=abc.example.com\nPUBLIC_IP=14.186.118.64\nCOMPUTER_NAME=NEXTGPU-105\n";
        let id = parse_domain_txt_identity_from_content(content);
        assert_eq!(id.public_ip.as_deref(), Some("14.186.118.64"));
        assert_eq!(id.computer_name.as_deref(), Some("NEXTGPU-105"));
    }

    #[test]
    fn ignores_empty_fields() {
        let content = "PUBLIC_IP=\nCOMPUTER_NAME=\n";
        let id = parse_domain_txt_identity_from_content(content);
        assert!(id.public_ip.is_none());
        assert!(id.computer_name.is_none());
    }
}
