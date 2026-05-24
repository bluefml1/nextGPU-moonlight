import { fetchStreamConfig } from "./stream_config_client.js"
import { streamT } from "./stream_locale.js"

let streamMachineLabel: string | null = null

/** Machine display name from host `domain.txt` via `/config.js`. */
export function getStreamMachineLabel(): string | null {
    return streamMachineLabel
}

async function fetchMachineLabelFromConfig(): Promise<string | null> {
    const cfg = await fetchStreamConfig()
    const name = cfg?.computer_name?.trim()
    return name && name.length > 0 ? name : null
}

/** Load label from server and set `document.title` when available. */
export async function initStreamMachineLabel(): Promise<string | null> {
    const name = await fetchMachineLabelFromConfig()
    if (name) {
        streamMachineLabel = name
        document.title = name
    }
    return streamMachineLabel
}

export function applyStreamDocumentTitle(): void {
    const name = getStreamMachineLabel()
    if (name) document.title = name
}

export function streamLoadingTitle(): string {
    const name = getStreamMachineLabel()
    if (name) return streamT("loading.title", { name })
    return streamT("loading.title.generic")
}
