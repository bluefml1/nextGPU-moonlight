---
name: Fix interruption popup logic
overview: "Apply aggressive post-connect freeze: after stream establishes, stop ICE/recovery activity and only show interruption UI for true terminal disconnects."
todos:
  - id: freeze-frontend-post-connect
    content: Enforce frontend post-connect freeze (ignore local and remote ICE candidate handling, disable ICE restarts and relay-unblock timers)
    status: pending
  - id: freeze-streamer-post-connect
    content: Enforce streamer post-connect freeze (stop emitting/forwarding AddIceCandidate and ignore late client ICE candidates after first stable connect)
    status: pending
  - id: disable-recovery-after-connect
    content: Disable reconnect/recovery flows after first successful connect (no ICE restart or renegotiation retries in frozen state)
    status: pending
  - id: tighten-interruption-popup
    content: Restrict interruption popup to terminal events only and remove triggers from non-terminal signaling/debug log text once connected
    status: pending
  - id: verify-freeze-scenarios
    content: Validate strict freeze behavior and terminal-failure popup behavior across WebRTC and WebSocket modes
    status: pending
isProject: false
---

# Aggressive Post-Connect ICE Freeze

## What I found
- The popup is shown in [`/Users/bluefml1/nextGPU-moonlight/web/stream.ts`](/Users/bluefml1/nextGPU-moonlight/web/stream.ts) from `ViewerApp.onInfo()` when:
  - debug line equals `"Web Socket Closed"` or `"Web Socket or WebRtcPeer Error"`
  - debug type is `fatal` / `fatalDescription`
  - `connectionStatus` text contains `terminated|failed|disconnected`
- In WebRTC mode, signaling WS can close while media still continues, so this condition can fire too early.
- Current behavior is immediate (no grace/debounce), so transient hiccups pop the overlay.
- `web/stream/transport/webrtc.ts` already has partial freeze behavior (`lockIceAfterConnected`), but not all related actions are fully halted end-to-end.

## Proposed implementation
1. **Enforce strict freeze after first successful connect (frontend)**
   - In [`/Users/bluefml1/nextGPU-moonlight/web/stream/transport/webrtc.ts`](/Users/bluefml1/nextGPU-moonlight/web/stream/transport/webrtc.ts), once `connectedOnce` becomes true:
     - no sending of additional local ICE candidates
     - no applying of remote late ICE candidates
     - no ICE restart scheduling and no relay candidate unblock/flush actions
   - Keep only passive state observation and terminal-close reporting.

2. **Enforce strict freeze after first successful connect (streamer)**
   - In [`/Users/bluefml1/nextGPU-moonlight/streamer/src/transport/webrtc/mod.rs`](/Users/bluefml1/nextGPU-moonlight/streamer/src/transport/webrtc/mod.rs):
     - stop emitting `AddIceCandidate` to frontend after stable connection
     - ignore late incoming `AddIceCandidate` from frontend after stable connection
   - Keep transport closure handling for real terminal failures.

3. **Disable reconnect/recovery actions once connected**
   - In frontend transport and stream orchestration (`web/stream/index.ts`, `web/stream/transport/webrtc.ts`), guard retry/restart paths with a post-connect freeze check so they do not re-negotiate after established state.

4. **Popup policy for aggressive freeze mode**
   - In [`/Users/bluefml1/nextGPU-moonlight/web/stream.ts`](/Users/bluefml1/nextGPU-moonlight/web/stream.ts), show `"Connection Interrupted"` only on explicit terminal events:
     - transport closed/failed in frozen mode
     - `ConnectionTerminated` and fatal server-termination events
   - Do not show popup from non-terminal debug text such as plain signaling WS close while media is still active.

5. **Validation**
   - WebRTC connect then late candidate arrival: no additional ICE processing.
   - WebRTC connect then transient signaling WS disturbance: no reconnect action, no false popup.
   - True transport failure after connect: popup shown once.
   - Initial connection failure before first connect: failure path still works and reports correctly.

## Key files to change
- [`/Users/bluefml1/nextGPU-moonlight/web/stream.ts`](/Users/bluefml1/nextGPU-moonlight/web/stream.ts)
- [`/Users/bluefml1/nextGPU-moonlight/web/stream/index.ts`](/Users/bluefml1/nextGPU-moonlight/web/stream/index.ts)
- [`/Users/bluefml1/nextGPU-moonlight/web/stream/transport/webrtc.ts`](/Users/bluefml1/nextGPU-moonlight/web/stream/transport/webrtc.ts)
- [`/Users/bluefml1/nextGPU-moonlight/streamer/src/transport/webrtc/mod.rs`](/Users/bluefml1/nextGPU-moonlight/streamer/src/transport/webrtc/mod.rs)
- (if needed for typed event wiring) [`/Users/bluefml1/nextGPU-moonlight/web/stream/transport/index.ts`](/Users/bluefml1/nextGPU-moonlight/web/stream/transport/index.ts)