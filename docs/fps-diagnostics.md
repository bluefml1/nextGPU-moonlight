# FPS diagnostics (client + host)

## Three FPS numbers

| Name | Source | Meaning |
|------|--------|---------|
| **Requested** | `settings.fps` → `StartStream` | What the web client asks the host to stream |
| **Negotiated** | `ConnectionComplete.fps` → stats `videoFps` | What the host reports after connect |
| **Measured** | WebRTC `framesPerSecond` → stats `webrtcFps` | What the browser decodes/displays (often ~monitor Hz) |

The stats HUD chip shows **measured** when WebRTC stats are available.

## F12 console

Filter the console with **`FPS`**.

| Log stage | When |
|-----------|------|
| `settingsResolved` | Stream page loads settings before connect |
| `StartStream` | Client sends Moonlight start (includes `requested=`) |
| `ConnectionComplete` | Host reports `negotiated=`; includes `hostFix=softBitrateReconfigure`; **warn** if ≠ requested |
| `webrtcInbound` | First inbound RTP `framesPerSecond`; `note=hudWillPreferMeasured`; optional `gap=` vs negotiated |
| `periodic` | ~5s or when measured FPS changes / disagrees with negotiated |
| `periodicDeliveryOk` | Once when measured ≈ negotiated (`delivery=ok`) |
| `periodicDeliveryGap` | After 2+ periodic samples with measured &lt; ~70% of negotiated (`deliveryGap=likelyHostEncode`) |
| `bitrateApplied` | Host ack after HUD bitrate change (`note=hostUsesSoftNvencReconfigure`) |

Inspect live values: `window.__mlFpsDebug` (`hostFix`, `deliveryNote`)

### Realtime-bitrate fork / measured ~67 with negotiated 118

If **negotiated** is correct (e.g. 118) but **measured** WebRTC FPS stays ~65–67 **without** moving the bitrate slider, the host was likely applying **stale realtime bitrate** at connect with a **full NvEnc encoder reset**. Patched Sunshine uses **soft** reconfigure (`resetEncoder=0`), drains the bitrate queue at session start, and skips reconfigure during the first ~60 encode frames. Sunshine log strings: `Discarded stale realtime bitrate`, `Skipped bitrate reconfigure`, `soft, no encoder reset`.

## Manual: verify client FPS (`mlSettings`)

In DevTools on the stream page:

```js
JSON.parse(localStorage.getItem("mlSettings"))?.fps
```

Set the desired value in **Stream settings → Fps**, save, then reconnect. FPS is fixed at **`StartStream`** until you reconnect.

Precedence: `mlSettings` → legacy per-app map → `web/app_settings.json` → `web/default_settings.ts` (118).

## Manual: Sunshine host log during a **live stream**

**Do not** use startup lines like `Trying encoder [nvenc]` with `Requested frame rate [60/1 exactly 60 fps]` — that is **encoder self-test** (hardcoded 60), not your session.

While streaming, grep Sunshine logs for:

```
Requested frame rate
```

- `[60/1 exactly 60 fps]` while you wanted 118+ → fix client settings (`mlSettings`).
- `[118/1…]` or `[120/1…]` but HUD ~60–65 → likely **measured** / 60 Hz client display, not host encode.
- `Screen capture may be capped to 60fps` → Windows WGC capture limit (check capture backend in session).

Also check host display refresh in the same log block (`Display refresh rate […Hz]`).

## Profile presets

`ENABLE_STREAM_PROFILE_GATE` in `web/stream.ts` runs `stream_profile_presets.ts` before each stream (picker or `?profile=`); chosen preset sets `mlSettings` fps/bitrate used by `StartStream`.
