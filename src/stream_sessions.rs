use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use actix_ws::Session;
use common::{
    api_bindings::StreamServerMessage,
    ipc::{IpcSender, ServerIpcMessage},
    serialize_json,
};
use log::{debug, info, warn};
use tokio::{
    sync::RwLock,
    time::{sleep, timeout},
};

use crate::app::host::HostId;

static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_STREAMER_ID: AtomicU64 = AtomicU64::new(1);

/// After the last streamer of a host exits, the host session still counts as live for this long,
/// so an in-page restart (bitrate change) or a page refresh doesn't rerun session prep.
const HOST_SESSION_GRACE: Duration = Duration::from_secs(60);

struct RegisteredStreamer {
    stop: IpcSender<ServerIpcMessage>,
    epoch: u64,
}

#[derive(Default)]
struct HostStreamers {
    streamers: HashMap<u64, RegisteredStreamer>,
    last_end: Option<Instant>,
    /// Bumped by CleanSession; streamers from an older epoch no longer keep the host session live.
    epoch: u64,
}

#[derive(Clone)]
pub struct StreamSessionRegistry {
    sessions: Arc<RwLock<HashMap<HostId, HashMap<u64, Session>>>>,
    /// Running streamer processes. Unlike `sessions` this outlives the WebSocket, which a proxy
    /// may close while the stream keeps running over WebRTC.
    streamers: Arc<RwLock<HashMap<HostId, HostStreamers>>>,
}

impl StreamSessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            streamers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Returns `(streamer id, epoch)` for `unregister_streamer`.
    pub async fn register_streamer(
        &self,
        host_id: HostId,
        stop: IpcSender<ServerIpcMessage>,
    ) -> (u64, u64) {
        let id = NEXT_STREAMER_ID.fetch_add(1, Ordering::Relaxed);
        let mut streamers = self.streamers.write().await;
        let host = streamers.entry(host_id).or_default();
        let epoch = host.epoch;
        host.streamers.insert(id, RegisteredStreamer { stop, epoch });
        (id, epoch)
    }

    pub async fn unregister_streamer(&self, host_id: HostId, id: u64, epoch: u64) {
        let mut streamers = self.streamers.write().await;
        let Some(host) = streamers.get_mut(&host_id) else {
            return;
        };
        host.streamers.remove(&id);
        if host.epoch == epoch {
            host.last_end = Some(Instant::now());
        }
    }

    /// True while a streamer of the current epoch runs for this host, or one ended recently.
    pub async fn host_session_live(&self, host_id: HostId) -> bool {
        let streamers = self.streamers.read().await;
        let Some(host) = streamers.get(&host_id) else {
            return false;
        };
        host.streamers.values().any(|streamer| streamer.epoch == host.epoch)
            || host
                .last_end
                .is_some_and(|last_end| last_end.elapsed() < HOST_SESSION_GRACE)
    }

    /// CleanSession: the next stream start for this host must run session prep again.
    pub async fn reset_host(&self, host_id: HostId) {
        let mut streamers = self.streamers.write().await;
        let host = streamers.entry(host_id).or_default();
        host.epoch += 1;
        host.last_end = None;
    }

    /// Ask every running streamer of this host to stop and wait until they exit or `wait` passes.
    /// Returns how many streamers were asked to stop.
    pub async fn stop_streamers(&self, host_id: HostId, wait: Duration) -> usize {
        let targets: Vec<(u64, IpcSender<ServerIpcMessage>)> = {
            let streamers = self.streamers.read().await;
            let Some(host) = streamers.get(&host_id) else {
                return 0;
            };
            host.streamers
                .iter()
                .map(|(id, streamer)| (*id, streamer.stop.clone()))
                .collect()
        };
        if targets.is_empty() {
            return 0;
        }

        info!(
            "[Stream]: stopping {} running streamer(s) for host {host_id:?}",
            targets.len()
        );
        let deadline = Instant::now() + wait;
        let ids: Vec<u64> = targets.iter().map(|(id, _)| *id).collect();
        for (_, mut stop) in targets {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if timeout(remaining, stop.send(ServerIpcMessage::Stop)).await.is_err() {
                break;
            }
        }

        loop {
            let still_running = {
                let streamers = self.streamers.read().await;
                streamers
                    .get(&host_id)
                    .is_some_and(|host| ids.iter().any(|id| host.streamers.contains_key(id)))
            };
            if !still_running {
                break;
            }
            if Instant::now() >= deadline {
                warn!(
                    "[Stream]: previous streamer(s) for host {host_id:?} still running after {wait:?}, continuing"
                );
                break;
            }
            sleep(Duration::from_millis(100)).await;
        }
        ids.len()
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
