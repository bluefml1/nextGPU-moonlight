import { StreamSignalingMessage, TransportChannelId } from "../../api_bindings.js";
import { Logger } from "../log.js";
import { StatValue } from "../stats.js";
import { allVideoCodecs, CAPABILITIES_CODECS, emptyVideoCodecs, maybeVideoCodecs, VideoCodecSupport } from "../video.js";
import { DataTransportChannel, Transport, TRANSPORT_CHANNEL_OPTIONS, TransportAudioSetup, TransportChannel, TransportChannelIdKey, TransportChannelIdValue, TransportVideoSetup, AudioTrackTransportChannel, VideoTrackTransportChannel, TrackTransportChannel, TransportShutdown } from "./index.js";

export type WebRTCIceMode = "prefer-direct" | "relay-only"

export class WebRTCTransport implements Transport {
    implementationName: string = "webrtc"

    private logger: Logger | null

    private peer: RTCPeerConnection | null = null
    private fileTransferChannel: RTCDataChannel | null = null

    onFileTransferProgress: ((direction: "send" | "receive", fileName: string, progressPercent: number) => void) | null = null
    onFileReceived: ((fileName: string, file: Blob) => void) | null = null

    // Prevent renegotiation spam: track whether a negotiation is already in progress
    private isNegotiating: boolean = false
    private iceMode: WebRTCIceMode = "prefer-direct"
    private emittedIceCandidateCount = 0
    private readonly maxLocalIceCandidates = 18
    private readonly maxHostCandidatesBeforeSrflx = 8
    private readonly maxBufferedRemoteCandidates = 64
    private readonly relayBlockWindowMs = 700
    private restartAttempts = 0
    private readonly maxRestartAttempts = 3
    private restartTimer: number | null = null
    private selectedPairLogTimer: number | null = null
    private lastLoggedPairSignature: string | null = null
    private lastLoggedMappingSignature: string | null = null
    private initialOfferSent = false
    private initialSrflxSeen = false
    private srflxWaiters: Array<() => void> = []
    private syncStarted = false
    private syncStartTimer: number | null = null
    private readonly syncStartTimeoutMs = 260
    private readonly remoteOfferAfterSyncTimeoutMs = 320
    private bufferedLocalCandidates: Array<RTCIceCandidateInit> = []
    private delayedLocalRelayCandidates: Array<RTCIceCandidateInit> = []
    private delayedRemoteRelayCandidates: Array<RTCIceCandidateInit> = []
    private readonly maxDelayedRelayCandidates = 32
    private relayUnblockTimer: number | null = null
    private relayBlockUntilMs = 0
    private currentRelayBlockWindowMs = 0
    private relayBlockExtended = false
    private remoteOfferFallbackTimer: number | null = null
    private remoteSrflxBurstTriggered = false
    private readonly remoteSrflxBurstPackets = 8
    private remoteSrflxBurstRetryTimer: number | null = null
    private remoteSrflxBurstRetries = 0
    private readonly maxRemoteSrflxBurstRetries = 6
    private sawRemoteSrflxCandidate = false
    private relaySuppressionBiasApplied = false
    private cumulativeRelaySuppressionMs = 0
    private readonly maxCumulativeRelaySuppressionMs = 8000
    private relayRaceStartedAtMs = 0
    private readonly relayRaceEvaluationDelayMs = 1800
    private pairStableSinceMs = 0
    private lastStablePairKey: string | null = null
    private lastPairTypeSwitchAtMs = 0
    private readonly pathDecisionHoldMs = 6000
    private consecutivePoorRelaySamples = 0
    private readonly poorRelaySamplesRequired = 3
    // bytesReceived is aggregated and laggy — sample slowly; use for trend / escape only, not fast suppression.
    private readonly deliverySampleWindow = 12
    private readonly deliverySampleMinIntervalMs = 2000
    private readonly minDeliverySamplesForHardTrend = 8
    private deliverySamples: number[] = []
    private lastPairBytesReceived: number | null = null
    private lastPairSampleAtMs: number | null = null
    private readonly directRttSampleWindow = 12
    private directRttSamplesMs: number[] = []
    private lastPathScoreLogAt = 0
    private readonly pathScoreLogCooldownMs = 1500
    onIceRestartRequested: (() => void) | null = null
    private connectedOnce = false
    private readonly lockIceAfterConnected = true

    constructor(logger?: Logger) {
        this.logger = logger ?? null
    }

    private normalizeIceServerUrls(urls: string | string[]): string[] {
        const raw = Array.isArray(urls) ? urls : [urls]
        const normalized: string[] = []
        for (const entry of raw) {
            if (typeof entry != "string") {
                continue
            }
            const lower = entry.toLowerCase()
            if (lower.startsWith("turn:") || lower.startsWith("turns:")) {
                if (lower.includes("transport=tcp") || lower.includes("transport=tls")) {
                    continue
                }
                if (lower.includes("transport=udp")) {
                    normalized.push(entry)
                    continue
                }
                normalized.push(`${entry}${entry.includes("?") ? "&" : "?"}transport=udp`)
                continue
            }
            if (lower.startsWith("stun:") || lower.startsWith("stuns:")) {
                normalized.push(entry)
            }
        }
        return normalized
    }

    private shouldDropLocalCandidate(candidateLine: string): boolean {
        const line = candidateLine.toLowerCase()
        if (line.includes(" tcp ")) {
            return true
        }
        if (this.iceMode == "relay-only" && !line.includes(" typ relay ")) {
            return true
        }
        return false
    }

    private getCandidateType(candidateLine: string): "host" | "srflx" | "prflx" | "relay" | "unknown" {
        if (candidateLine.includes(" typ host ")) {
            return "host"
        }
        if (candidateLine.includes(" typ srflx ")) {
            return "srflx"
        }
        if (candidateLine.includes(" typ prflx ")) {
            return "prflx"
        }
        if (candidateLine.includes(" typ relay ")) {
            return "relay"
        }
        return "unknown"
    }

    async initPeer(configuration?: RTCConfiguration, mode: WebRTCIceMode = "prefer-direct") {
        this.logger?.debug(`Creating Client Peer`)

        if (this.peer) {
            this.logger?.debug(`Cannot create Peer because a Peer already exists`)
            return
        }

        this.iceMode = mode

        // Configure WebRTC with sensible defaults. Relay-only mode is optional.
        const baseConfig: RTCConfiguration = configuration ? { ...configuration } : {}
        baseConfig.iceCandidatePoolSize = 0
        baseConfig.bundlePolicy = "max-bundle"
        baseConfig.rtcpMuxPolicy = "require"
        this.emittedIceCandidateCount = 0
        this.restartAttempts = 0
        this.initialOfferSent = false
        this.initialSrflxSeen = false
        this.srflxWaiters = []
        this.syncStarted = false
        this.bufferedLocalCandidates = []
        this.delayedLocalRelayCandidates = []
        this.delayedRemoteRelayCandidates = []
        this.relayBlockUntilMs = 0
        this.currentRelayBlockWindowMs = 0
        this.relayBlockExtended = false
        this.remoteSrflxBurstTriggered = false
        this.remoteSrflxBurstRetries = 0
        this.sawRemoteSrflxCandidate = false
        this.relaySuppressionBiasApplied = false
        this.cumulativeRelaySuppressionMs = 0
        this.relayRaceStartedAtMs = 0
        this.pairStableSinceMs = 0
        this.lastStablePairKey = null
        this.lastPairTypeSwitchAtMs = 0
        this.consecutivePoorRelaySamples = 0
        this.deliverySamples = []
        this.lastPairBytesReceived = null
        this.lastPairSampleAtMs = null
        this.directRttSamplesMs = []
        this.lastPathScoreLogAt = 0

        if (baseConfig.iceServers) {
            const before = baseConfig.iceServers.length
            const normalized = baseConfig.iceServers
                .map((server) => ({
                    ...server,
                    urls: this.normalizeIceServerUrls(server.urls),
                }))
                .filter((server) => server.urls.length > 0)
            baseConfig.iceServers = this.iceMode == "relay-only"
                ? normalized.filter((server) =>
                    server.urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:"))
                )
                : normalized
            this.logger?.debug(`Normalized ICE servers (${this.iceMode}): ${before} -> ${baseConfig.iceServers.length}`)
        }

        baseConfig.iceTransportPolicy = this.iceMode == "relay-only" ? "relay" : "all"

        this.peer = new RTCPeerConnection(baseConfig)
        this.peer.addEventListener("error", this.onError.bind(this))

        this.peer.addEventListener("negotiationneeded", this.onNegotiationNeeded.bind(this))
        this.peer.addEventListener("icecandidate", this.onIceCandidate.bind(this))

        this.peer.addEventListener("connectionstatechange", this.onConnectionStateChange.bind(this))
        this.peer.addEventListener("signalingstatechange", this.onSignalingStateChange.bind(this))
        this.peer.addEventListener("iceconnectionstatechange", this.onIceConnectionStateChange.bind(this))
        this.peer.addEventListener("icegatheringstatechange", this.onIceGatheringStateChange.bind(this))

        this.peer.addEventListener("track", this.onTrack.bind(this))
        this.peer.addEventListener("datachannel", this.onDataChannel.bind(this))

        // Keep connect-time footprint small; create optional fileTransfer channel after connect.
        this.fileTransferChannel = null

        this.initChannels()

        // Maybe we already received data
        if (this.remoteDescription) {
            await this.handleRemoteDescription(this.remoteDescription)
        } else {
            this.syncStartTimer = window.setTimeout(() => {
                this.logger?.debug(`Sync start timeout (${this.syncStartTimeoutMs}ms), starting negotiation locally`)
                void this.startSynchronizedNegotiation("local-timeout")
            }, this.syncStartTimeoutMs)
        }
        await this.tryDequeueIceCandidates()
    }

