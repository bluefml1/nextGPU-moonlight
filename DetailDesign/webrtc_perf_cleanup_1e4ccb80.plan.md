---
name: webrtc perf cleanup
overview: "Reduce avoidable CPU/main-thread overhead in the WebRTC streaming path: globally minimize hot-path logs, stop noisy stats logging, avoid polling stats when nothing consumes them, fix a listener leak on transport swaps, and prevent overlapping stats polls."
todos:
  - id: minimal-logs-global
    content: "Introduce a single minimalLogs switch (default true) that gates all hot-path logger?.debug/console.debug calls in webrtc.ts and stats paths; keep warn/error and fatal/recovery messages always-on"
    status: pending
  - id: gate-raw-stats-logs
    content: Gate raw video-stats console.debug spam in WebRTCTransport.getStats() behind the same minimalLogs switch (default off)
    status: pending
  - id: throttle-ice-pair-log
    content: Throttle selectedPairLogTimer from 2s to 10s and only log on pair-signature change
    status: pending
  - id: stats-on-demand
    content: Stop auto-enabling stats polling at stream start; enable only when stats widget is shown, disable when closed
    status: pending
  - id: fix-listener-leak
    content: Cache bound onRawData handler in StreamStats so add/removeReceiveListener match (no listener leaks across transport swaps)
    status: pending
  - id: no-overlap-polls
    content: Add in-flight guard and proper await in StreamStats.updateLocalStats to avoid overlapping polls when getStats() is slow
    status: pending
  - id: smoke-validate
    content: "Manual smoke: stable stream with DevTools open, stats toggle on/off, transport restart -> verify no log spam, single listener, no UX regression"
    status: pending
isProject: false
---


# WebRTC Streaming Performance Cleanup

## Findings (with concrete locations)

1. Noisy stats logging on every poll
   - In [web/stream/transport/webrtc.ts](web/stream/transport/webrtc.ts) `getStats()` logs raw video stats every call:
     - `console.debug("----------------- raw video stats -----------------")`
     - `console.debug("raw video stats", key, value)` for every `RTCStats` entry
   - Polled at ~1 Hz from `StreamStats.updateLocalStats` and additionally at 0.5 Hz from `ViewerApp.statsUpdateInterval` -> dozens of `console.debug` lines per second; expensive when DevTools is open.

2. Periodic ICE candidate-pair logging during stable session
   - `selectedPairLogTimer = window.setInterval(... logSelectedCandidatePairDetails(), 2000)` in `onConnectionStateChange()` calls `peer.getStats()` every 2s and logs full `JSON.stringify(details)` even when nothing is wrong.

3. Stats engine always-on
   - In [web/stream.ts](web/stream.ts) `startStream(...)` calls `this.stream.getStats().setEnabled(true)`, so `setInterval(updateLocalStats, 1000)` and the `STATS` data channel listener run for the whole session even if the user never opens the stats widget.

4. Listener leak in stats wiring
   - In [web/stream/stats.ts](web/stream/stats.ts) `checkEnabled()` does:
     - `this.statsChannel.removeReceiveListener(this.onRawData.bind(this))`
     - `channel.addReceiveListener(this.onRawData.bind(this))`
   - Each `bind` creates a new function instance, so the remove never matches the added listener. After a transport switch (WebRTC -> WebSocket fallback or restart), old listeners stay attached and parse stats packets twice.

5. Overlapping stats polls on slow `getStats()`
   - `StreamStats.updateLocalStats()` does `Promise.all([...])` but is not awaited by the interval; if `transport.getStats()` takes longer than 1s (devtools, mobile), ticks pile up.

6. Console-debug paths on hot logs
   - `Stream.updateTransportStats()` uses `console.debug("Cannot query stats without transport")`, harmless but consistent with cleanup theme.

## Proposed implementation (low-risk, no UX change)

- Add a single global minimal-logs switch for the WebRTC frontend hot paths:
  - In [web/stream/transport/webrtc.ts](web/stream/transport/webrtc.ts), introduce `private readonly minimalLogs = true` (mirrors existing flag in [web/stream/index.ts](web/stream/index.ts)).
  - Wrap noisy informational `this.logger?.debug(...)` calls (ICE candidate emit/drop, queue/buffer status, NAT mapping/path-score logs, signaling state changes, gathering state changes, file-transfer progress) behind `if (!this.minimalLogs) { ... }`.
  - Always preserve: warn/error paths, fatal/recovery messages, first-time `connectedOnce` transition note, and `OnConnectionStateChange` final state log.
  - In [web/stream/stats.ts](web/stream/stats.ts), gate `console.debug("Cannot query stats without transport")` and similar diagnostics behind the same minimal-logs check (passed in or read off the transport/logger).

- Gate raw stats spam behind the minimal-logs switch in `WebRTCTransport.getStats()` ([web/stream/transport/webrtc.ts](web/stream/transport/webrtc.ts)):
  - Replace the unconditional `console.debug("----------------- raw video stats -----------------")` and per-entry `console.debug("raw video stats", ...)` with a check like `if (!this.minimalLogs) { ... }`, default suppressed. Keep stat extraction logic untouched.

- Throttle/disable steady-state ICE pair logging:
  - Reduce `selectedPairLogTimer` from `2000ms` to `10000ms` and only emit a log when the pair signature actually changes (already partially tracked via `lastLoggedPairSignature`). No change to recovery/decision logic.

- Stats polling on demand only ([web/stream.ts](web/stream.ts) and [web/stream/stats.ts](web/stream/stats.ts)):
  - Remove `this.stream.getStats().setEnabled(true)` from `startStream(...)`.
  - In `ViewerApp.toggleStatsWidgetVisibility()` and the existing stats overlay show path, ensure `stats.setEnabled(true)` is called when the widget is opened and `setEnabled(false)` when closed.
  - `ConnectionStatusUpdate`-driven UI does not depend on this polling; it is delivered via the GENERAL channel, not local stats.

- Fix bound-listener leak in [web/stream/stats.ts](web/stream/stats.ts):
  - Cache the bound handler once, e.g. `private onRawDataBound = this.onRawData.bind(this)`, and use that for both `addReceiveListener` and `removeReceiveListener`.

- Prevent overlapping polls in [web/stream/stats.ts](web/stream/stats.ts):
  - Track a `private statsUpdateInFlight = false` flag in `updateLocalStats`; if true, skip this tick. `await Promise.all([...])` instead of fire-and-forget, then clear the flag in `finally`.

## Files to change

- [web/stream/transport/webrtc.ts](web/stream/transport/webrtc.ts)
- [web/stream/stats.ts](web/stream/stats.ts)
- [web/stream.ts](web/stream.ts)

## Out of scope (intentionally)

- ICE/relay race tuning, jitter buffer settings, codec selection, video pipeline changes.
- Streamer-side (Rust) stats/logging cadence.
- Any change to user-visible recovery popup or fullscreen/pointer-lock overlay logic (already handled in prior fixes).

## Validation

- DevTools closed: confirm no perceivable change in latency/FPS during stable stream.
- DevTools open: confirm console output during streaming is minimal (only warn/error and connect/recover state lines; no per-second raw stats dump, no per-candidate ICE chatter).
- Toggle `minimalLogs = false` locally: verify previous verbose logs return so debugging stays possible.
- Open stats widget: confirm values populate within ~1s and stop updating when closed.
- Transport restart (WebRTC retry / WS fallback): confirm only one stats listener is attached after restart (verifiable by counting `onRawData` invocations per stats packet during a brief instrumented run, then revert).
