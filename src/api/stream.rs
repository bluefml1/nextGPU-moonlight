use std::{
    env,
    path::{Path, PathBuf},
    process::Stdio,
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

use actix_web::{
    Error, HttpRequest, HttpResponse, get, post, rt as actix_rt,
    web::{Data, Json, Payload},
};
use actix_ws::{Closed, Message, Session};
use common::{
    api_bindings::{
        LogMessageType, PostCancelRequest, PostCancelResponse, StreamClientMessage,
        StreamServerMessage,
    },
    ipc::{ServerIpcMessage, StreamerConfig, StreamerIpcMessage, create_child_ipc},
    serialize_json,
};
use futures::StreamExt;
use log::{debug, error, info, warn};
use tokio::{
    fs::{self, File},
    io::AsyncWriteExt,
    process::Command,
    spawn,
    time::sleep,
};
use tracing::{Level, instrument, span};

use crate::app::{
    App, AppError,
    host::{AppId, HostId},
    user::AuthenticatedUser,
};

#[get("/host/stream")]
#[instrument(name = "start_host", skip(web_app, user, payload), fields(user_id = %user.id()))]
pub async fn start_host(
    web_app: Data<App>,
    mut user: AuthenticatedUser,
    request: HttpRequest,
    payload: Payload,
) -> Result<HttpResponse, Error> {
    let (response, mut session, mut stream) = actix_ws::handle(&request, payload)?;

    let client_unique_id = user.host_unique_id().await?;

    let web_app = web_app.clone();
    actix_rt::spawn(async move {
        // -- Init and Configure
        let message;
        loop {
            message = match stream.recv().await {
                Some(Ok(Message::Text(text))) => text,
                Some(Ok(Message::Binary(_))) => {
                    return;
                }
                Some(Ok(_)) => continue,
                Some(Err(_)) => {
                    return;
                }
                None => {
                    return;
                }
            };
            break;
        }

        let message = match serde_json::from_str::<StreamClientMessage>(&message) {
            Ok(value) => value,
            Err(_) => {
                return;
            }
        };

        let StreamClientMessage::Init {
            host_id,
            app_id,
            video_frame_queue_size,
            audio_sample_queue_size,
        } = message
        else {
            let _ = session.close(None).await;

            warn!("WebSocket didn't send init as first message, closing it");
            return;
        };

        let host_id = HostId(host_id);
        let app_id = AppId(app_id);

        // -- Collect host data
        let mut host = match user.host(host_id).await {
            Ok(host) => host,
            Err(AppError::HostNotFound) => {
                let _ = send_ws_message(
                    &mut session,
                    StreamServerMessage::DebugLog {
                        message: "Failed to start stream because the host was not found"
                            .to_string(),
                        ty: Some(LogMessageType::FatalDescription),
                    },
                )
                .await;
                let _ = session.close(None).await;
                return;
            }
            Err(err) => {
                warn!("failed to start stream for host {host_id:?} (at host): {err}");

                let _ = send_ws_message(
                    &mut session,
                    StreamServerMessage::DebugLog {
                        message: "Failed to start stream because of a server error".to_string(),
                        ty: Some(LogMessageType::FatalDescription),
                    },
                )
                .await;
                let _ = session.close(None).await;
                return;
            }
        };

        let apps = match host.list_apps(&mut user).await {
            Ok(apps) => apps,
            Err(err) => {
                warn!("failed to start stream for host {host_id:?} (at list_apps): {err}");

                let _ = send_ws_message(
                    &mut session,
                    StreamServerMessage::DebugLog {
                        message: "Failed to start stream because of a server error".to_string(),
                        ty: Some(LogMessageType::FatalDescription),
                    },
                )
                .await;
                let _ = session.close(None).await;
                return;
            }
        };

        let Some(app) = apps.into_iter().find(|app| app.id == app_id) else {
            warn!("failed to start stream for host {host_id:?} because the app couldn't be found!");

            let _ = send_ws_message(
                &mut session,
                StreamServerMessage::DebugLog {
                    message: "Failed to start stream because the app was not found".to_string(),
                    ty: Some(LogMessageType::FatalDescription),
                },
            )
            .await;
            let _ = session.close(None).await;
            return;
        };

        let (address, http_port) = match host.address_port(&mut user).await {
            Ok(address_port) => address_port,
            Err(err) => {
                warn!("failed to start stream for host {host_id:?} (at get address_port): {err}");

                let _ = send_ws_message(
                    &mut session,
                    StreamServerMessage::DebugLog {
                        message: "Failed to start stream because of a server error".to_string(),
                        ty: Some(LogMessageType::FatalDescription),
                    },
                )
                .await;
                let _ = session.close(None).await;
                return;
            }
        };

        let pair_info = match host.pair_info(&mut user).await {
            Ok(pair_info) => pair_info,
            Err(err) => {
                warn!("failed to start stream for host {host_id:?} (at get pair_info): {err}");

                let _ = send_ws_message(
                    &mut session,
                    StreamServerMessage::DebugLog {
                        message: "Failed to start stream because the host is not paired"
                            .to_string(),
                        ty: Some(LogMessageType::FatalDescription),
                    },
                )
                .await;
                let _ = session.close(None).await;
                return;
            }
        };

        // -- Send App info
        let _ = send_ws_message(
            &mut session,
            StreamServerMessage::UpdateApp { app: app.into() },
        )
        .await;

        // -- Starting stage: launch streamer
        let _ = send_ws_message(
            &mut session,
            StreamServerMessage::DebugLog {
                message: "Launching streamer".to_string(),
                ty: None,
            },
        )
        .await;

        // Spawn child
        let (mut child, stdin, stdout) = match Command::new(&web_app.config().streamer_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(mut child) => {
                if let Some(stdin) = child.stdin.take()
                    && let Some(stdout) = child.stdout.take()
                {
                    (child, stdin, stdout)
                } else {
                    error!("[Stream]: streamer process didn't include a stdin or stdout");

                    let _ = send_ws_message(
                        &mut session,
                        StreamServerMessage::DebugLog {
                            message: "Failed to start stream because of a server error".to_string(),
                            ty: Some(LogMessageType::FatalDescription),
                        },
                    )
                    .await;
                    let _ = session.close(None).await;

                    if let Err(err) = child.kill().await {
                        warn!("[Stream]: failed to kill child: {err}");
                    }

                    return;
                }
            }
            Err(err) => {
                error!("[Stream]: failed to spawn streamer process: {err}");

                let _ = send_ws_message(
                    &mut session,
                    StreamServerMessage::DebugLog {
                        message: "Failed to start stream because of a server error".to_string(),
                        ty: Some(LogMessageType::FatalDescription),
                    },
                )
                .await;
                let _ = session.close(None).await;
                return;
            }
        };

        // Create ipc
        static CHILD_COUNTER: AtomicUsize = AtomicUsize::new(0);
        let id = CHILD_COUNTER.fetch_add(1, Ordering::Relaxed);
        let span = span!(Level::INFO, "ipc", child_id = id);

        let (mut ipc_sender, mut ipc_receiver) = create_child_ipc::<
            ServerIpcMessage,
            StreamerIpcMessage,
        >(span, stdin, stdout, child.stderr.take())
        .await;

        // Redirect ipc message into ws
        spawn({
            let mut ipc_sender = ipc_sender.clone();
            async move {
                let mut warned_closed = false;
                while let Some(message) = ipc_receiver.recv().await {
                    match message {
                        StreamerIpcMessage::WebSocket(message) => {
                            if let Err(Closed) = send_ws_message(&mut session, message).await
                                && !warned_closed
                            {
                                warn!(
                                    "[Ipc]: Tried to send a ws message (text) but the socket is already closed"
                                );
                                ipc_sender.send(ServerIpcMessage::Stop).await;
                                warned_closed = true;
                            }
                        }
                        StreamerIpcMessage::WebSocketTransport(data) => {
                            if let Err(Closed) = session.binary(data).await
                                && !warned_closed
                            {
                                warn!(
                                    "[Ipc]: Tried to send a ws message (binary) but the socket is already closed"
                                );
                                ipc_sender.send(ServerIpcMessage::Stop).await;
                                warned_closed = true;
                            }
                        }
                        StreamerIpcMessage::Stop => {
                            debug!("[Ipc]: ipc receiver stopped by streamer");
                            break;
                        }
                    }
                }
                info!("[Ipc]: ipc receiver is closed");

                // Wait for the child to shutdown
                sleep(Duration::from_secs(10)).await;

                // close the websocket when the streamer crashed / disconnected / whatever
                if let Err(err) = session.close(None).await {
                    warn!("failed to close streamer web socket: {err}");
                }

                // kill the streamer
                if let Err(err) = child.kill().await {
                    warn!("failed to kill streamer child: {err}");
                }
            }
        });

        // Send init into ipc
        ipc_sender
            .send(ServerIpcMessage::Init {
                config: StreamerConfig {
                    webrtc: web_app.config().webrtc.clone(),
                    log_level: web_app.config().log.level_filter,
                },
                host_address: address,
                host_http_port: http_port,
                client_unique_id: Some(client_unique_id),
                client_private_key: pair_info.client_private_key,
                client_certificate: pair_info.client_certificate,
                server_certificate: pair_info.server_certificate,
                app_id: app_id.0,
                video_frame_queue_size,
                audio_sample_queue_size,
            })
            .await;

        // Redirect ws message into ipc
        while let Some(Ok(message)) = stream.recv().await {
            match message {
                Message::Text(text) => {
                    let Ok(message) = serde_json::from_str::<StreamClientMessage>(&text) else {
                        warn!("[Stream]: failed to deserialize from json");
                        return;
                    };

                    ipc_sender.send(ServerIpcMessage::WebSocket(message)).await;
                }
                Message::Binary(binary) => {
                    ipc_sender
                        .send(ServerIpcMessage::WebSocketTransport(binary))
                        .await;
                }
                _ => {}
            }
        }
    });

    Ok(response)
}

async fn send_ws_message(sender: &mut Session, message: StreamServerMessage) -> Result<(), Closed> {
    let Some(json) = serialize_json(&message) else {
        return Ok(());
    };

    sender.text(json).await
}

#[post("/host/cancel")]
pub async fn cancel_host(
    mut user: AuthenticatedUser,
    Json(request): Json<PostCancelRequest>,
) -> Result<Json<PostCancelResponse>, AppError> {
    let host_id = HostId(request.host_id);

    let mut host = user.host(host_id).await?;

    host.cancel_app(&mut user).await?;

    Ok(Json(PostCancelResponse { success: true }))
}

fn host_user_profile() -> PathBuf {
    if let Ok(user_profile) = env::var("USERPROFILE") {
        PathBuf::from(user_profile)
    } else {
        PathBuf::from(r"C:\Users\Public")
    }
}

#[cfg(windows)]
fn desktop_known_folder_path() -> Option<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use std::{ffi::OsString};

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::System::RemoteDesktop::{
        WTSGetActiveConsoleSessionId, WTSQueryUserToken,
    };
    use windows_sys::Win32::UI::Shell::{FOLDERID_Desktop, KF_FLAG_DEFAULT, SHGetKnownFolderPath};
    use windows_sys::core::PWSTR;

    unsafe fn pwstr_to_path(pwstr: PWSTR) -> Option<PathBuf> {
        if pwstr.is_null() {
            return None;
        }

        // SHGetKnownFolderPath returns an allocated PWSTR that must be freed with CoTaskMemFree.
        let mut len = 0usize;
        while unsafe { *pwstr.add(len) } != 0 {
            len += 1;
        }

        let wide = unsafe { std::slice::from_raw_parts(pwstr, len) };
        let path = PathBuf::from(OsString::from_wide(wide));
        unsafe { CoTaskMemFree(pwstr as _) };
        Some(path)
    }

    unsafe fn desktop_from_token(token: HANDLE) -> Option<PathBuf> {
        let mut pwstr: PWSTR = std::ptr::null_mut();
        let hr = unsafe {
            SHGetKnownFolderPath(
            &FOLDERID_Desktop,
            KF_FLAG_DEFAULT as u32,
            token,
            &mut pwstr,
        )
        };
        if hr != 0 || pwstr.is_null() {
            return None;
        }
        unsafe { pwstr_to_path(pwstr) }
    }

    unsafe {
        // Best-effort: use the currently active interactive user, which is important when the host runs as a service.
        let session_id = WTSGetActiveConsoleSessionId();
        let mut token: HANDLE = std::ptr::null_mut();
        if WTSQueryUserToken(session_id, &mut token) != 0 {
            let path = desktop_from_token(token);
            CloseHandle(token);
            if path.is_some() {
                return path;
            }
        }

        // Fallback: try the current process token.
        desktop_from_token(std::ptr::null_mut())
    }
}

