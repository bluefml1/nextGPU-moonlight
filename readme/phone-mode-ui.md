# Phone Mode UI

This document describes the phone / mobile streaming UI that activates automatically when the client detects a phone-like device: touch defaults, radial FAB menu, on-screen keyboard, and virtual controller.

Primary sources live under `web/` (runtime mirrors under `static/` / `dist/`).

---

## Overview

When `isPhoneLikeDevice()` is true, the stream is already set up for phone use — no mode select required.

```
On phone-like devices (automatic)
  ├─ Default touchMode = Touch
  ├─ Single radial FAB (bottom-right) → expands to:
  │    Keyboard | Virtual Controller | HUD | Mouse (Touch ↔ Follow)
  ├─ Hide desktop settings FAB
  └─ Hide HUD fullscreen button
```

---

## Phone-like device detection

**Function:** `isPhoneLikeDevice()` in `web/stream.ts`

A device is treated as phone-like when it has touch points **and** one of:

- `pointer: coarse`, or
- iPad-like (`/iPad/` UA, or `MacIntel` + `maxTouchPoints > 1`), or
- Android/Tablet UA with a touch-primary pointer profile

**Effects when true:**

1. Default `touchMode` is `"touch"` (unless overridden in `localStorage`)
2. Desktop “❮” settings quick button is hidden
3. Radial mobile FAB menu is shown
4. Fullscreen toggle in the HUD tray is hidden

This is not a user toggle; it runs on load.

---

## Radial FAB menu

**Where:** `web/mobile_fab_menu.ts`, CSS `.ml-mobile-fab*` in `web/styles/moonlight.css` / `standard.css`  
**Wired from:** `ensureMobileFabMenu()` in `web/stream.ts`  
**Root id:** `#ml-mobile-fab-menu`

One primary FAB (draggable) replaces the old separate keyboard/controller buttons. Tap to expand a compact 90° arc of action buttons toward free screen space (adapts when you move the FAB); tap again or tap outside to dismiss.

**Hold (~350 ms)** shows only the **last chosen** action; slide your finger onto it and release to activate (quick repeat). If nothing was chosen yet, hold opens the full fan. Last action is stored as `ml.mobileFab.lastAction.v1`.

### Primary FAB

- ~48×48 circular solid red (`#E24B4A`) button, white list icon, no border or shadow
- Safe-area aware positioning; `z-index: 210000`
- Drag to reposition; hold for last-action quick pick; tap for full fan

### Actions (satellites ~40×40)

Flat dark circles (`#14140f`, `0.5px` hairline border) on an equal-radius 90° fan. Arc direction follows FAB position (e.g. bottom-right → left/up; bottom-left → right/up; top corners fan downward):

| Order (arc) | Action | Behavior |
|-------------|--------|----------|
| 1 (left) | **Keyboard** | Toggle on-screen keyboard |
| 2 | **Controller** | Toggle virtual controller overlay |
| 3 | **Mouse** | Toggle **Touch** ↔ **Follow** (`mouseFollow`). Phone-only software cursor overlay; touchpad-style drag + tap at cursor. |
| 4 (up) | **HUD** | Show / hide stream overlay chrome on **phone only**. Persisted as `ml.streamHudVisible.phone` (does not affect desktop HUD). |

Active state uses a slightly brighter hairline border only (no glow/shadow).

---

## Touch Mode

**Config:** `StreamInputConfig.touchMode` in `web/stream/input.ts`  
**Default on phone:** `"touch"` via `defaultStreamInputConfigForDevice()`  
**Persistence:** `localStorage` key `mlStreamInputModes` (`mouseMode` + `touchMode`)

| Mode | Behavior |
|------|----------|
| **Touch** | Native host touch packets (coords, force, radius, rotation) over the TOUCH data channel |
| **Follow** (FAB Mouse) | Touchpad-style: drag moves cursor by delta (finger ≠ cursor); tap clicks at cursor. Host-shaped overlay when host cursor visible. |
| **Relative** | Emulates relative mouse movement from finger drag |
| **Point and Drag** | Absolute point, then drag |