    private async startSynchronizedNegotiation(reason: "remote-start" | "local-timeout") {
        if (this.syncStarted) {
            return
        }
        this.syncStarted = true
        if (this.syncStartTimer != null) {
            clearTimeout(this.syncStartTimer)
            this.syncStartTimer = null
        }
        if (this.iceMode == "prefer-direct") {
            this.currentRelayBlockWindowMs = Math.max(150, Math.min(300, this.relayBlockWindowMs))
            this.relayBlockExtended = false
            this.relayBlockUntilMs = Date.now() + this.currentRelayBlockWindowMs
            this.scheduleRelayUnblock(this.currentRelayBlockWindowMs, `relay-block-window-${this.currentRelayBlockWindowMs}ms`)
            this.logger?.debug(`Blocking relay candidates for adaptive initial ${this.currentRelayBlockWindowMs}ms window`)
        }
        this.logger?.debug(`Starting synchronized negotiation (${reason})`)
        await this.onNegotiationNeeded()
        if (this.bufferedLocalCandidates.length > 0) {
            for (const candidate of this.bufferedLocalCandidates.splice(0)) {
                this.sendMessage({
                    AddIceCandidate: {
                        candidate: candidate.candidate ?? "",
                        sdp_mid: candidate.sdpMid ?? null,
                        sdp_mline_index: candidate.sdpMLineIndex ?? null,
                        username_fragment: candidate.usernameFragment ?? null
                    }
                })
            }
        }
    }

    private scheduleRelayUnblock(delayMs: number, reason: string) {
        if (this.relayUnblockTimer != null) {
            clearTimeout(this.relayUnblockTimer)
        }
        this.relayUnblockTimer = window.setTimeout(() => {
            this.relayUnblockTimer = null
            if (
                this.iceMode == "prefer-direct" &&
                !this.relayBlockExtended &&
                !this.initialSrflxSeen &&
                !this.sawRemoteSrflxCandidate &&
                this.peer &&
                (this.peer.iceConnectionState == "new" || this.peer.iceConnectionState == "checking")
            ) {
                const extensionMs = Math.max(0, this.relayBlockWindowMs - this.currentRelayBlockWindowMs)
                if (extensionMs > 0) {
                    this.relayBlockExtended = true
                    this.currentRelayBlockWindowMs += extensionMs
                    this.relayBlockUntilMs = Date.now() + extensionMs
                    this.logger?.debug(`Extending relay block by ${extensionMs}ms while waiting for srflx signals`)
                    this.scheduleRelayUnblock(extensionMs, `relay-block-extension-${extensionMs}ms`)
                    return
                }
            }
            void this.flushDelayedRelayCandidates(reason)
        }, delayMs)
    }

    private queueDelayedRelayCandidate(direction: "local" | "remote", candidate: RTCIceCandidateInit) {
        if (direction == "local") {
            if (this.delayedLocalRelayCandidates.length >= this.maxDelayedRelayCandidates) {
                this.delayedLocalRelayCandidates.shift()
            }
            this.delayedLocalRelayCandidates.push(candidate)
            return
        }
        if (this.delayedRemoteRelayCandidates.length >= this.maxDelayedRelayCandidates) {
            this.delayedRemoteRelayCandidates.shift()
        }
        this.delayedRemoteRelayCandidates.push(candidate)
    }

    private queueBufferedRemoteCandidate(candidate: RTCIceCandidateInit) {
        if (this.iceCandidates.length >= this.maxBufferedRemoteCandidates) {
            this.iceCandidates.shift()
        }
        this.iceCandidates.push(candidate)
    }

    private async flushDelayedRelayCandidates(reason: string) {
        const hasDelayed =
            this.delayedLocalRelayCandidates.length > 0 || this.delayedRemoteRelayCandidates.length > 0
        if (!hasDelayed) {
            return
        }
        if (this.peer?.connectionState == "connected") {
            this.logger?.debug("Dropping delayed relay candidates because P2P already connected")
            this.delayedLocalRelayCandidates.length = 0
            this.delayedRemoteRelayCandidates.length = 0
            return
        }
        if (!this.peer || !this.peer.remoteDescription) {
            this.logger?.debug("Remote description not ready; re-queueing delayed remote relay candidates")
            for (const candidate of this.delayedRemoteRelayCandidates.splice(0)) {
                this.queueBufferedRemoteCandidate(candidate)
            }
            return
        }
        this.logger?.debug(
            `Flushing delayed relay candidates (${reason}): local=${this.delayedLocalRelayCandidates.length}, remote=${this.delayedRemoteRelayCandidates.length}`
        )
        for (const candidate of this.delayedLocalRelayCandidates.splice(0)) {
            this.sendMessage({
                AddIceCandidate: {
                    candidate: candidate.candidate ?? "",
                    sdp_mid: candidate.sdpMid ?? null,
                    sdp_mline_index: candidate.sdpMLineIndex ?? null,
                    username_fragment: candidate.usernameFragment ?? null
                }
            })
        }
        for (const candidate of this.delayedRemoteRelayCandidates.splice(0)) {
            try {
                await this.peer.addIceCandidate(candidate)
            } catch (err) {
                this.logger?.debug(`Failed to apply delayed remote relay candidate: ${err}`)
            }
        }
    }

    private triggerRemoteSrflxPacketBurst() {
        if (this.remoteSrflxBurstTriggered) {
            return
        }
        this.remoteSrflxBurstTriggered = true
        const trySendBurst = () => {
            const rtt = this.getChannel(TransportChannelId.RTT)
            if (rtt.type != "data") {
                return false
            }
            // Short packets are safe no-op on the app RTT parser and still produce network activity.
            const packet = new Uint8Array([0xff]).buffer
            for (let i = 0; i < this.remoteSrflxBurstPackets; i++) {
                rtt.send(packet)
            }
            this.logger?.debug(`Sent remote-srflx aggressive packet burst (${this.remoteSrflxBurstPackets} packets)`)
            return true
        }
        try {
            if (trySendBurst()) {
                return
            }
            this.remoteSrflxBurstRetries = 0
            this.remoteSrflxBurstRetryTimer = window.setInterval(() => {
                this.remoteSrflxBurstRetries += 1
                try {
                    if (trySendBurst() || this.remoteSrflxBurstRetries >= this.maxRemoteSrflxBurstRetries) {
                        if (this.remoteSrflxBurstRetryTimer != null) {
                            clearInterval(this.remoteSrflxBurstRetryTimer)
                            this.remoteSrflxBurstRetryTimer = null
                        }
                        if (this.remoteSrflxBurstRetries >= this.maxRemoteSrflxBurstRetries) {
                            this.logger?.debug("Remote srflx burst retries exhausted before RTT channel became usable")
                        }
                    }
                } catch (err) {
                    if (this.remoteSrflxBurstRetryTimer != null) {
                        clearInterval(this.remoteSrflxBurstRetryTimer)
                        this.remoteSrflxBurstRetryTimer = null
                    }
                    this.logger?.debug(`Remote srflx burst retry failed: ${err}`)
                }
            }, 20)
        } catch (err) {
            this.logger?.debug(`Failed to schedule remote-srflx packet burst: ${err}`)
        }
    }

