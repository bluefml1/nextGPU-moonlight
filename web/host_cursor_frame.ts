/** Shared host cursor bitmap + hotspot builder for PC CSS cursor and phone overlay. */

export type HostCursorPacket = {
    visible: boolean
    width: number
    height: number
    hotspot_x: number
    hotspot_y: number
    rgba: Array<number>
}

export type HostCursorFrame = {
    dataUrl: string
    renderWidth: number
    renderHeight: number
    hotspotX: number
    hotspotY: number
    signature: string
    sourceWidth: number
    sourceHeight: number
}

const MAX_CURSOR_SIZE = 128

export function isHostCursorHidden(cursor: HostCursorPacket): boolean {
    return !cursor.visible || cursor.width <= 0 || cursor.height <= 0 || cursor.rgba.length === 0
}

export function buildHostCursorFrame(cursor: HostCursorPacket): HostCursorFrame | null {
    if (isHostCursorHidden(cursor)) {
        return null
    }

    const renderWidth = Math.min(cursor.width, MAX_CURSOR_SIZE)
    const renderHeight = Math.min(cursor.height, MAX_CURSOR_SIZE)

    let checksum = 2166136261 >>> 0
    for (let i = 0; i < cursor.rgba.length; i++) {
        checksum ^= (cursor.rgba[i] ?? 0) & 0xff
        checksum = Math.imul(checksum, 16777619) >>> 0
    }
    const signature = `${cursor.width}x${cursor.height}:${cursor.hotspot_x},${cursor.hotspot_y}:${cursor.rgba.length}:${checksum}`

    const canvas = document.createElement("canvas")
    canvas.width = cursor.width
    canvas.height = cursor.height
    const ctx = canvas.getContext("2d")
    if (!ctx) {
        return null
    }

    const imageData = ctx.createImageData(cursor.width, cursor.height)
    const rgba = cursor.rgba
    const maxLen = Math.min(imageData.data.length, rgba.length)
    for (let i = 0; i < maxLen; i++) {
        imageData.data[i] = rgba[i]
    }
    ctx.putImageData(imageData, 0, 0)

    let dataUrl = canvas.toDataURL("image/png")
    let hotspotX = cursor.hotspot_x
    let hotspotY = cursor.hotspot_y

    if (renderWidth !== cursor.width || renderHeight !== cursor.height) {
        const scaled = document.createElement("canvas")
        scaled.width = renderWidth
        scaled.height = renderHeight
        const scaledCtx = scaled.getContext("2d")
        if (scaledCtx) {
            scaledCtx.drawImage(canvas, 0, 0, renderWidth, renderHeight)
            dataUrl = scaled.toDataURL("image/png")
            hotspotX = Math.round((cursor.hotspot_x * renderWidth) / cursor.width)
            hotspotY = Math.round((cursor.hotspot_y * renderHeight) / cursor.height)
        }
    }

    hotspotX = Math.max(0, Math.min(hotspotX, renderWidth - 1))
    hotspotY = Math.max(0, Math.min(hotspotY, renderHeight - 1))

    return {
        dataUrl,
        renderWidth,
        renderHeight,
        hotspotX,
        hotspotY,
        signature,
        sourceWidth: cursor.width,
        sourceHeight: cursor.height,
    }
}