#[cfg(not(windows))]
fn desktop_known_folder_path() -> Option<PathBuf> {
    None
}

fn get_downloads_dir() -> PathBuf {
    host_user_profile().join("Downloads")
}

fn validate_rel_path_segment(seg: &str) -> Result<(), AppError> {
    if seg.is_empty() {
        return Err(AppError::BadRequest);
    }
    for c in seg.chars() {
        if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() {
            return Err(AppError::BadRequest);
        }
    }
    let upper = seg.to_ascii_uppercase();
    if matches!(
        upper.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6"
            | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6"
            | "LPT7" | "LPT8" | "LPT9"
    ) {
        return Err(AppError::BadRequest);
    }
    Ok(())
}

/// Resolves upload directory from a relative path such as `Desktop` or `Documents\Work` (URL-encoded).
/// Optional header `X-Host-Relative-Dir`. Missing or empty => `Desktop`.
fn resolve_host_upload_directory(relative_dir_header: Option<&str>) -> Result<PathBuf, AppError> {
    let base = host_user_profile();

    let decoded: String = match relative_dir_header {
        None => {
            return Ok(desktop_known_folder_path().unwrap_or_else(|| base.join("Desktop")))
        }
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                return Ok(desktop_known_folder_path().unwrap_or_else(|| base.join("Desktop")));
            }
            urlencoding::decode(t)
                .map(|cow| cow.into_owned())
                .unwrap_or_else(|_| t.to_string())
        }
    };

    let mut dir = base.clone();
    let mut is_first_meaningful_segment = true;
    for part in decoded.split(|c| c == '/' || c == '\\') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(AppError::BadRequest);
        }

        // Support `Desktop` as the first segment using Windows Known Folder resolution.
        if is_first_meaningful_segment && part.eq_ignore_ascii_case("Desktop") {
            dir = desktop_known_folder_path().unwrap_or_else(|| base.join("Desktop"));
            is_first_meaningful_segment = false;
            continue;
        }

        validate_rel_path_segment(part)?;
        dir.push(part);
        is_first_meaningful_segment = false;
    }

    Ok(dir)
}