    private readonly FILE_TRANSFER_CHUNK_SIZE = 16 * 1024
    private readonly FILE_TRANSFER_BUFFERED_LIMIT = 500000

    // setupFileSender(pc): create sender-side channel
    private setupFileSender(pc: RTCPeerConnection): RTCDataChannel {
        const dc = pc.createDataChannel("fileTransfer", {
            ordered: true
        })
        dc.binaryType = "arraybuffer"
        dc.bufferedAmountLowThreshold = this.FILE_TRANSFER_BUFFERED_LIMIT / 2
        dc.addEventListener("open", () => {
            this.logger?.debug("fileTransfer channel open")
        })
        dc.addEventListener("close", () => {
            this.logger?.debug("fileTransfer channel closed")
        })
        dc.addEventListener("error", (event) => {
            this.logger?.debug(`fileTransfer channel error: ${event}`)
        })
        return dc
    }

    // setupFileReceiver(dc): receiver-side chunk reassembly
    private setupFileReceiver(dc: RTCDataChannel) {
        dc.binaryType = "arraybuffer"

        let expectedFileName = ""
        let expectedFileSize = 0
        let receivedBytes = 0
        let chunks: Array<ArrayBuffer> = []

        dc.addEventListener("message", (event: MessageEvent) => {
            if (typeof event.data === "string") {
                try {
                    const meta = JSON.parse(event.data)
                    if (meta.type === "file-meta" && typeof meta.name === "string" && typeof meta.size === "number") {
                        expectedFileName = meta.name
                        expectedFileSize = meta.size
                        receivedBytes = 0
                        chunks = []
                        this.logger?.debug(`Receiving file over DataChannel: ${expectedFileName} (${expectedFileSize} bytes)`)
                    }
                } catch {
                    this.logger?.debug("fileTransfer received invalid metadata JSON")
                }
                return
            }

            if (!(event.data instanceof ArrayBuffer) || expectedFileSize <= 0) {
                return
            }

            chunks.push(event.data)
            receivedBytes += event.data.byteLength
            const progress = Math.min(100, Math.round((receivedBytes / expectedFileSize) * 100))
            this.onFileTransferProgress?.("receive", expectedFileName, progress)
            this.logger?.debug(`fileTransfer receive progress: ${expectedFileName} ${progress}% (${receivedBytes}/${expectedFileSize})`)

            if (receivedBytes >= expectedFileSize) {
                const file = new Blob(chunks)
                this.logger?.debug(`fileTransfer receive complete: ${expectedFileName} (${receivedBytes} bytes)`)
                this.onFileReceived?.(expectedFileName, file)

                // reset receiver state for next file
                expectedFileName = ""
                expectedFileSize = 0
                receivedBytes = 0
                chunks = []
            }
        })
    }

