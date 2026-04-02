import { StreamSignalingMessage, TransportChannelId } from "../../api_bindings.js";
import { Logger } from "../log.js";
import { StatValue } from "../stats.js";
import { allVideoCodecs, CAPABILITIES_CODECS, emptyVideoCodecs, maybeVideoCodecs, VideoCodecSupport } from "../video.js";
import { DataTransportChannel, Transport, TRANSPORT_CHANNEL_OPTIONS, TransportAudioSetup, TransportChannel, TransportChannelIdKey, TransportChannelIdValue, TransportVideoSetup, AudioTrackTransportChannel, VideoTrackTransportChannel, TrackTransportChannel, TransportShutdown } from "./index.js";

export class WebRTCTransport implements Transport {
    implementationName: string = "webrtc"

    private logger: Logger | null

    private peer: RTCPeerConnection | null = null
    private fileTransferChannel: RTCDataChannel | null = null

    onFileTransferProgress: ((direction: "send" | "receive", fileName: string, progressPercent: number) => void) | null = null
    onFileReceived: ((fileName: string, file: Blob) => void) | null = null

    // Prevent renegotiation spam: track whether a negotiation is already in progress
    private isNegotiating: boolean = false

    constructor(logger?: Logger) {
        this.logger = logger ?? null
    }

    async initPeer(configuration?: RTCConfiguration) {
        this.logger?.debug(`Creating Client Peer`)

        if (this.peer) {
            this.logger?.debug(`Cannot create Peer because a Peer already exists`)
            return
        }

        // Configure WebRTC, forcing relay-only before any channels are created
        const baseConfig: RTCConfiguration = configuration ? { ...configuration } : {}

        // Filter ICE servers to TURN-only so no host/srflx candidates are discovered
        if (baseConfig.iceServers) {
            const before = baseConfig.iceServers.length
            baseConfig.iceServers = baseConfig.iceServers.filter(server => {
                const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
                return urls.some(url => typeof url === "string" && (url.startsWith("turn:") || url.startsWith("turns:")))
            })
            this.logger?.debug(`Filtered ICE servers for relay-only: ${before} -> ${baseConfig.iceServers.length}`)
        }

        // Enforce relay at the ICE policy level
        baseConfig.iceTransportPolicy = "relay"

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

        // Dedicated file transfer channel on the existing streaming peer
        this.fileTransferChannel = this.setupFileSender(this.peer)

        this.initChannels()

        // Maybe we already received data
        if (this.remoteDescription) {
            await this.handleRemoteDescription(this.remoteDescription)
        } else {
            await this.onNegotiationNeeded()
        }
        await this.tryDequeueIceCandidates()
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

         // Avoid renegotiation spam: only allow one negotiation at a time
        if (this.isNegotiating || this.peer.signalingState !== "stable") {
            this.logger?.debug(`OnNegotiationNeeded ignored because negotiation is already in progress or signalingState=${this.peer.signalingState}`)
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

            // Enforce relay-only candidates and prioritize relay at SDP level
            const mungedSdp = this.enforceRelayInSdp(localDescription.sdp ?? "")

            this.logger?.debug(`OnNegotiationNeeded: Sending local description (relay-only): ${localDescription.type}`)
            this.sendMessage({
                Description: {
                    ty: localDescription.type,
                    sdp: mungedSdp
                }
            })
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

                await this.peer.setRemoteDescription(remoteDescription)

                if (remoteDescription.type == "offer") {
                    await this.peer.setLocalDescription()
                    const localDescription = this.peer.localDescription
                    if (!localDescription) {
                        this.logger?.debug("Peer didn't have a localDescription whilst receiving an offer and trying to answer")
                        return
                    }

                    // Enforce relay-only candidates and prioritize relay at SDP level for the answer
                    const mungedSdp = this.enforceRelayInSdp(localDescription.sdp ?? "")

                    this.logger?.debug(`Responding to offer description (relay-only): ${localDescription.type}`)
                    this.sendMessage({
                        Description: {
                            ty: localDescription.type,
                            sdp: mungedSdp
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
        if (event.candidate) {
            const candidate = event.candidate.toJSON()

            // Enforce relay: drop non-relay candidates at the trickle ICE level
            if (candidate.candidate && !candidate.candidate.includes(" typ relay")) {
                this.logger?.debug(`Dropping non-relay ICE candidate: ${candidate.candidate}`)
                return
            }

            // Optionally, bump relay candidate priority to be highest
            if (candidate.candidate) {
                const tokens = candidate.candidate.split(" ")
                // candidate:<id> <component> <protocol> <priority> ...
                if (tokens.length > 3) {
                    // Use a very high constant for relay priority
                    tokens[3] = "2114000000"
                    candidate.candidate = tokens.join(" ")
                }
            }

            this.logger?.debug(`Sending relay ICE candidate: ${candidate.candidate}`)

            this.sendMessage({
                AddIceCandidate: {
                    candidate: candidate.candidate ?? "",
                    sdp_mid: candidate.sdpMid ?? null,
                    sdp_mline_index: candidate.sdpMLineIndex ?? null,
                    username_fragment: candidate.usernameFragment ?? null
                }
            })
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

    private iceCandidates: Array<RTCIceCandidateInit> = []
    private async addIceCandidate(candidate: RTCIceCandidateInit) {
        this.logger?.debug(`Received ice candidate: ${candidate.candidate}`)

        if (!this.peer) {
            this.logger?.debug("Buffering ice candidate")

            this.iceCandidates.push(candidate)
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

        for (const candidate of this.iceCandidates) {
            await this.peer.addIceCandidate(candidate)
        }
        this.iceCandidates.length = 0
    }

    private wasConnected = false
    private onConnectionStateChange() {
        if (!this.peer) {
            this.logger?.debug("OnConnectionStateChange without a peer")
            return
        }

        let type: null | "fatal" | "recover" = null

        if (this.peer.connectionState == "connected") {
            type = "recover"

            if (this.onconnect) {
                this.onconnect()

                // Log selected ICE candidate pair details once the connection is established
                this.logSelectedCandidatePairDetails().catch(err => {
                    this.logger?.debug(`Failed to log ICE candidate pair details: ${err}`)
                })
            }
            this.wasConnected = true
        } else if ((this.peer.connectionState == "failed" || this.peer.connectionState == "closed") && this.peer.iceGatheringState == "complete") {
            type = "fatal"
        }

        if (this.peer.connectionState == "failed" || this.peer.connectionState == "closed") {
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

            this.logger?.debug(`Selected ICE candidate pair: ${JSON.stringify(details)}`)
        } catch (err) {
            this.logger?.debug(`Error while collecting ICE candidate stats: ${err}`)
        }
    }
    private onSignalingStateChange() {
        if (!this.peer) {
            this.logger?.debug("OnSignalingStateChange without a peer")
            return
        }
        this.logger?.debug(`Changing Peer Signaling State to ${this.peer.signalingState}`)

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
    }
    private onIceGatheringStateChange() {
        if (!this.peer) {
            this.logger?.debug("OnIceGatheringStateChange without a peer")
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