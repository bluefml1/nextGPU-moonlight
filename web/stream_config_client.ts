import type { ConfigJs } from "./api_bindings.js"
import { buildUrl } from "./config_.js"

export function parseConfigJsExport(body: string): Partial<ConfigJs> | null {
    const match = body.match(/export\s+default\s+(\{[\s\S]*\})\s*;?\s*$/)
    if (!match) return null
    try {
        return JSON.parse(match[1]) as Partial<ConfigJs>
    } catch {
        return null
    }
}

export async function fetchStreamConfig(): Promise<Partial<ConfigJs> | null> {
    try {
        const res = await fetch(buildUrl("/config.js"), { cache: "no-store" })
        if (!res.ok) return null
        return parseConfigJsExport(await res.text())
    } catch {
        return null
    }
}
