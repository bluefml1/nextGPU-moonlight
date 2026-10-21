# Bitrate change — flow and performance

This document describes how **target video encode bitrate** is changed in the current tree.

For overlay HUD UI details, see [realtime-bitrate-hud.md](./realtime-bitrate-hud.md).

> **Note:** The realtime path (`SetVideoBitrate` on the WebRTC general channel → streamer HTTPS POST → Sunshine `/api/ml-stream-bitrate` → NVENC reconfigure with `resetEncoder=1` + forced IDR) was **removed** because each change cost encoder performance. Bitrate is now fixed per stream, like upstream moonlight-web (MrCreativ).

---

## Ways bitrate is set

| When | Mechanism | Transport | Effect |
|------|-----------|-----------|--------|
| **Session start / profile gate** | `StartStream.bitrate` (Mbps → kbps) | Signaling WebSocket (`wss://…/api/host/stream`) | Host encoder configured when the Moonlight/RTSP session starts |
| **Overlay HUD (Apply)** | `applyOverlayBitrate` → `restartStreamWithNewSettings` | Stop on general channel, then a new WebSocket + `StartStream` | Restarts the stream in-page; does **not** re-show the profile gate |
| **Settings modal (Apply)** | `onApply` → `restartStreamWithNewSettings` | Same as above | Same restart; editing the field without Apply changes nothing live |

---

## Restart sequence

### Client — `web/stream.ts`

1. `restartStreamWithNewSettings(settings)` returns `false` immediately if `restartInFlight` or `startupInProgress` is set, so overlapping Apply clicks cannot start two restarts.
2. Shows the startup progress overlay, unmounts the old `Stream`, and sends `Stop` (bounded by a timeout).
3. Waits `RESTART_SETTLE_MS` (1 s) so the old streamer releases the Moonlight session.
4. Calls `startStream`, which opens a **new** signaling WebSocket and sends `StartStream` with the new `bitrate`. The profile gate is not shown (it only runs in `startApp()`).
5. On `connectionComplete`, the HUD is re-enabled and the committed value is updated.

The WebSocket behaviour is unchanged: 30 s keep-alive pings, and a proxy closing the socket after the stream started does not stop the stream. Each restart uses a fresh socket.

### Web server — `src/api/stream.rs`, `src/stream_sessions.rs`

`StreamSessionRegistry` keeps a per-host streamer registry:

- `register_streamer` / `unregister_streamer` — every launched streamer registers its IPC stop sender; it unregisters when its IPC receiver closes.
- `host_session_live` — `true` while any streamer of the current epoch is registered, or the last one ended less than **60 s** ago.
- `stop_streamers(host, 5 s)` — sends `ServerIpcMessage::Stop` to each registered streamer and waits (≤ 5 s) for them to unregister.
- `reset_host` — bumps the epoch so ended sessions no longer count as live.

On each new `StartStream`:

1. **Prep guard:** if `host_session_live`, `startSession.ps1` is skipped ("host session live, skipping prep"). The Windows user profile is therefore not re-prepared during a live rental restart.
2. **Supersede:** `stop_streamers` stops any streamer still running for the host (for example when the old WebSocket was already gone), so two streamers never overlap.
3. Launches the new streamer and registers it.

### CleanSession — `POST /host/cancel`

`cancel_host` calls `reset_host` then `stop_streamers` before cancelling sessions and running `cancelSession.ps1`. After CleanSession the host is no longer "live", so the next `StartStream` runs `startSession.ps1` again as a fresh rental.

---

## Performance impact

- **During a stream:** none from bitrate. The encoder runs at the bitrate negotiated at session start; there are no reconfigures, no extra IDR frames and no HTTPS calls from the streamer.
- **On Apply:** one stream restart (typically a few seconds of the progress overlay). This is the same cost as reconnecting with a new bitrate.

---

## Host-side checks (outside this repo)

- The Sunshine fork should not run its end-session script on a plain client disconnect; otherwise a restart would tear down the user profile.
- Sunshine's own ABR should be disabled if the bitrate must stay exactly at the requested value.
- The `/api/ml-stream-bitrate` route and mail queue in the Sunshine fork are no longer called by this client.

---

## File index

| File | Role |
|------|------|
| `web/component/realtime_bitrate_hud.ts` | Overlay HUD |
| `web/stream.ts` | Tray, Apply → `restartStreamWithNewSettings` |
| `web/stream/index.ts` | `StartStream`, `stop()`, `getSessionBitrateMbps()` |
| `web/component/settings_menu.ts` | Bitrate Mbps, `showStreamBitrateHud` |
| `src/api/stream.rs` | Prep guard, previous-streamer stop, `cancel_host` |
| `src/stream_sessions.rs` | Streamer registry and host-session liveness |
| `docs/realtime-bitrate-hud.md` | HUD-focused doc |
