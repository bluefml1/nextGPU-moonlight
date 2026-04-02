/**
 * Stream settings shared with the main Moonlight Web settings screen.
 * - Runtime: primary storage is localStorage `mlSettings` (same as `setLocalStreamSettings` on the main page).
 * - Legacy: older builds used `mlAppSettings` per appId; that map is still read as a fallback when `mlSettings`
 *   is empty, and entries are removed when you save from the stream so data converges on one profile.
 * - File: optional web/app_settings.json (per appId) is merged as defaults before user settings.
 */

import { buildUrl } from "./config_.js";
import {
    defaultSettings,
    getLocalStreamSettings,
    setLocalStreamSettings,
    Settings,
} from "./component/settings_menu.js";

const LEGACY_PER_APP_KEY = "mlAppSettings";
const SETTINGS_FILE_PATH = "/app_settings.json";

export type AppSettingsMap = Record<string, Settings>;

let staticFileCache: AppSettingsMap | null = null;

function loadLegacyPerAppMap(): AppSettingsMap {
    try {
        const raw = localStorage.getItem(LEGACY_PER_APP_KEY);
        if (raw == null) return {};
        const parsed = JSON.parse(raw) as AppSettingsMap;
        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
        localStorage.removeItem(LEGACY_PER_APP_KEY);
        return {};
    }
}

function saveLegacyPerAppMap(map: AppSettingsMap): void {
    if (Object.keys(map).length === 0) {
        localStorage.removeItem(LEGACY_PER_APP_KEY);
        return;
    }
    localStorage.setItem(LEGACY_PER_APP_KEY, JSON.stringify(map));
}

function migratePageStyle(settings: Settings): void {
    if ((settings as any).pageStyle === "old") {
        (settings as any).pageStyle = "moonlight";
    }
}

/**
 * Fetch app_settings.json from the server once and cache it. Merged per app_id before user settings.
 */
export async function loadStaticAppSettingsFile(): Promise<AppSettingsMap | null> {
    if (staticFileCache !== null) return staticFileCache;
    try {
        const url = buildUrl(SETTINGS_FILE_PATH);
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return null;
        const data = (await res.json()) as AppSettingsMap;
        if (typeof data !== "object" || data === null) return null;
        staticFileCache = data;
        return staticFileCache;
    } catch {
        return null;
    }
}

/**
 * Get stream settings for a given app_id.
 * Precedence: global mlSettings > legacy per-app mlAppSettings (only if mlSettings is absent) >
 * static app_settings.json (per-app) > defaults.
 */
export function getSettingsForApp(appId: number): Settings {
    const key = String(appId);
    const base = defaultSettings();

    if (staticFileCache != null) {
        const fileSettings = staticFileCache[key];
        if (fileSettings != null) {
            Object.assign(base, fileSettings);
        }
    }

    const global = getLocalStreamSettings();
    if (global != null) {
        Object.assign(base, global);
        migratePageStyle(base);
        return base;
    }

    const legacyMap = loadLegacyPerAppMap();
    const legacy = legacyMap[key];
    if (legacy != null) {
        Object.assign(base, legacy);
    }

    migratePageStyle(base);
    return base;
}

/**
 * Save stream settings: same storage as the main settings page (`mlSettings`). Clears legacy per-app row for this app.
 */
export function setSettingsForApp(appId: number, settings: Settings): void {
    setLocalStreamSettings(settings);
    const legacyMap = loadLegacyPerAppMap();
    const key = String(appId);
    if (legacyMap[key] != null) {
        delete legacyMap[key];
        saveLegacyPerAppMap(legacyMap);
    }
}

/**
 * Return app IDs that still have rows in legacy per-app storage (older builds).
 */
export function getAppIdsWithSavedSettings(): number[] {
    const map = loadLegacyPerAppMap();
    return Object.keys(map)
        .map((k) => Number.parseInt(k, 10))
        .filter((n) => Number.isInteger(n));
}

function isSettingsShape(o: object): o is Partial<Settings> {
    return typeof (o as { bitrate?: unknown }).bitrate === "number";
}

/**
 * Export current shared settings as JSON (single Settings object, same fields as the main page).
 */
export function exportAppSettingsToJson(): string {
    const merged = defaultSettings();
    const g = getLocalStreamSettings();
    if (g != null) Object.assign(merged, g);
    return JSON.stringify(merged, null, 2);
}

/**
 * Trigger download of app_settings.json with current settings.
 */
export function exportAppSettingsToFile(): void {
    const json = exportAppSettingsToJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "app_settings.json";
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Import JSON: either one Settings object, or a legacy map of appId → Settings (merged into one profile; last key wins).
 */
export function importAppSettingsFromJson(json: string): void {
    try {
        const imported = JSON.parse(json) as unknown;
        if (typeof imported !== "object" || imported === null) return;

        const merged = defaultSettings();

        if (isSettingsShape(imported)) {
            Object.assign(merged, imported);
            migratePageStyle(merged as Settings);
            setLocalStreamSettings(merged as Settings);
            return;
        }

        const map = imported as Record<string, unknown>;
        for (const key of Object.keys(map)) {
            const val = map[key];
            if (typeof val === "object" && val !== null && isSettingsShape(val as object)) {
                Object.assign(merged, val as Partial<Settings>);
            }
        }
        migratePageStyle(merged as Settings);
        setLocalStreamSettings(merged as Settings);
    } catch {
        // invalid json, do nothing
    }
}