    private async readFileSlice(file: File, start: number, end: number): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onerror = () => reject(reader.error)
            reader.onload = () => resolve(reader.result as ArrayBuffer)
            reader.readAsArrayBuffer(file.slice(start, end))
        })
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    // Public API for sending a file over fileTransfer DataChannel
    async sendFile(file: File): Promise<void> {
        const dc = this.fileTransferChannel
        if (!dc || dc.readyState !== "open") {
            throw new Error("fileTransfer DataChannel is not open")
        }

        const metadata = JSON.stringify({
            type: "file-meta",
            name: file.name,
            size: file.size
        })
        dc.send(metadata)

        let sentBytes = 0
        while (sentBytes < file.size) {
            while (dc.bufferedAmount > this.FILE_TRANSFER_BUFFERED_LIMIT) {
                // Backpressure control to protect stream quality
                await this.sleep(10)
            }

            const nextEnd = Math.min(sentBytes + this.FILE_TRANSFER_CHUNK_SIZE, file.size)
            const chunk = await this.readFileSlice(file, sentBytes, nextEnd)
            dc.send(chunk)
            sentBytes = nextEnd

            const progress = Math.min(100, Math.round((sentBytes / file.size) * 100))
            this.onFileTransferProgress?.("send", file.name, progress)
            this.logger?.debug(`fileTransfer send progress: ${file.name} ${progress}% (${sentBytes}/${file.size})`)

            // Small pacing delay to avoid media starvation when network is tight
            await this.sleep(1)
        }

        this.logger?.debug(`fileTransfer send complete: ${file.name} (${file.size} bytes)`)
    }

    private onError(event: Event) {
        this.logger?.debug(`Web Socket or WebRtcPeer Error`)

        console.error(`Web Socket or WebRtcPeer Error`, event)
    }

    onsendmessage: ((message: StreamSignalingMessage) => void) | null = null
    private sendMessage(message: StreamSignalingMessage) {
        if (this.onsendmessage) {
            this.onsendmessage(message)
        } else {
            this.logger?.debug("Failed to call onicecandidate because no handler is set")
        }
    }
    async onReceiveMessage(message: StreamSignalingMessage) {
        if (typeof message == "string") {
            if (message == "SyncStart") {
                await this.startSynchronizedNegotiation("remote-start")
            } else if (message == "SyncReady") {
                this.logger?.debug("Received sync-ready from remote (ignored on browser side)")
            }
            return
        }
        if ("Description" in message) {
            const description = message.Description;
            await this.handleRemoteDescription({
                type: description.ty as RTCSdpType,
                sdp: description.sdp
            })
        } else if ("AddIceCandidate" in message) {
            const candidate = message.AddIceCandidate
            await this.addIceCandidate({
                candidate: candidate.candidate,
                sdpMid: candidate.sdp_mid,
                sdpMLineIndex: candidate.sdp_mline_index,
                usernameFragment: candidate.username_fragment
            })
        }
    }

    private async onNegotiationNeeded() {
        // We're polite
        if (!this.peer) {
            this.logger?.debug("OnNegotiationNeeded without a peer")
            return
        }
        if (this.iceMode == "prefer-direct" && !this.syncStarted) {
            this.logger?.debug("OnNegotiationNeeded deferred until sync start")
            return
        }
         // Avoid renegotiation spam: only allow one negotiation at a time
        if (this.isNegotiating || this.peer.signalingState !== "stable") {
            this.logger?.debug("OnNegotiationNeeded ignored because negotiation is already in progress")
            return
        }

        this.isNegotiating = true

        try {
            await this.peer.setLocalDescription()
            const localDescription = this.peer.localDescription
            if (!localDescription) {
                this.logger?.debug("Failed to set local description in OnNegotiationNeeded")
                return
            }

            const localSdp = this.iceMode == "relay-only"
                ? this.enforceRelayInSdp(localDescription.sdp ?? "")
                : this.deprioritizeRelayInSdp(localDescription.sdp ?? "")

            this.logger?.debug(`OnNegotiationNeeded: Sending local description (${this.iceMode}): ${localDescription.type}`)
            this.sendMessage({
                Description: {
                    ty: localDescription.type,
                    sdp: localSdp
                }
            })
            if (localDescription.type == "offer") {
                this.initialOfferSent = true
            }
        } catch (err) {
            this.logger?.debug(`OnNegotiationNeeded failed: ${err}`)
            // In case of error, clear negotiation flag so we can recover
            this.isNegotiating = false
        }
    }

    private remoteDescription: RTCSessionDescriptionInit | null = null
    private async handleRemoteDescription(sdp: RTCSessionDescriptionInit | null) {
        this.logger?.debug(`Received remote description: ${sdp?.type}`)

        const remoteDescription = sdp
        this.remoteDescription = remoteDescription
        if (!this.peer) {
            return
        }
        this.remoteDescription = null

        if (remoteDescription) {
            try {
                // Remote description handling is part of negotiation; mark as negotiating to
                // avoid conflicting local renegotiations until we reach a stable state again.
                this.isNegotiating = true

                if (
                    remoteDescription.type == "offer" &&
                    this.peer.signalingState != "stable"
                ) {
                    this.logger?.debug(
                        `Offer glare detected (state=${this.peer.signalingState}), rolling back local description`
                    )
                    await this.peer.setLocalDescription({ type: "rollback" })
                }

                const sanitizedRemoteDescription =
                    this.iceMode == "prefer-direct" && (remoteDescription.sdp ?? "").length > 0
                        ? {
                            ...remoteDescription,
                            sdp: this.deprioritizeRelayInSdp(remoteDescription.sdp ?? ""),
                        }
                        : remoteDescription

                await this.peer.setRemoteDescription(sanitizedRemoteDescription)
                await this.tryDequeueIceCandidates()

                if (remoteDescription.type == "offer") {
                    await this.peer.setLocalDescription()
                    const localDescription = this.peer.localDescription
                    if (!localDescription) {
                        this.logger?.debug("Peer didn't have a localDescription whilst receiving an offer and trying to answer")
                        return
                    }

                    const localSdp = this.iceMode == "relay-only"
                        ? this.enforceRelayInSdp(localDescription.sdp ?? "")
                        : this.deprioritizeRelayInSdp(localDescription.sdp ?? "")

                    this.logger?.debug(`Responding to offer description (${this.iceMode}): ${localDescription.type}`)
                    this.sendMessage({
                        Description: {
                            ty: localDescription.type,
                            sdp: localSdp
                        }
                    })
                }
            } catch (err) {
                this.logger?.debug(`handleRemoteDescription failed: ${err}`)
                // On error, clear negotiation flag so we can recover
                this.isNegotiating = false
            }
        }
    }

    private onIceCandidate(event: RTCPeerConnectionIceEvent) {
        if (this.lockIceAfterConnected && this.connectedOnce) {
            return
        }
        if (event.candidate) {
            const candidate = event.candidate.toJSON()
            const candidateLine = candidate.candidate ?? ""
            const candidateType = this.getCandidateType(candidateLine)
            const isPriorityCandidate = candidateType == "srflx" || candidateType == "prflx" || candidateType == "relay"

            if (this.shouldDropLocalCandidate(candidateLine)) {
                this.logger?.debug(`Dropping ICE candidate (${this.iceMode}): ${candidateLine}`)
                return
            }

            if (
                !isPriorityCandidate &&
                !this.initialSrflxSeen &&
                candidateType == "host" &&
                this.emittedIceCandidateCount >= this.maxHostCandidatesBeforeSrflx
            ) {
                this.logger?.debug(
                    `Dropping excess host candidate before srflx (${this.maxHostCandidatesBeforeSrflx}): ${candidateLine}`
                )
                return
            }

            if (!isPriorityCandidate && this.emittedIceCandidateCount >= this.maxLocalIceCandidates) {
                this.logger?.debug(`Dropping ICE candidate due to local cap (${this.maxLocalIceCandidates})`)
                return
            }

            if (candidateLine.includes(" typ srflx ")) {
                this.initialSrflxSeen = true
                for (const wake of this.srflxWaiters.splice(0)) {
                    wake()
                }
                this.logger?.debug(`Observed srflx candidate in ${this.iceMode}: ${candidateLine}`)
            }

            if (candidate.candidate && this.iceMode == "prefer-direct") {
                const tokens = candidate.candidate.split(" ")
                // Prefer srflx/prflx over relay during nomination by lowering relay priority.
                if (tokens.length > 3 && candidateType == "relay") {
                    tokens[3] = "1"
                    candidate.candidate = tokens.join(" ")
                }
            } else if (this.iceMode == "relay-only" && candidate.candidate) {
                const tokens = candidate.candidate.split(" ")
                // candidate:<id> <component> <protocol> <priority> ...
                if (tokens.length > 3) {
                    // Use a very high constant for relay priority
                    tokens[3] = "2114000000"
                    candidate.candidate = tokens.join(" ")
                }
            }

            this.emittedIceCandidateCount += 1
            this.logger?.debug(`Sending ICE candidate (${this.iceMode}): ${candidate.candidate}`)

            if (this.iceMode == "prefer-direct" && candidateType == "relay") {
                if (Date.now() < this.relayBlockUntilMs) {
                    this.queueDelayedRelayCandidate("local", {
                        candidate: candidate.candidate ?? "",
                        sdpMid: candidate.sdpMid ?? null,
                        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
                        usernameFragment: candidate.usernameFragment ?? null,
                    })
                    this.logger?.debug("Blocking local relay candidate during initial P2P-first window")
                    return
                }
            }

            if (!this.syncStarted && this.iceMode == "prefer-direct") {
                this.bufferedLocalCandidates.push({
                    candidate: candidate.candidate ?? "",
                    sdpMid: candidate.sdpMid ?? null,
                    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
                    usernameFragment: candidate.usernameFragment ?? null
                })
                this.logger?.debug("Buffering local ICE candidate until synchronized start")
            } else {
                this.sendMessage({
                    AddIceCandidate: {
                        candidate: candidate.candidate ?? "",
                        sdp_mid: candidate.sdpMid ?? null,
                        sdp_mline_index: candidate.sdpMLineIndex ?? null,
                        username_fragment: candidate.usernameFragment ?? null
                    }
                })
            }
        } else {
            this.logger?.debug("No new ice candidates")
        }
    }

    // SDP munging helper: keep only relay candidates and ensure relay-first priority
    private enforceRelayInSdp(sdp: string): string {
        if (!sdp) {
            return sdp
        }

        const lines = sdp.split(/\r\n|\n/)
        const newLines: string[] = []

        for (const line of lines) {
            if (!line.startsWith("a=candidate:")) {
                newLines.push(line)
                continue
            }

            // Only keep relay candidates
            if (!line.includes(" typ relay")) {
                continue
            }

            const tokens = line.split(" ")
            if (tokens.length > 3) {
                // tokens[3] is the priority field
                tokens[3] = "2114000000"
            }

            newLines.push(tokens.join(" "))
        }

        return newLines.join("\r\n")
    }

    private deprioritizeRelayInSdp(sdp: string): string {
        if (!sdp) {
            return sdp
        }
        const lines = sdp.split(/\r\n|\n/)
        const newLines: string[] = []
        for (const line of lines) {
            if (!line.startsWith("a=candidate:")) {
                newLines.push(line)
                continue
            }
            if (!line.includes(" typ relay ")) {
                newLines.push(line)
                continue
            }
            const tokens = line.split(" ")
            if (tokens.length > 3) {
                // Lower relay priority so nomination prefers host/srflx/prflx first.
                tokens[3] = "1"
            }
            newLines.push(tokens.join(" "))
        }
        return newLines.join("\r\n")
    }

    private iceCandidates: Array<RTCIceCandidateInit> = []
    private async addIceCandidate(candidate: RTCIceCandidateInit) {
        if (this.lockIceAfterConnected && this.connectedOnce) {
            return
        }
        this.logger?.debug(`Received ice candidate: ${candidate.candidate}`)
        const candidateLine = (candidate.candidate ?? "").toLowerCase()
        if (candidateLine.includes(" tcp ")) {
            this.logger?.debug("Ignoring remote TCP ICE candidate")
            return
        }
        if (this.iceMode == "prefer-direct" && candidateLine.includes(" typ relay ")) {
            if (Date.now() < this.relayBlockUntilMs) {
                this.queueDelayedRelayCandidate("remote", candidate)
                this.logger?.debug("Blocking remote relay candidate during initial P2P-first window")
                return
            }
        }
        if ((candidate.candidate ?? "").includes(" typ srflx ")) {
            this.sawRemoteSrflxCandidate = true
            this.triggerRemoteSrflxPacketBurst()
        }
        if (!this.peer || !this.peer.remoteDescription) {
            this.logger?.debug("Buffering ice candidate")
            this.queueBufferedRemoteCandidate(candidate)
            return
        }
        await this.tryDequeueIceCandidates()

        await this.peer.addIceCandidate(candidate)
    }
    private async tryDequeueIceCandidates() {
        if (!this.peer) {
            this.logger?.debug("called tryDequeueIceCandidates without a peer")
            return
        }
        if (!this.peer.remoteDescription) {
            this.logger?.debug("Deferring queued ICE candidate apply until remote description is set")
            return
        }

        for (const candidate of this.iceCandidates) {
            await this.peer.addIceCandidate(candidate)
        }
        this.iceCandidates.length = 0
    }

    private wasConnected = false
    private scheduleIceRestart(reason: string) {
        if (!this.peer) {
            return
        }
        if (this.lockIceAfterConnected && this.connectedOnce) {
            return
        }
        if (this.restartAttempts >= this.maxRestartAttempts) {
            this.logger?.debug(`Skipping ICE restart (${reason}): max retries reached`)
            return
        }
        if (this.restartTimer != null) {
            return
        }
        this.restartAttempts += 1
        const delayMs = 150 * this.restartAttempts
        this.restartTimer = window.setTimeout(() => {
            this.restartTimer = null
            if (!this.peer || this.peer.connectionState == "closed") {
                return
            }
            this.logger?.debug(`Running ICE restart attempt #${this.restartAttempts} (${reason})`)
            this.onIceRestartRequested?.()
            this.peer.restartIce()
            void this.onNegotiationNeeded()
        }, delayMs)
    }

    private onConnectionStateChange() {
        if (!this.peer) {
            this.logger?.debug("OnConnectionStateChange without a peer")
            return
        }

        let type: null | "fatal" | "recover" = null

        if (this.peer.connectionState == "connected") {
            this.connectedOnce = true
            type = "recover"
            this.delayedLocalRelayCandidates.length = 0
            this.delayedRemoteRelayCandidates.length = 0
            if (this.restartTimer != null) {
                clearTimeout(this.restartTimer)
                this.restartTimer = null
            }
            if (!this.fileTransferChannel) {
                this.fileTransferChannel = this.setupFileSender(this.peer)
            }

            if (this.onconnect) {
                this.onconnect()

                // Log selected ICE candidate pair details once the connection is established
                this.logSelectedCandidatePairDetails().catch(err => {
                    this.logger?.debug(`Failed to log ICE candidate pair details: ${err}`)
                })
            }
            if (this.selectedPairLogTimer == null) {
                this.selectedPairLogTimer = window.setInterval(() => {
                    void this.logSelectedCandidatePairDetails()
                }, 2000)
            }
            this.wasConnected = true
        } else if ((this.peer.connectionState == "failed" || this.peer.connectionState == "closed") && this.peer.iceGatheringState == "complete") {
            type = "fatal"
        }

        if (this.peer.connectionState == "failed" || this.peer.connectionState == "closed") {
            if (this.selectedPairLogTimer != null) {
                clearInterval(this.selectedPairLogTimer)
                this.selectedPairLogTimer = null
            }
            if (this.onclose) {
                if (this.wasConnected) {
                    this.onclose("failed")
                } else {
                    this.onclose("failednoconnect")
                }
            }
        }

        this.logger?.debug(`Changing Peer State to ${this.peer.connectionState}`, {
            type: type ?? undefined
        })
    }

    // Log detailed information about the selected ICE candidate pair
    private async logSelectedCandidatePairDetails() {
        if (!this.peer) {
            return
        }

        try {
            const stats = await this.peer.getStats()

            let selectedPair: any = null
            const localCandidates: Record<string, any> = {}
            const remoteCandidates: Record<string, any> = {}

            for (const [, value] of stats.entries()) {
                if ((value as any).type === "candidate-pair" && (value as any).nominated) {
                    // Prefer succeeded but fall back to any nominated pair
                    if (!selectedPair || (selectedPair.state !== "succeeded" && (value as any).state === "succeeded")) {
                        selectedPair = value
                    }
                } else if ((value as any).type === "local-candidate") {
                    localCandidates[(value as any).id] = value
                } else if ((value as any).type === "remote-candidate") {
                    remoteCandidates[(value as any).id] = value
                }
            }

            if (!selectedPair) {
                this.logger?.debug("No nominated ICE candidate pair found in stats")
                return
            }

            const local = localCandidates[(selectedPair as any).localCandidateId]
            const remote = remoteCandidates[(selectedPair as any).remoteCandidateId]

            const details = {
                pair: {
                    id: (selectedPair as any).id,
                    state: (selectedPair as any).state,
                    nominated: (selectedPair as any).nominated,
                    bytesSent: (selectedPair as any).bytesSent,
                    bytesReceived: (selectedPair as any).bytesReceived,
                    currentRoundTripTime: (selectedPair as any).currentRoundTripTime,
                    requestsSent: (selectedPair as any).requestsSent,
                    responsesReceived: (selectedPair as any).responsesReceived,
                    requestsReceived: (selectedPair as any).requestsReceived,
                    responsesSent: (selectedPair as any).responsesSent,
                },
                localCandidate: local && {
                    id: (local as any).id,
                    address: (local as any).ip ?? (local as any).address,
                    port: (local as any).port,
                    protocol: (local as any).protocol,
                    candidateType: (local as any).candidateType,
                    networkType: (local as any).networkType,
                    relayProtocol: (local as any).relayProtocol,
                    url: (local as any).url,
                },
                remoteCandidate: remote && {
                    id: (remote as any).id,
                    address: (remote as any).ip ?? (remote as any).address,
                    port: (remote as any).port,
                    protocol: (remote as any).protocol,
                    candidateType: (remote as any).candidateType,
                    networkType: (remote as any).networkType,
                    relayProtocol: (remote as any).relayProtocol,
                    url: (remote as any).url,
                }
            }

            const pairSignature = `${details.pair.id}:${details.pair.state}:${details.localCandidate?.candidateType}:${details.remoteCandidate?.candidateType}`
            const mappingSignature = `${details.localCandidate?.address}:${details.localCandidate?.port}:${details.remoteCandidate?.address}:${details.remoteCandidate?.port}`
            if (this.lastLoggedPairSignature != pairSignature) {
                if (this.lastLoggedPairSignature) {
                    this.logger?.debug(`ICE pair transition: ${this.lastLoggedPairSignature} -> ${pairSignature}`)
                }
                this.lastLoggedPairSignature = pairSignature
            }
            if (this.lastLoggedMappingSignature != mappingSignature) {
                if (this.lastLoggedMappingSignature) {
                    this.logger?.debug(`NAT mapping change detected: ${this.lastLoggedMappingSignature} -> ${mappingSignature}`)
                } else {
                    this.logger?.debug(`Initial NAT mapping: ${mappingSignature}`)
                }
                this.lastLoggedMappingSignature = mappingSignature
            }
            const pathScore = this.computePathScore(details)
            if (Date.now() - this.lastPathScoreLogAt >= this.pathScoreLogCooldownMs) {
                this.lastPathScoreLogAt = Date.now()
                this.logger?.debug(`ICE path score: ${JSON.stringify(pathScore)}`)
            }
            this.maybeEscapeHatchRelayUnblock(pathScore, details)
            this.maybeApplyRelaySuppressionBias(details, pathScore)
            this.logger?.debug(`Selected ICE candidate pair: ${JSON.stringify(details)}`)
        } catch (err) {
            this.logger?.debug(`Error while collecting ICE candidate stats: ${err}`)
        }
    }

    /**
     * Control hierarchy (see docs/p2p-chance.md):
     * L1 hard — consent / sustained delivery-trend fail → escape hatch (allow relay), never extra suppression
     * L2 stability — survival + variance gates before any suppression bias
     * L3 optimization — type, RTT, consent (no bytesReceived in control score)
     * bytesReceived — diagnostic / L1 trend only (laggy proxy)
     */
    private computePathScore(details: any): {
        pairType: string
        /** L3 (+ survival tilt); used for suppression "poor" — excludes delivery to avoid feedback loops */
        optimizationScore: number
        /** Full blend incl. delivery for logs only */
        diagnosticScore: number
        rttMs: number | null
        rttVarianceMs: number | null
        consentRatio: number | null
        pairSurvivalMs: number
        deliveryConsistency: number | null
        burstDropStreak: number
        level1HardConsentFail: boolean
        level1HardDeliveryTrendFail: boolean
        /** L2: must pass before applying relay suppression bias */
        stabilityGateOk: boolean
    } {
        const localType = details.localCandidate?.candidateType ?? "unknown"
        const remoteType = details.remoteCandidate?.candidateType ?? "unknown"
        const pairType = `${localType}<=>${remoteType}`
        const pairKey = `${details.pair?.id ?? "unknown"}:${pairType}`
        if (this.lastStablePairKey != pairKey) {
            this.lastStablePairKey = pairKey
            this.pairStableSinceMs = Date.now()
            this.lastPairTypeSwitchAtMs = Date.now()
            this.consecutivePoorRelaySamples = 0
            this.deliverySamples = []
            this.lastPairBytesReceived = null
            this.lastPairSampleAtMs = null
        }
        const pairSurvivalMs = Math.max(0, Date.now() - this.pairStableSinceMs)
        const rttSeconds = typeof details.pair?.currentRoundTripTime == "number" ? details.pair.currentRoundTripTime : null
        const rttMs = rttSeconds != null ? rttSeconds * 1000 : null
        if (rttMs != null) {
            this.directRttSamplesMs.push(rttMs)
            while (this.directRttSamplesMs.length > this.directRttSampleWindow) {
                this.directRttSamplesMs.shift()
            }
        }
        const variance = this.getSampleVariance(this.directRttSamplesMs)
        const requestsSent = Number(details.pair?.requestsSent ?? 0)
        const responsesReceived = Number(details.pair?.responsesReceived ?? 0)
        const consentRatio = requestsSent > 0 ? responsesReceived / requestsSent : null
        const now = Date.now()
        const bytesReceived = Number(details.pair?.bytesReceived ?? 0)
        let deliveryConsistency: number | null = null
        let burstDropStreak = 0
        if (this.lastPairSampleAtMs != null && this.lastPairBytesReceived != null) {
            const deltaMs = now - this.lastPairSampleAtMs
            if (deltaMs >= this.deliverySampleMinIntervalMs) {
                const deltaBytes = bytesReceived - this.lastPairBytesReceived
                const delivered = deltaBytes > 0 ? 1 : 0
                this.deliverySamples.push(delivered)
                while (this.deliverySamples.length > this.deliverySampleWindow) {
                    this.deliverySamples.shift()
                }
                const sum = this.deliverySamples.reduce((acc, sample) => acc + sample, 0)
                deliveryConsistency = this.deliverySamples.length > 0 ? (sum / this.deliverySamples.length) : null
                for (let i = this.deliverySamples.length - 1; i >= 0; i--) {
                    if (this.deliverySamples[i] == 0) {
                        burstDropStreak += 1
                    } else {
                        break
                    }
                }
            }
        }
        this.lastPairBytesReceived = bytesReceived
        this.lastPairSampleAtMs = now

        // L1 hard
        const level1HardConsentFail = consentRatio != null && consentRatio < 0.45
        const level1HardDeliveryTrendFail =
            this.deliverySamples.length >= this.minDeliverySamplesForHardTrend &&
            deliveryConsistency != null &&
            deliveryConsistency < 0.35

        // L3 optimization (control path — no bytesReceived)
        let optimizationScore = 0
        if (localType == "relay" || remoteType == "relay") {
            optimizationScore += 35
        } else if (localType == "srflx" || localType == "prflx" || remoteType == "srflx" || remoteType == "prflx") {
            optimizationScore += 80
        } else {
            optimizationScore += 70
        }
        if (rttMs != null) {
            optimizationScore -= Math.min(40, Math.max(0, (rttMs - 25) * 0.25))
        }
        if (variance != null) {
            optimizationScore -= Math.min(20, variance * 0.2)
        }
        if (consentRatio != null && consentRatio < 0.75) {
            optimizationScore -= 20
        }
        if (pairSurvivalMs < 3000) {
            optimizationScore -= 10
        } else if (pairSurvivalMs > 7000) {
            optimizationScore += 5
        }
        optimizationScore = Math.max(0, Math.round(optimizationScore))

        // Diagnostic only (incl. delivery — not used for suppression decisions)
        let diagnosticScore = optimizationScore
        if (deliveryConsistency != null) {
            if (deliveryConsistency < 0.7) {
                diagnosticScore -= 18
            } else if (deliveryConsistency > 0.9) {
                diagnosticScore += 4
            }
        }
        if (burstDropStreak >= 2) {
            diagnosticScore -= Math.min(16, burstDropStreak * 6)
        }
        diagnosticScore = Math.max(0, Math.round(diagnosticScore))

        // L2 stability gate for *adding* suppression (not for escape)
        const stabilityGateOk = pairSurvivalMs >= 3500 && (variance == null || variance < 480)

        return {
            pairType,
            optimizationScore,
            diagnosticScore,
            rttMs,
            rttVarianceMs: variance,
            consentRatio,
            pairSurvivalMs,
            deliveryConsistency,
            burstDropStreak,
            level1HardConsentFail,
            level1HardDeliveryTrendFail,
            stabilityGateOk,
        }
    }

    private getSampleVariance(samples: number[]): number | null {
        if (samples.length < 2) {
            return null
        }
        const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
        const variance = samples.reduce((sum, value) => sum + ((value - mean) * (value - mean)), 0) / samples.length
        return Number.isFinite(variance) ? variance : null
    }

    /**
     * L1 escape: never leave relay blocked when the path is failing or budget exhausted — TURN must remain a recovery hatch.
     */
    private maybeEscapeHatchRelayUnblock(
        pathScore: {
            level1HardConsentFail: boolean
            level1HardDeliveryTrendFail: boolean
        },
        _details: any
    ) {
        if (!this.peer || this.iceMode != "prefer-direct") {
            return
        }
        const inRelayBlock = Date.now() < this.relayBlockUntilMs
        if (!inRelayBlock) {
            return
        }
        const budgetExhausted = this.cumulativeRelaySuppressionMs >= this.maxCumulativeRelaySuppressionMs
        const hardFail = pathScore.level1HardConsentFail || pathScore.level1HardDeliveryTrendFail
        if (!hardFail && !budgetExhausted) {
            return
        }
        this.relayBlockUntilMs = Date.now()
        this.logger?.debug(
            `Relay escape hatch: unblocking relay candidates (hardFail=${hardFail}, budgetExhausted=${budgetExhausted}, ` +
            `cumulativeSuppressionMs=${this.cumulativeRelaySuppressionMs})`
        )
        if (budgetExhausted) {
            this.relaySuppressionBiasApplied = true
        }
    }

    private maybeApplyRelaySuppressionBias(
        details: any,
        score: {
            optimizationScore: number
            pairSurvivalMs: number
            stabilityGateOk: boolean
            level1HardConsentFail: boolean
            level1HardDeliveryTrendFail: boolean
        }
    ) {
        if (!this.peer || this.iceMode != "prefer-direct") {
            return
        }
        if (this.peer.connectionState != "connected" && this.peer.connectionState != "connecting") {
            return
        }
        if (score.level1HardConsentFail || score.level1HardDeliveryTrendFail) {
            this.consecutivePoorRelaySamples = 0
            return
        }
        if (this.cumulativeRelaySuppressionMs >= this.maxCumulativeRelaySuppressionMs || this.relaySuppressionBiasApplied) {
            return
        }

        const localType = details.localCandidate?.candidateType ?? ""
        const remoteType = details.remoteCandidate?.candidateType ?? ""
        const relayInUse = localType == "relay" || remoteType == "relay"
        if (!relayInUse) {
            this.consecutivePoorRelaySamples = 0
            return
        }
        if (!this.sawRemoteSrflxCandidate) {
            this.consecutivePoorRelaySamples = 0
            return
        }
        if (Date.now() - this.relayRaceStartedAtMs < this.relayRaceEvaluationDelayMs) {
            return
        }
        if (Date.now() - this.lastPairTypeSwitchAtMs < this.pathDecisionHoldMs) {
            return
        }
        if (score.pairSurvivalMs < 3500) {
            return
        }
        if (!score.stabilityGateOk) {
            this.consecutivePoorRelaySamples = 0
            return
        }
        // L3 only: poor optimization score (no delivery/bytesReceived in this number)
        const poorSample = score.optimizationScore < 55
        if (!poorSample) {
            this.consecutivePoorRelaySamples = 0
            return
        }
        this.consecutivePoorRelaySamples += 1
        if (this.consecutivePoorRelaySamples < this.poorRelaySamplesRequired) {
            return
        }

        const remainingBudget = this.maxCumulativeRelaySuppressionMs - this.cumulativeRelaySuppressionMs
        const extraSuppressMs = Math.min(1200, remainingBudget)
        if (extraSuppressMs <= 0) {
            this.relaySuppressionBiasApplied = true
            return
        }
        this.consecutivePoorRelaySamples = 0
        this.cumulativeRelaySuppressionMs += extraSuppressMs
        if (this.cumulativeRelaySuppressionMs >= this.maxCumulativeRelaySuppressionMs) {
            this.relaySuppressionBiasApplied = true
        }
        this.relayBlockUntilMs = Math.max(this.relayBlockUntilMs, Date.now() + extraSuppressMs)
        this.logger?.debug(
            `Relay suppression bias (L3): +${extraSuppressMs}ms block (optimizationScore=${score.optimizationScore}, ` +
            `cumulativeSuppressionMs=${this.cumulativeRelaySuppressionMs}/${this.maxCumulativeRelaySuppressionMs})`
        )
    }
    private onSignalingStateChange() {
        if (!this.peer) {
            this.logger?.debug("OnSignalingStateChange without a peer")
            return
        }
        // Once we return to a stable signaling state, allow new negotiations
        if (this.peer.signalingState === "stable") {
            this.isNegotiating = false
        }
    }
    private onIceConnectionStateChange() {
        if (!this.peer) {
            this.logger?.debug("OnIceConnectionStateChange without a peer")
            return
        }
        this.logger?.debug(`Changing Peer Ice State to ${this.peer.iceConnectionState}`)
        if (this.peer.iceConnectionState == "connected" || this.peer.iceConnectionState == "completed") {
            this.restartAttempts = 0
            if (this.relayRaceStartedAtMs == 0) {
                this.relayRaceStartedAtMs = Date.now()
            }
            void this.logSelectedCandidatePairDetails()
        } else if (this.peer.iceConnectionState == "disconnected") {
            if (!(this.lockIceAfterConnected && this.connectedOnce)) {
                this.scheduleIceRestart("disconnected")
            }
        } else if (this.peer.iceConnectionState == "failed") {
            if (!(this.lockIceAfterConnected && this.connectedOnce)) {
                this.scheduleIceRestart("failed")
            }
            void this.logSelectedCandidatePairDetails()
        }
    }
    private onIceGatheringStateChange() {
        if (!this.peer) {
            this.logger?.debug("OnIceGatheringStateChange without a peer")
            return
        }
        if (this.lockIceAfterConnected && this.connectedOnce) {
            return
        }
        this.logger?.debug(`Changing Peer Ice Gathering State to ${this.peer.iceGatheringState}`)

        if (this.peer.iceConnectionState == "new" && this.peer.iceGatheringState == "complete") {
            // we failed without connection
            if (this.onclose) {
                this.onclose("failednoconnect")
            }
        }
    }

    private channels: Array<TransportChannel | null> = []
    private initChannels() {
        if (!this.peer) {
            this.logger?.debug("Failed to initialize channel without peer")
            return
        }
        if (this.channels.length > 0) {
            this.logger?.debug("Already initialized channels")
            return
        }

        for (const channelRaw in TRANSPORT_CHANNEL_OPTIONS) {
            const channel = channelRaw as TransportChannelIdKey
            const options = TRANSPORT_CHANNEL_OPTIONS[channel]

            // Channel not configured in our minimal set
            if (!options) {
                this.logger?.debug(`Skipping unconfigured transport channel: ${channel}`)
                continue
            }

            if (channel == "HOST_VIDEO") {
                const channel: VideoTrackTransportChannel = new WebRTCInboundTrackTransportChannel<"videotrack">(this.logger, "videotrack", "video", this.videoTrackHolder)
                this.channels[TransportChannelId.HOST_VIDEO] = channel
                continue
            }
            if (channel == "HOST_AUDIO") {
                const channel: AudioTrackTransportChannel = new WebRTCInboundTrackTransportChannel<"audiotrack">(this.logger, "audiotrack", "audio", this.audioTrackHolder)
                this.channels[TransportChannelId.HOST_AUDIO] = channel
                continue
            }

            const id = TransportChannelId[channel]
            const dataChannel = options.serverCreated ? null : this.peer.createDataChannel(channel.toLowerCase(), {
                ordered: options.ordered,
                maxRetransmits: options.reliable ? undefined : 0
            })

            this.channels[id] = new WebRTCDataTransportChannel(channel, dataChannel)
        }
    }

    private videoTrackHolder: TrackHolder = { ontrack: null, track: null }
    private videoReceiver: RTCRtpReceiver | null = null

    private audioTrackHolder: TrackHolder = { ontrack: null, track: null }

    private onTrack(event: RTCTrackEvent) {
        const track = event.track

        const receiver = event.receiver
        if (track.kind == "video") {
            this.videoReceiver = receiver
        }

        receiver.jitterBufferTarget = 0
        if ("playoutDelayHint" in receiver) {
            receiver.playoutDelayHint = 0
        }

        this.logger?.debug(`Adding receiver: ${track.kind}, ${track.id}, ${track.label}`)

        if (track.kind == "video") {
            if ("contentHint" in track) {
                track.contentHint = "motion"
            }

            this.videoTrackHolder.track = track
            if (!this.videoTrackHolder.ontrack) {
                throw "No video track listener registered!"
            }
            this.videoTrackHolder.ontrack()
        } else if (track.kind == "audio") {
            this.audioTrackHolder.track = track
            if (!this.audioTrackHolder.ontrack) {
                throw "No audio track listener registered!"
            }
            this.audioTrackHolder.ontrack()
        }
    }

    // Handle data channels created by the remote peer (server)
    private onDataChannel(event: RTCDataChannelEvent) {
        const remoteChannel = event.channel
        const label = remoteChannel.label

        this.logger?.debug(`Received remote data channel: ${label}`)

        if (label === "fileTransfer") {
            this.fileTransferChannel = remoteChannel
            this.setupFileReceiver(remoteChannel)
            return
        }

        // Map the channel label to the corresponding TransportChannelId
        const channelKey = label.toUpperCase() as TransportChannelIdKey
        if (channelKey in TransportChannelId) {
            const id = TransportChannelId[channelKey]
            const existingChannel = this.channels[id]

            // If we already have a channel for this ID, replace its underlying RTCDataChannel
            // with the remote one so we can receive messages from the server
            if (existingChannel && existingChannel.type === "data") {
                this.logger?.debug(`Replacing underlying channel for ${label} with remote channel`);
                (existingChannel as WebRTCDataTransportChannel).replaceChannel(remoteChannel)
            } else {
                this.logger?.debug(`Creating new channel for ${label}`)
                this.channels[id] = new WebRTCDataTransportChannel(label, remoteChannel)
            }
        } else {
            this.logger?.debug(`Unknown remote data channel: ${label}`)
        }
    }

    async setupHostVideo(_setup: TransportVideoSetup): Promise<VideoCodecSupport> {
        // TODO: check transport type

        let capabilities
        if ("getCapabilities" in RTCRtpReceiver && (capabilities = RTCRtpReceiver.getCapabilities("video"))) {
            const codecs = emptyVideoCodecs()

            for (const codec in codecs) {
                const supportRequirements = CAPABILITIES_CODECS[codec]

                if (!supportRequirements) {
                    continue
                }

                let supported = false
                capabilityCodecLoop: for (const codecCapability of capabilities.codecs) {
                    if (codecCapability.mimeType != supportRequirements.mimeType) {
                        continue
                    }

                    for (const fmtpLine of supportRequirements.fmtpLine) {
                        if (!codecCapability.sdpFmtpLine?.includes(fmtpLine)) {
                            continue capabilityCodecLoop
                        }
                    }

                    supported = true
                    break
                }

                codecs[codec] = supported
            }

            return codecs
        } else {
            return maybeVideoCodecs()
        }
    }

    async setupHostAudio(_setup: TransportAudioSetup): Promise<void> {
        // TODO: check transport type
    }

    getChannel(id: TransportChannelIdValue): TransportChannel {
        const channel = this.channels[id]
        if (!channel) {
            this.logger?.debug("Failed to setup video without peer")
            throw `Failed to get channel because it is not yet initialized, Id: ${id}`
        }

        return channel
    }

    onconnect: (() => void) | null = null

    onclose: ((shutdown: TransportShutdown) => void) | null = null
    async close(): Promise<void> {
        this.logger?.debug("Closing WebRTC Peer")
        for (const wake of this.srflxWaiters.splice(0)) {
            wake()
        }
        if (this.relayUnblockTimer != null) {
            clearTimeout(this.relayUnblockTimer)
            this.relayUnblockTimer = null
        }
        if (this.remoteSrflxBurstRetryTimer != null) {
            clearInterval(this.remoteSrflxBurstRetryTimer)
            this.remoteSrflxBurstRetryTimer = null
        }
        this.delayedLocalRelayCandidates.length = 0
        this.delayedRemoteRelayCandidates.length = 0
        if (this.syncStartTimer != null) {
            clearTimeout(this.syncStartTimer)
            this.syncStartTimer = null
        }
        if (this.restartTimer != null) {
            clearTimeout(this.restartTimer)
            this.restartTimer = null
        }
        if (this.selectedPairLogTimer != null) {
            clearInterval(this.selectedPairLogTimer)
            this.selectedPairLogTimer = null
        }
        this.peer?.close()
    }

    async getStats(): Promise<Record<string, StatValue>> {
        const statsData: Record<string, StatValue> = {}

        if (!this.videoReceiver) {
            return {}
        }
        const stats = await this.videoReceiver.getStats()

        console.debug("----------------- raw video stats -----------------")
        for (const [key, value] of stats.entries()) {
            console.debug("raw video stats", key, value)

            if ("decoderImplementation" in value && value.decoderImplementation != null) {
                statsData.decoderImplementation = value.decoderImplementation
            }
            if ("frameWidth" in value && value.frameWidth != null) {
                statsData.videoWidth = value.frameWidth
            }
            if ("frameHeight" in value && value.frameHeight != null) {
                statsData.videoHeight = value.frameHeight
            }
            if ("framesPerSecond" in value && value.framesPerSecond != null) {
                statsData.webrtcFps = value.framesPerSecond
            }

            if ("jitterBufferDelay" in value && value.jitterBufferDelay != null) {
                statsData.webrtcJitterBufferDelayMs = value.jitterBufferDelay
            }
            if ("jitterBufferTargetDelay" in value && value.jitterBufferTargetDelay != null) {
                statsData.webrtcJitterBufferTargetDelayMs = value.jitterBufferTargetDelay
            }
            if ("jitterBufferMinimumDelay" in value && value.jitterBufferMinimumDelay != null) {
                statsData.webrtcJitterBufferMinimumDelayMs = value.jitterBufferMinimumDelay
            }
            if ("jitter" in value && value.jitter != null) {
                statsData.webrtcJitterMs = value.jitter
            }
            if ("totalDecodeTime" in value && value.totalDecodeTime != null) {
                statsData.webrtcTotalDecodeTimeMs = value.totalDecodeTime
            }
            if ("totalAssemblyTime" in value && value.totalAssemblyTime != null) {
                statsData.webrtcTotalAssemblyTimeMs = value.totalAssemblyTime
            }
            if ("totalProcessingDelay" in value && value.totalProcessingDelay != null) {
                statsData.webrtcTotalProcessingDelayMs = value.totalProcessingDelay
            }
            if ("packetsReceived" in value && value.packetsReceived != null) {
                statsData.webrtcPacketsReceived = value.packetsReceived
            }
            if ("packetsLost" in value && value.packetsLost != null) {
                statsData.webrtcPacketsLost = value.packetsLost
            }
            if ("framesDropped" in value && value.framesDropped != null) {
                statsData.webrtcFramesDropped = value.framesDropped
            }
            if ("keyFramesDecoded" in value && value.keyFramesDecoded != null) {
                statsData.webrtcKeyFramesDecoded = value.keyFramesDecoded
            }
            if ("nackCount" in value && value.nackCount != null) {
                statsData.webrtcNackCount = value.nackCount
            }
        }

        if (this.peer) {
            try {
                const peerStats = await this.peer.getStats()
                let selectedPair: any = null
                const localCandidates: Record<string, any> = {}
                const remoteCandidates: Record<string, any> = {}
                for (const [, value] of peerStats.entries()) {
                    const maybe = value as any
                    if (maybe.type === "candidate-pair" && maybe.nominated) {
                        if (!selectedPair || (selectedPair.state !== "succeeded" && maybe.state === "succeeded")) {
                            selectedPair = maybe
                        }
                    } else if (maybe.type === "local-candidate") {
                        localCandidates[maybe.id] = maybe
                    } else if (maybe.type === "remote-candidate") {
                        remoteCandidates[maybe.id] = maybe
                    }
                }
                if (selectedPair) {
                    const local = localCandidates[selectedPair.localCandidateId]
                    const remote = remoteCandidates[selectedPair.remoteCandidateId]
                    statsData.icePairState = selectedPair.state ?? "unknown"
                    statsData.iceBytesReceived = selectedPair.bytesReceived ?? 0
                    statsData.iceBytesSent = selectedPair.bytesSent ?? 0
                    // W3C currentRoundTripTime is reported in seconds.
                    statsData.iceCurrentRoundTripTimeMs = selectedPair.currentRoundTripTime != null
                        ? selectedPair.currentRoundTripTime * 1000
                        : 0
                    if (local) {
                        statsData.iceLocalProtocol = local.protocol ?? "unknown"
                        statsData.iceLocalCandidateType = local.candidateType ?? "unknown"
                        statsData.iceLocalNetworkType = local.networkType ?? "unknown"
                        statsData.iceLocalAddress = local.ip ?? local.address ?? "unknown"
                        statsData.iceLocalPort = local.port ?? "unknown"
                    }
                    if (remote) {
                        statsData.iceRemoteCandidateType = remote.candidateType ?? "unknown"
                        statsData.iceRemoteAddress = remote.ip ?? remote.address ?? "unknown"
                        statsData.iceRemotePort = remote.port ?? "unknown"
                    }
                }
            } catch (err) {
                this.logger?.debug(`Error while collecting live ICE stats: ${err}`)
            }
        }

        return statsData
    }
}

