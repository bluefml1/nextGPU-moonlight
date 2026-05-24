/** localStorage key for "last chosen stream profile" labels only — never used to skip the profile gate. */

export const ML_STREAM_PROFILE_STORAGE_KEY = "mlStreamProfile"

export function setStreamProfileLabel(id: string): void {
    localStorage.setItem(ML_STREAM_PROFILE_STORAGE_KEY, id)
}

export function clearStreamProfileLabel(): void {
    localStorage.removeItem(ML_STREAM_PROFILE_STORAGE_KEY)
}

/** Raw profile id from storage, or null if unset / unknown. */
export function getActiveStreamProfileId(): string | null {
    try {
        const raw = localStorage.getItem(ML_STREAM_PROFILE_STORAGE_KEY)
        if (raw == null || raw === "") {
            return null
        }
        const lower = raw.toLowerCase()
        if (lower === "performance" || lower === "balance" || lower === "quality") {
            return lower
        }
        return null
    } catch {
        return null
    }
}

/** Human-readable title for mlStreamProfile, or null if unset / unknown. */
export function getActiveStreamProfileTitle(): string | null {
    const id = getActiveStreamProfileId()
    if (id === "performance") {
        return "Hiệu năng"
    }
    if (id === "balance") {
        return "Cân bằng"
    }
    if (id === "quality") {
        return "Chất lượng"
    }
    return null
}