If the host reports `capabilities.touch === false`, **Touch** is disabled and input falls back to Relative.

### Gestures (Follow / Relative / Point and Drag)

| Gesture | Result |
|---------|--------|
| 1 finger short tap | Left click at cursor |
| 1 finger long press (~>350 ms), release without moving | Right click at cursor |
| Finger drag (before long-press time) | Move cursor only |
| Long press, then move | Left button down and drag |
| Move past click threshold | Relative move or drag |
| Double-tap (Relative) | Start drag (hold LMB) |
| 2 fingers | Scroll (high-res or normal per mouse scroll setting) |
| 3 fingers + swipe up/down ~100 px | Show / hide on-screen keyboard |

### Software cursor (phone only)

**Where:** `web/software_cursor.ts` (`#ml-software-cursor`)

Not used on desktop — PC relies on the normal CSS host cursor. Only shown on phone-like devices., fed by `web/host_cursor_frame.ts`

| Mode | Overlay |
|------|---------|
| **Touch** | Off |
| **Follow** (FAB Mouse) | Host-shaped cursor when host reports visible; hides when host cursor hidden |
| **Relative / Point and Drag** (Settings) | Default arrow cursor while in mouse-emulation mode |

Follow mode: drag anywhere on the stream to move the cursor (touchpad-style); tap clicks at the cursor hotspot, not under your finger. Absolute coords go to the host so the in-stream cursor chases the local overlay.

---

## On-screen keyboard

**Where:** `web/screen_keyboard.ts`, CSS `.ml-screen-keyboard*`

### How to open / close

| Open | Close |
|------|--------|
| Radial FAB → Keyboard | × button |
| 3-finger swipe up (mouse-emulation touch modes) | Tap outside / swipe down / FAB again |

---

## Virtual controller overlay

**Where:** `web/virtual_controller_overlay.ts`  
**Open via:** Radial FAB → Controller

Includes layout editor (⚙ FAB): drag/resize/enable controls, key binds, WASD stick, reset/apply.

**Storage:** `ml.virtualController.layout.v1`, `ml.virtualController.settingsFab.v1`

---

## Related mobile-aware UI

| Feature | Phone relevance | Location |
|---------|-----------------|----------|
| **Stats overlay** | Coarse sizing + safe-area | `web/stream.ts`, see also `readme/stats-overlay.md` |
| **Bitrate HUD / toasts** | Safe-area bottom offset; touch-friendly slider | `web/component/realtime_bitrate_hud.ts` |
| **Viewport / PWA** | No pinch-zoom on stream; `viewport-fit=cover` | `web/stream.html`, `web/manifest.json` |
| **Landscape keyboard** | Compact keys when landscape + short height | CSS |

---

## Persistence keys (mobile-relevant)

| Key | Purpose |
|-----|---------|
| `mlStreamInputModes` | Saved `mouseMode` + `touchMode` |
| `ml.streamHudVisible.phone` | Phone FAB HUD cluster visible (`"0"` / `"1"`); legacy `ml.streamHudVisible` migrated on read |
| `ml.mobileFab.pos.v1` | Draggable FAB position |
| `ml.mobileFab.lastAction.v1` | Last FAB action for hold + slide quick pick |
| `ml.virtualController.layout.v1` | Virtual controller layout |
| `ml.virtualController.settingsFab.v1` | VC settings FAB position |
| `streamStatsMinimized` / `streamStatsExpanded` | Stats chrome |

---

## Source map

| Area | TypeScript | Styles |
|------|------------|--------|
| Device detection, FAB wiring | `web/stream.ts` | — |
| Radial FAB menu | `web/mobile_fab_menu.ts` | `.ml-mobile-fab*` |
| Touch / mouse / virtual gamepad input | `web/stream/input.ts` | — |
| On-screen keyboard | `web/screen_keyboard.ts` | `.ml-screen-keyboard*` |
| Virtual controller | `web/virtual_controller_overlay.ts` | `.ml-virtual-controller*` |