fn sanitize_filename(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            out.push('_');
        } else {
            out.push(c);
        }
    }
    let trimmed = out.trim().trim_matches('.');
    let safe = if trimmed.is_empty() { "upload.bin" } else { trimmed };
    safe.to_string()
}

async fn unique_target_path(base_dir: &Path, file_name: &str) -> PathBuf {
    let candidate = base_dir.join(file_name);
    if fs::metadata(&candidate).await.is_err() {
        return candidate;
    }

    let input_path = Path::new(file_name);
    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("upload");
    let ext = input_path.extension().and_then(|s| s.to_str()).unwrap_or("");

    for idx in 1..10000 {
        let numbered = if ext.is_empty() {
            format!("{stem} ({idx})")
        } else {
            format!("{stem} ({idx}).{ext}")
        };
        let next = base_dir.join(numbered);
        if fs::metadata(&next).await.is_err() {
            return next;
        }
    }

    base_dir.join(format!("{stem}_{}", uuid::Uuid::new_v4()))
}

#[post("/host/upload")]
pub async fn upload_host_file(
    _user: AuthenticatedUser,
    req: HttpRequest,
    mut payload: Payload,
) -> Result<HttpResponse, AppError> {
    let raw_name = req
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("upload.bin");
    let decoded_name = urlencoding::decode(raw_name)
        .map(|name| name.into_owned())
        .unwrap_or_else(|_| raw_name.to_string());
    let file_name = sanitize_filename(&decoded_name);

    let rel_dir = req
        .headers()
        .get("x-host-relative-dir")
        .and_then(|v| v.to_str().ok());
    let upload_dir = resolve_host_upload_directory(rel_dir)?;
    fs::create_dir_all(&upload_dir)
        .await
        .map_err(AppError::Io)?;
    let target_path = unique_target_path(&upload_dir, &file_name).await;

    let mut file = File::create(&target_path).await.map_err(AppError::Io)?;
    let mut total_written: u64 = 0;
    while let Some(chunk) = payload.next().await {
        let chunk = chunk.map_err(|_| AppError::BadRequest)?;
        file.write_all(&chunk).await.map_err(AppError::Io)?;
        total_written += chunk.len() as u64;
    }
    file.flush().await.map_err(AppError::Io)?;

    info!(
        "[Upload]: saved file to {} ({} bytes)",
        target_path.display(),
        total_written
    );

    Ok(HttpResponse::Ok().finish())
}

/// Writes raw UTF-8 body to a fixed file in the host downloads folder (clipboard sync from browser).
#[post("/host/clipboard")]
pub async fn sync_host_clipboard(
    _user: AuthenticatedUser,
    mut payload: Payload,
) -> Result<HttpResponse, AppError> {
    let downloads_dir = get_downloads_dir();
    fs::create_dir_all(&downloads_dir)
        .await
        .map_err(AppError::Io)?;
    let target_path = downloads_dir.join("moonlight-clipboard-sync.txt");

    let mut file = File::create(&target_path).await.map_err(AppError::Io)?;
    let mut total_written: u64 = 0;
    while let Some(chunk) = payload.next().await {
        let chunk = chunk.map_err(|_| AppError::BadRequest)?;
        file.write_all(&chunk).await.map_err(AppError::Io)?;
        total_written += chunk.len() as u64;
    }
    file.flush().await.map_err(AppError::Io)?;

    info!(
        "[Clipboard]: wrote {} bytes to {}",
        total_written,
        target_path.display()
    );

    Ok(HttpResponse::Ok().finish())
}
