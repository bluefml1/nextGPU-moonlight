---
name: stable signaling negotiation
overview: "Eliminate the offer/offer glare and post-connect renegotiations that cause the oscillating signaling state on every connection. Keep the polite-peer rollback as a safety net while making the actual negotiation path single-shot: streamer sends one offer, browser answers, no late SDP renegotiations after connect."
todos:
  - id: streamer-answer-offers
    content: In streamer/src/transport/webrtc/mod.rs, when a remote offer arrives, set remote desc and reply with an answer (replace the current send_offer-on-offer behavior)
    status: pending
  - id: browser-no-initial-offer
    content: "In web/stream/transport/webrtc.ts startSynchronizedNegotiation(): stop calling onNegotiationNeeded(); add guard in onNegotiationNeeded() to suppress browser-initiated offers in the normal sync flow"
    status: pending
  - id: predeclare-filetransfer
    content: "In web/stream/transport/webrtc.ts initPeer(): create fileTransfer data channel up-front; remove the post-connect lazy creation in onConnectionStateChange()"
    status: pending
  - id: verify-freeze-still-applies
    content: "Verify post-connect freeze guards still hold: ignore remote offer and skip onNegotiationNeeded after connectedOnce"
    status: pending
  - id: smoke-validate-signaling
    content: "Smoke test in chrome://webrtc-internals: confirm signaling state goes new -> have-remote-offer -> stable and stays stable, with file transfer working"
    status: pending
isProject: false
---


# Stable WebRTC Signaling (no glare, no late renegotiation)

## Root cause (verified in code)

1. Streamer turns "received offer" into another offer  
   In [streamer/src/transport/webrtc/mod.rs](streamer/src/transport/webrtc/mod.rs) `on_ws_message`:
   - When `remote_ty == RTCSdpType::Offer`, it calls `self.send_offer().await` instead of `set_remote_description + create_answer + set_local + send`. This guarantees glare on any browser-initiated offer.

2. Browser also kicks off an offer during sync handshake  
   In [web/stream/transport/webrtc.ts](web/stream/transport/webrtc.ts) `startSynchronizedNegotiation(...)`:
   - Calls `await this.onNegotiationNeeded()`, which always sends a local offer.
   - At the same moment streamer sends `SyncStart + send_offer`. Two offers in flight => glare.

3. Late post-connect renegotiations  
   - Browser creates `fileTransfer` data channel inside `onConnectionStateChange()` after `connected`:
     ```ts
     if (!this.fileTransferChannel) {
         this.fileTransferChannel = this.setupFileSender(this.peer)
     }
     ```
     `createDataChannel("fileTransfer")` triggers `negotiationneeded` and another offer.
   - Streamer adds tracks/data channels (audio/cursor/stats) post-init in some paths, triggering further offers.

4. Polite-peer rollback in `handleRemoteDescription` masks but does not remove the churn.

## Intended end state

- One side is the only initial offerer (streamer, since `SyncReady -> SyncStart + offer` already exists).
- All required tracks and data channels are declared before that first offer.
- Streamer correctly answers any browser-originated offer (defensive only) instead of creating glare.
- Polite-peer rollback stays as a defense, but should not actually fire in the normal flow.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant S as Streamer
    B->>S: SyncReady
    S-->>B: SyncStart
    S->>B: Offer "all tracks + data channels"
    B-->>S: Answer
    Note over B,S: stable; no further SDP exchange
```

## Proposed implementation

### Streamer: never reply to an offer with another offer
- File: [streamer/src/transport/webrtc/mod.rs](streamer/src/transport/webrtc/mod.rs)
- In `on_ws_message` `Description` branch:
  - Replace the "if Offer -> send_offer" block with: set the remote description, then create + set + send an answer.
  - Keep `Answer` branch as today (just `set_remote_description`).
- Result: even if the browser sends an unexpected offer, no glare is generated.

### Browser: do not send a local offer in the sync path
- File: [web/stream/transport/webrtc.ts](web/stream/transport/webrtc.ts)
- In `startSynchronizedNegotiation(...)`:
  - Remove `await this.onNegotiationNeeded()`. The streamer is the offerer; browser only flushes buffered ICE candidates and waits for the remote offer.
- In `onNegotiationNeeded()`:
  - Add an early return guard `if (!this.connectedOnce && this.iceMode != "relay-only" && !this.allowBrowserInitiatedNegotiation) return`.
  - `allowBrowserInitiatedNegotiation` defaults to `false`; only `relay-only` fallback or future explicit needs flip it.
- Effect: browser never offers first; glare cannot arise from the browser side.

### Pre-declare the fileTransfer channel before the first SDP
- Files: [web/stream/transport/webrtc.ts](web/stream/transport/webrtc.ts)
- In `initPeer(...)`, after `this.initChannels()` and before sync timer starts, create the fileTransfer data channel up-front:
  - `this.fileTransferChannel = this.setupFileSender(this.peer)`
- Remove the lazy creation inside `onConnectionStateChange()` (the post-connect block).
- This makes fileTransfer part of the initial offer/answer; no post-connect `negotiationneeded` fires.
- Streamer side already handles incoming `fileTransfer` channel via `onDataChannel`, so no Rust change is needed for this.

### Hard guard against unintended late SDP after connect (already partially in place)
- Keep current post-connect freeze:
  - Browser ignores remote `offer` after `connectedOnce` (already added).
  - Browser short-circuits `onNegotiationNeeded` after `connectedOnce` (already added).
- No change needed; this stays as the safety net even if some future code path adds a track late.

### Logging cleanup tied to this change
- Demote noisy state-change logs to a single connect-time summary; drop per-step `Changing Peer Ice State to ...` after first stable. (Keep warnings/errors.)
- This is optional and can be folded into the separate `webrtc perf cleanup` plan.

## Files to change

- [streamer/src/transport/webrtc/mod.rs](streamer/src/transport/webrtc/mod.rs)
- [web/stream/transport/webrtc.ts](web/stream/transport/webrtc.ts)

## Risks / trade-offs

- If any code path requires post-connect SDP renegotiation (e.g. dynamic codec switch), it will now be blocked by both the freeze and the offerer guards. Current code does not appear to do this; restart-with-new-settings tears down the peer entirely instead. Acceptable.
- Pre-declaring fileTransfer slightly increases SDP size on initial offer; negligible.
- If the streamer ever genuinely needs to be the answerer for a browser-driven feature, we will need to flip `allowBrowserInitiatedNegotiation` for that flow.

## Validation

- chrome://webrtc-internals: signaling state on a fresh connect should now read `new -> have-remote-offer -> stable` and stay stable.
- File transfer: drag-drop or paste continues to work without forcing renegotiation (verify `fileTransfer` channel state becomes `open` shortly after `connected`).
- Stream stability: no regression in time-to-first-frame, audio, cursor, or input.
- Reconnect path: `restartStreamWithNewSettings` still produces a single clean offer/answer.
- Relay-only fallback path still negotiates correctly (it currently uses the same flow; verify after toggling settings).
