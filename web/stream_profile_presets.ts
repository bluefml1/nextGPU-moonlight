import type { Settings } from "./component/settings_menu.js"
import {
    defaultSettings,
    getLocalStreamSettings,
    setLocalStreamSettings,
} from "./component/settings_menu.js"
import { setStreamProfileLabel } from "./stream_profile_label.js"

export type StreamProfileId = "performance" | "balance" | "quality"

/** Product presets — see DetailDesign/stream_profile_presets_a4b71cf8.plan.md */
const STREAM_PROFILE_PRESETS: Record<StreamProfileId, Partial<Settings>> = {
    performance: {
        bitrate: 10000,
        packetSize: 1024,
        fps: 59,
        videoCodec: "h265",
        videoFrameQueueSize: 2,
        videoSize: "1080p",
        videoSizeCustom: { width: 1920, height: 1080 },
        forceVideoElementRenderer: true,
        canvasRenderer: false,
        canvasVsync: false,
        playAudioLocal: false,
        audioSampleQueueSize: 4,
        dataTransport: "webrtc",
        hdr: false,
    },
    balance: {
        bitrate: 10000,
        packetSize: 1024,
        fps: 59,
        videoCodec: "h265",
        videoSize: "1440p",
        videoSizeCustom: { width: 2560, height: 1440 },
        videoFrameQueueSize: 4,
        forceVideoElementRenderer: true,
        canvasRenderer: false,
        canvasVsync: false,
        playAudioLocal: false,
        audioSampleQueueSize: 6,
        dataTransport: "webrtc",
        hdr: false,
    },
    quality: {
        bitrate: 10000,
        packetSize: 1024,
        fps: 59,
        videoCodec: "h265",
        videoSize: "4k",
        videoSizeCustom: { width: 3840, height: 2160 },
        videoFrameQueueSize: 6,
        forceVideoElementRenderer: true,
        canvasRenderer: false,
        canvasVsync: false,
        playAudioLocal: false,
        audioSampleQueueSize: 12,
        dataTransport: "webrtc",
        hdr: false,
    },
}

function cloneSettings(base: Settings): Settings {
    if ("structuredClone" in window) {
        return structuredClone(base) as Settings
    }
    return JSON.parse(JSON.stringify(base)) as Settings
}

export function applyStreamProfileToSettings(base: Settings, id: StreamProfileId): Settings {
    const out = cloneSettings(base)
    const overlay = STREAM_PROFILE_PRESETS[id]
    Object.assign(out, overlay)
    if (overlay.videoSizeCustom) {
        out.videoSizeCustom = {
            width: overlay.videoSizeCustom.width,
            height: overlay.videoSizeCustom.height,
        }
    }
    return out
}

export function readProfileFromQuery(params: URLSearchParams): StreamProfileId | null {
    const raw = params.get("profile")
    if (raw == null) return null
    const p = raw.toLowerCase()
    if (p === "performance" || p === "balance" || p === "quality") {
        return p as StreamProfileId
    }
    return null
}

/** Merge preset into current mlSettings base and persist; set label key for optional UI. */
export function persistStreamProfileChoice(id: StreamProfileId): void {
    const base = getLocalStreamSettings() ?? defaultSettings()
    const merged = applyStreamProfileToSettings(base, id)
    setLocalStreamSettings(merged)
    setStreamProfileLabel(id)
}
