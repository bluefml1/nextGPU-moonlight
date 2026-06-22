use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use actix_ws::Session;
use common::{api_bindings::StreamServerMessage, serialize_json};
use log::debug;
use tokio::sync::RwLock;

use crate::app::host::HostId;

static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct StreamSessionRegistry {
    sessions: Arc<RwLock<HashMap<HostId, HashMap<u64, Session>>>>,
}

impl StreamSessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register(&self, host_id: HostId, session: Session) -> u64 {
        let id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
        self.sessions
            .write()
            .await
            .entry(host_id)
            .or_default()
            .insert(id, session);
        id
    }

    pub async fn unregister(&self, host_id: HostId, session_id: u64) {
        let mut sessions = self.sessions.write().await;
        if let Some(host_sessions) = sessions.get_mut(&host_id) {
            host_sessions.remove(&session_id);
            if host_sessions.is_empty() {
                sessions.remove(&host_id);
            }
        }
    }

    /// Notify every open stream WebSocket for this host, then close them.
    pub async fn cancel_host(&self, host_id: HostId) {
        let host_sessions = {
            let mut sessions = self.sessions.write().await;
            sessions.remove(&host_id)
        };

        let Some(host_sessions) = host_sessions else {
            return;
        };

        debug!(
            "[CancelSession]: notifying {} stream client(s) for host {host_id:?}",
            host_sessions.len()
        );

        for (_, mut session) in host_sessions {
            if let Some(json) = serialize_json(&StreamServerMessage::SessionCancelled) {
                let _ = session.text(json).await;
            }
            let _ = session.close(None).await;
        }
    }
}

impl Default for StreamSessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

pub struct StreamSessionGuard {
    registry: StreamSessionRegistry,
    host_id: HostId,
    session_id: u64,
}

impl StreamSessionGuard {
    pub fn new(registry: StreamSessionRegistry, host_id: HostId, session_id: u64) -> Self {
        Self {
            registry,
            host_id,
            session_id,
        }
    }
}

impl Drop for StreamSessionGuard {
    fn drop(&mut self) {
        let registry = self.registry.clone();
        let host_id = self.host_id;
        let session_id = self.session_id;
        tokio::spawn(async move {
            registry.unregister(host_id, session_id).await;
        });
    }
}
