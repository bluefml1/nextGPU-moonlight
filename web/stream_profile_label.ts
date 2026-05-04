/** localStorage key for "last chosen stream profile" labels only — never used to skip the profile gate. */

export const ML_STREAM_PROFILE_STORAGE_KEY = "mlStreamProfile"

export function setStreamProfileLabel(id: string): void {
    localStorage.setItem(ML_STREAM_PROFILE_STORAGE_KEY, id)
}

export function clearStreamProfileLabel(): void {
    localStorage.removeItem(ML_STREAM_PROFILE_STORAGE_KEY)
}

/** Human-readable title for mlStreamProfile, or null if unset / unknown. */
export function getActiveStreamProfileTitle(): string | null {
    try {
        const raw = localStorage.getItem(ML_STREAM_PROFILE_STORAGE_KEY)
        if (raw == null || raw === "") {
            return null
        }
        const lower = raw.toLowerCase()
        if (lower === "performance") {
            return "Performance"
        }
        if (lower === "balance") {
            return "Balance"
        }
        if (lower === "quality") {
            return "Quality"
        }
        return raw
    } catch {
        return null
    }
}
