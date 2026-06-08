import { buildUrl } from "./config_.js"
import type { StreamProfileId } from "./stream_profile_presets.js"

export type StreamProfileRecommendation = {
    profileId: StreamProfileId
    source: "api" | "fallback"
    speedMbps?: number | null
}

const POLL_ATTEMPTS = 5
const POLL_INTERVAL_MS = 1000

/** Download speed (Mbps) at or below this → Performance (speedtest band 0–150 Mbps inclusive). */
export const SPEED_THRESHOLD_BALANCE_MBPS = 150

/** Download speed (Mbps) above this → Quality; above {@link SPEED_THRESHOLD_BALANCE_MBPS} through here → Balance. */
export const SPEED_THRESHOLD_QUALITY_MBPS = 300

/** @deprecated Use {@link SPEED_THRESHOLD_BALANCE_MBPS} */
export const SPEED_THRESHOLD_PERFORMANCE_MBPS = SPEED_THRESHOLD_BALANCE_MBPS

export function profileIdFromSpeedMbps(mbps: number | null | undefined): StreamProfileId {
    if (mbps == null || !Number.isFinite(mbps)) {
        return "balance"
    }
    if (mbps <= SPEED_THRESHOLD_BALANCE_MBPS) {
        return "performance"
    }
    if (mbps <= SPEED_THRESHOLD_QUALITY_MBPS) {
        return "balance"
    }
    return "quality"
}

function parseSpeedResult(raw: unknown): number | null {
    if (typeof raw === "number" && Number.isFinite(raw)) {
        return raw
    }
    if (typeof raw === "string") {
        const n = Number.parseFloat(raw)
        return Number.isFinite(n) ? n : null
    }
    return null
}

type MachineInfoProxyResponse = {
    success?: boolean
    speed_result?: unknown
}

/** Same-origin proxy (`GET /api/machine-info`) — server calls NextGPU API (no browser CORS). */
async function fetchSpeedResultOnce(): Promise<number | null> {
    const res = await fetch(buildUrl("/api/machine-info"), { cache: "no-store" })
    if (!res.ok) {
        return null
    }

    const json = (await res.json()) as MachineInfoProxyResponse
    if (json.success !== true) {
        return null
    }

    const speed = parseSpeedResult(json.speed_result)
    return speed != null ? Math.round(speed * 100) / 100 : null
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function fetchSpeedResultWithPoll(): Promise<number | null> {
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
        const speed = await fetchSpeedResultOnce()
        if (speed != null) {
            return speed
        }
        if (attempt < POLL_ATTEMPTS - 1) {
            await sleep(POLL_INTERVAL_MS)
        }
    }
    return null
}

export async function fetchRecommendedProfile(): Promise<StreamProfileRecommendation> {
    try {
        const speedMbps = await fetchSpeedResultWithPoll()
        if (speedMbps == null) {
            return { profileId: "balance", source: "fallback", speedMbps: null }
        }

        return {
            profileId: profileIdFromSpeedMbps(speedMbps),
            source: "api",
            speedMbps,
        }
    } catch {
        return { profileId: "balance", source: "fallback", speedMbps: null }
    }
}
