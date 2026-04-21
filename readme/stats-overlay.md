# Stream Stats Overlay

This document describes the in-stream stats overlay, what is rendered in each section, and where each metric comes from.

## Goals

- Keep stats visible without distracting gameplay or video content.
- Show friendly, high-value information first.
- Allow quick expansion for detailed diagnostics (including ICE route details).

## User Experience

When Stats is enabled from the sidebar, the viewer shows a compact top bar. The top bar is the primary render target for end users and is designed to stay readable without blocking gameplay.

- Quality (`Smooth`, `Okay`, `Poor`) with a small status dot
- Latency (`ms`)
- FPS (`fps`)
- Bitrate (`Mbps`, estimated from live ICE byte deltas)

Clicking the bar expands a detail panel with grouped sections. The expanded panel is for diagnostics and keeps the top bar unchanged.

- Connection (Most Important)
- ICE / Route
- Video

Expanded state is persisted in `localStorage` under `streamStatsExpanded`.

## Rendered Metrics

### Compact top bar (always visible when stats are on)

- `Quality`: Calculated label using latency + packet loss + dropped frame thresholds.
- `Latency`: `streamerRttMs` (fallback to browser RTT when needed).
- `FPS`: WebRTC FPS (`webrtcFps`) or target stream FPS fallback.
- `Bitrate`: Calculated Mbps from the change in `iceBytesReceived` over time.

### Expanded panel

#### Connection (Most Important)

- RTT
- Variance
- Bitrate
- FPS
- Packet Loss
- Jitter

#### ICE / Route

- Pair state
- Protocol
- Candidate type (`local -> remote`)
- Local host (`address:port`)
- Remote host (`address:port`)
- Local network type

#### Video

- Codec
- Resolution
- HDR status

## Visual Rules (non-intrusive by design)

- Dark gradient top bar with subtle glass blur
- Soft border and shadow for separation from bright backgrounds
- No aggressive glow or neon text
- Compact system font at `12px` with smaller label text
- Status color only on a small dot (text stays neutral)

These rules are implemented for both themes:

- `web/styles/standard.css`
- `web/styles/moonlight.css`

## Data Sources

- Core stream stats come from `StreamStats` in `web/stream/stats.ts`.
- Overlay rendering is handled in `ViewerApp` in `web/stream.ts`.
- ICE route metrics are pulled from WebRTC peer stats in `web/stream/transport/webrtc.ts`.
- Bitrate is computed in `ViewerApp` from sampled `iceBytesReceived` values.
- Unknown or invalid metric values are normalized to `N/A` before rendering.

## Tooltips and Readability

- Every top-bar chip and expanded metric row includes a short `title` tooltip.
- Tooltips explain each metric in plain language for end users.
- Tooltip text is intentionally brief so users do not need external docs while streaming.
