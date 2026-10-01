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
const OUTLINE_DARK_THRESHOLD = 96

export function isHostCursorHidden(cursor: HostCursorPacket): boolean {
    return !cursor.visible || cursor.width <= 0 || cursor.height <= 0 || cursor.rgba.length === 0
}

// Inverting cursors such as the Windows I-beam arrive as plain white pixels because browsers
// cannot XOR with the page, so without a dark edge they vanish on light backgrounds.
function needsDarkOutline(cursor: HostCursorPacket): boolean {
    let hasOpaque = false
    for (let i = 0; i + 3 < cursor.rgba.length; i += 4) {
        if ((cursor.rgba[i + 3] ?? 0) === 0) {
            continue
        }
        hasOpaque = true
        const brightest = Math.max(cursor.rgba[i] ?? 0, cursor.rgba[i + 1] ?? 0, cursor.rgba[i + 2] ?? 0)
        if (brightest < OUTLINE_DARK_THRESHOLD) {
            return false
        }
    }
    return hasOpaque
}

// Returns the bitmap padded by 1px on every side with black added around every opaque pixel.
function addDarkOutline(rgba: Array<number>, width: number, height: number): Uint8ClampedArray {
    const outWidth = width + 2
    const outHeight = height + 2
    const out = new Uint8ClampedArray(outWidth * outHeight * 4)

    const isOpaque = (x: number, y: number) =>
        x >= 0 && y >= 0 && x < width && y < height && (rgba[(y * width + x) * 4 + 3] ?? 0) !== 0

    for (let oy = 0; oy < outHeight; oy++) {
        for (let ox = 0; ox < outWidth; ox++) {
            const x = ox - 1
            const y = oy - 1
            const o = (oy * outWidth + ox) * 4

            if (isOpaque(x, y)) {
                const s = (y * width + x) * 4
                out[o] = rgba[s] ?? 0
                out[o + 1] = rgba[s + 1] ?? 0
                out[o + 2] = rgba[s + 2] ?? 0
                out[o + 3] = rgba[s + 3] ?? 0
                continue
            }

            let touchesOpaque = false
            for (let dy = -1; dy <= 1 && !touchesOpaque; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if ((dx !== 0 || dy !== 0) && isOpaque(x + dx, y + dy)) {
                        touchesOpaque = true
                        break
                    }
                }
            }
            if (touchesOpaque) {
                out[o + 3] = 255
            }
        }
    }

    return out
}

export function buildHostCursorFrame(cursor: HostCursorPacket): HostCursorFrame | null {
    if (isHostCursorHidden(cursor)) {
        return null
    }

    let width = cursor.width
    let height = cursor.height
    let sourceHotspotX = cursor.hotspot_x
    let sourceHotspotY = cursor.hotspot_y
    let pixels: ArrayLike<number> = cursor.rgba
    if (needsDarkOutline(cursor)) {
        pixels = addDarkOutline(cursor.rgba, width, height)
        width += 2
        height += 2
        sourceHotspotX += 1
        sourceHotspotY += 1
    }

    const renderWidth = Math.min(width, MAX_CURSOR_SIZE)
    const renderHeight = Math.min(height, MAX_CURSOR_SIZE)

    let checksum = 2166136261 >>> 0
    for (let i = 0; i < cursor.rgba.length; i++) {
        checksum ^= (cursor.rgba[i] ?? 0) & 0xff
        checksum = Math.imul(checksum, 16777619) >>> 0
    }
    const signature = `${cursor.width}x${cursor.height}:${cursor.hotspot_x},${cursor.hotspot_y}:${cursor.rgba.length}:${checksum}`

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) {
        return null
    }

    const imageData = ctx.createImageData(width, height)
    const maxLen = Math.min(imageData.data.length, pixels.length)
    for (let i = 0; i < maxLen; i++) {
        imageData.data[i] = pixels[i]
    }
    ctx.putImageData(imageData, 0, 0)

    let dataUrl = canvas.toDataURL("image/png")
    let hotspotX = sourceHotspotX
    let hotspotY = sourceHotspotY

    if (renderWidth !== width || renderHeight !== height) {
        const scaled = document.createElement("canvas")
        scaled.width = renderWidth
        scaled.height = renderHeight
        const scaledCtx = scaled.getContext("2d")
        if (scaledCtx) {
            scaledCtx.drawImage(canvas, 0, 0, renderWidth, renderHeight)
            dataUrl = scaled.toDataURL("image/png")
            hotspotX = Math.round((sourceHotspotX * renderWidth) / width)
            hotspotY = Math.round((sourceHotspotY * renderHeight) / height)
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