type TrackHolder = {
    ontrack: (() => void) | null
    track: MediaStreamTrack | null
}

// This receives track data
class WebRTCInboundTrackTransportChannel<T extends string> implements TrackTransportChannel {
    type: T

    canReceive: boolean = true
    canSend: boolean = false

    private logger: Logger | null

    private label: string
    private trackHolder: TrackHolder

    constructor(logger: Logger | null, type: T, label: string, trackHolder: TrackHolder) {
        this.logger = logger

        this.type = type
        this.label = label
        this.trackHolder = trackHolder

        this.trackHolder.ontrack = this.onTrack.bind(this)
    }
    setTrack(_track: MediaStreamTrack | null): void {
        throw "WebRTCInboundTrackTransportChannel cannot addTrack"
    }

    private onTrack() {
        const track = this.trackHolder.track
        if (!track) {
            this.logger?.debug("WebRTC TrackHolder.track is null!")
            return
        }

        for (const listener of this.trackListeners) {
            listener(track)
        }
    }


    private trackListeners: Array<(track: MediaStreamTrack) => void> = []
    addTrackListener(listener: (track: MediaStreamTrack) => void): void {
        if (this.trackHolder.track) {
            listener(this.trackHolder.track)
        }
        this.trackListeners.push(listener)
    }
    removeTrackListener(listener: (track: MediaStreamTrack) => void): void {
        const index = this.trackListeners.indexOf(listener)
        if (index != -1) {
            this.trackListeners.splice(index, 1)
        }
    }
}

