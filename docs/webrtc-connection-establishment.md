# WebRTC Connection Establishment (Current Flow)

This document describes how WebRTC connection setup currently works in this repository, from browser startup to active audio/video streaming.

## Scope

- Browser transport implementation: `web/stream/transport/webrtc.ts`
- Browser stream orchestration: `web/stream/index.ts`
- Streamer WebRTC backend: `streamer/src/transport/webrtc/mod.rs`
- Streamer video track setup: `streamer/src/transport/webrtc/video.rs`

## 1) Browser receives setup and starts WebRTC

1. Browser receives `Setup` over websocket with ICE servers.
2. Browser normalizes ICE server list (single-host focus, UDP preference).
3. Browser selects WebRTC transport and calls `initPeer(...)` in `WebRTCTransport`.
4. Browser creates an `RTCPeerConnection` with:
   - `bundlePolicy = "max-bundle"`
   - `rtcpMuxPolicy = "require"`
   - ICE policy depending on mode (`prefer-direct` or `relay-only`)

## 2) Synchronized signaling startup

To avoid negotiation races, the browser and streamer use sync messages:

- Browser sends `SyncReady`.
- Streamer receives `SyncReady`, replies with `SyncStart`, then creates/sends offer.
- Browser starts synchronized negotiation when `SyncStart` arrives (or local timeout fires).

This logic is implemented by:

- Browser: `startSynchronizedNegotiation(...)`
- Streamer: `on_ws_message(...)` handling `SyncReady` / `SyncStart`

## 3) Offer/answer exchange

- Browser handles remote descriptions in `handleRemoteDescription(...)`.
- Streamer handles browser descriptions in `on_ws_message(...)`.
- Both sides exchange `Description` signaling messages via websocket.
- Browser uses glare-handling rollback when needed.

## 4) ICE candidate gathering and filtering

Both sides trickle ICE candidates via websocket (`AddIceCandidate`).

Current browser-side behavior:

- Drops TCP candidates.
- In `prefer-direct`, delays relay candidates briefly to give host/srflx/prflx a chance.
- Buffers candidates until remote description is ready.
- Flushes delayed relay candidates after the initial block window.
- Maintains candidate caps to reduce signaling noise.

## 5) Connection state and recovery

Browser monitors:

- `connectionstatechange`
- `iceconnectionstatechange`
- `icegatheringstatechange`

Recovery behavior:

- On `disconnected`/`failed`, browser schedules ICE restart (limited retries).
- Browser keeps logging selected candidate pair + path score metrics.

Streamer monitors:

- peer connection state and closes/terminates transport on failure paths.

## 6) Data channels and media channels

During peer init:

- Browser pre-creates configured data channels from `TRANSPORT_CHANNEL_OPTIONS`.
- Streamer creates `general` and `cursor` channels and registers handlers.
- Browser also accepts remotely created channels and maps by label.

Media:

- Browser receives inbound audio/video tracks (`onTrack`).
- Streamer registers codecs and creates RTP tracks during setup.

## 7) Stream start after WebRTC connect

After browser transport reaches connected:

1. Browser builds video/audio pipelines.
2. Browser computes codec intersection:
   - user codec hint
   - transport capabilities
   - pipeline/renderer capabilities
3. Browser sends `StartStream` with stream settings (bitrate/fps/size/codec bitmask/hdr/etc).

Streamer receives `StartStream` and:

- stores supported formats in transport video state,
- starts Moonlight stream,
- receives actual `VideoSetup` callback from host,
- creates media track codec based on selected runtime format.

## 8) Important codec behavior (current)

- The browser can request HEVC/H265 by setting `video_supported_formats` bits.
- Host-side stream setup may still return a different runtime format (for example H264 fallback).
- Transport video setup validates host-selected format against client-supported set.

If you are debugging H265/HDR behavior, check logs around:

- Browser: `Codec Hint by the user`, `Transport supports these video codecs`, `Stream video codec info`
- Streamer: `[Stream] Stream setup: ... and <format>`

## 9) Typical happy-path timeline

1. Websocket connected.
2. Setup received (ICE servers).
3. Browser creates peer and sends `SyncReady`.
4. Streamer sends `SyncStart` + offer.
5. Browser answers; both sides exchange ICE.
6. ICE reaches `connected`.
7. Browser builds pipelines and sends `StartStream`.
8. Streamer starts Moonlight and configures RTP tracks.
9. Browser receives tracks/channels and playback begins.

## 10) Common failure points

- ICE never reaches connected (NAT/srflx/relay issues).
- Signaling glare loops or stale descriptions.
- Codec mismatch between requested and host-selected runtime format.
- Host stream startup failure after `StartStream` accepted.

