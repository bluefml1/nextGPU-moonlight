// Presets applied by `runStreamProfileGate` in `stream.ts` before ViewerApp starts.
// Fallback defaults (no profile yet) live in `default_settings.ts` (balance-aligned).
import type { Settings } from "./component/settings_menu.js"
import {
    defaultSettings,
    getLocalStreamSettings,
    setLocalStreamSettings,
} from "./component/settings_menu.js"
import { getActiveStreamProfileId, setStreamProfileLabel } from "./stream_profile_label.js"

export type StreamProfileId = "performance" | "balance" | "quality"

export type StreamProfileBitrateTier = {
    minMbps: number
    maxMbps: number
    defaultMbps: number
}

export const PROFILE_BITRATE_TIERS: Record<StreamProfileId, StreamProfileBitrateTier> = {
    performance: { minMbps: 10, maxMbps: 50, defaultMbps: 20 },
    balance: { minMbps: 10, maxMbps: 70, defaultMbps: 40 },
    quality: { minMbps: 10, maxMbps: 120, defaultMbps: 60 },
}

export const RT_BITRATE_STEP = 0.5

/** Same for every profile and `default_settings.ts` — only resolution/bitrate differ by tier. */
export const SHARED_STREAM_TIMING = {
    fps: 118,
    audioSampleQueueSize: 4,
    videoFrameQueueSize: 2,
} as const

export function getBitrateTierForProfile(id: StreamProfileId): StreamProfileBitrateTier {
    return PROFILE_BITRATE_TIERS[id]
}

function profileIdFromVideoSize(videoSize: Settings["videoSize"]): StreamProfileId | null {
    if (videoSize === "1080p") return "performance"
    if (videoSize === "1440p") return "balance"
    if (videoSize === "4k") return "quality"
    return null
}

export function getBitrateTierForSettings(settings: Settings): StreamProfileBitrateTier {
    const stored = getActiveStreamProfileId()
    if (stored === "performance" || stored === "balance" || stored === "quality") {
        return getBitrateTierForProfile(stored)
    }
    const fromSize = profileIdFromVideoSize(settings.videoSize)
    if (fromSize != null) {
        return getBitrateTierForProfile(fromSize)
    }
    return PROFILE_BITRATE_TIERS.balance
}

export function snapBitrateMbpsForTier(mbps: number, tier: StreamProfileBitrateTier): number {
    const c = Math.min(tier.maxMbps, Math.max(tier.minMbps, mbps))
    const steps = Math.round((c - tier.minMbps) / RT_BITRATE_STEP)
    return tier.minMbps + steps * RT_BITRATE_STEP
}

/** Product presets — see DetailDesign/stream_profile_presets_a4b71cf8.plan.md */
const STREAM_PROFILE_PRESETS: Record<StreamProfileId, Partial<Settings>> = {
    performance: {
        ...SHARED_STREAM_TIMING,
        bitrate: 20,
        packetSize: 1024,
        videoCodec: "h265",
        videoSize: "1080p",
        videoSizeCustom: { width: 1920, height: 1080 },
        forceVideoElementRenderer: true,
        canvasRenderer: false,
        canvasVsync: false,
        playAudioLocal: false,
        dataTransport: "webrtc",
        hdr: false,
    },
    balance: {
        ...SHARED_STREAM_TIMING,
        bitrate: 40,
        packetSize: 1024,
        videoCodec: "h265",
        videoSize: "1440p",
        videoSizeCustom: { width: 2560, height: 1440 },
        forceVideoElementRenderer: true,
        canvasRenderer: false,
        canvasVsync: false,
        playAudioLocal: false,
        dataTransport: "webrtc",
        hdr: false,
    },
    quality: {
        ...SHARED_STREAM_TIMING,
        bitrate: 60,
        packetSize: 1024,
        videoCodec: "h265",
        videoSize: "4k",
        videoSizeCustom: { width: 3840, height: 2160 },
        forceVideoElementRenderer: true,
        canvasRenderer: false,
        canvasVsync: false,
        playAudioLocal: false,
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

/** localStorage key — when "1", stats overlay starts minimized (see ViewerApp). */
const STREAM_STATS_MINIMIZED_KEY = "streamStatsMinimized"

/** Merge preset into current mlSettings base and persist; set label key for optional UI. */
export function persistStreamProfileChoice(id: StreamProfileId): void {
    const base = getLocalStreamSettings() ?? defaultSettings()
    const merged = applyStreamProfileToSettings(base, id)
    setLocalStreamSettings(merged)
    setStreamProfileLabel(id)
    // All profiles: show stream stats expanded by default on next load.
    try {
        localStorage.setItem(STREAM_STATS_MINIMIZED_KEY, "0")
    } catch {
        /* ignore quota / private mode */
    }
}