class WebRTCDataTransportChannel implements DataTransportChannel {
    type: "data" = "data"

    canReceive: boolean = true
    canSend: boolean = true

    private label: string
    private channel: RTCDataChannel | null
    private boundOnMessage: (event: MessageEvent) => void

    constructor(label: string, channel: RTCDataChannel | null) {
        this.label = label
        this.channel = channel
        this.boundOnMessage = this.onMessage.bind(this)

        this.channel?.addEventListener("message", this.boundOnMessage)
    }

    // Replace the underlying channel with a new one (e.g., from remote peer)
    // This is used when we receive a data channel from the server that should
    // replace our locally created one for receiving messages
    replaceChannel(newChannel: RTCDataChannel): void {
        // Remove listener from old channel
        this.channel?.removeEventListener("message", this.boundOnMessage)
        // Add listener to new channel
        this.channel = newChannel
        this.channel.addEventListener("message", this.boundOnMessage)
    }

    private sendQueue: Array<ArrayBuffer> = []
    send(message: ArrayBuffer): void {
        console.debug(this.label, message)

        if (!this.channel) {
            throw `Failed to send message on channel ${this.label}`
        }

        if (this.channel.readyState != "open") {
            console.debug(`Tried sending packet to ${this.label} with readyState ${this.channel.readyState}. Buffering it for the future.`)
            this.sendQueue.push(message)
        } else {
            this.tryDequeueSendQueue()
            this.channel.send(message)
        }
    }
    private tryDequeueSendQueue() {
        for (const message of this.sendQueue) {
            this.channel?.send(message)
        }
        this.sendQueue.length = 0
    }

    private onMessage(event: MessageEvent) {
        const data = event.data
        if (!(data instanceof ArrayBuffer)) {
            console.warn(`received text data on webrtc channel ${this.label}`)
            return
        }

        for (const listener of this.receiveListeners) {
            listener(event.data)
        }
    }
    private receiveListeners: Array<(data: ArrayBuffer) => void> = []
    addReceiveListener(listener: (data: ArrayBuffer) => void): void {
        this.receiveListeners.push(listener)
    }
    removeReceiveListener(listener: (data: ArrayBuffer) => void): void {
        const index = this.receiveListeners.indexOf(listener)
        if (index != -1) {
            this.receiveListeners.splice(index, 1)
        }
    }
    estimatedBufferedBytes(): number | null {
        return this.channel?.bufferedAmount ?? null
    }
}