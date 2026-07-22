/** Client-side cursor overlay — host bitmap when available, default arrow otherwise. */

import type { HostCursorFrame } from "./host_cursor_frame.js"

const ROOT_ID = "ml-software-cursor"
const MARGIN_PX = 4

const DEFAULT_CURSOR = {
    dataUrl:
        "data:image/svg+xml," +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
            '<path fill="#fff" stroke="#000" stroke-width="1" d="M4 4 L4 18 L9 13 L13 20 L16 18 L12 11 L18 11 Z"/>' +
            "</svg>"
        ),
    renderWidth: 24,
    renderHeight: 24,
    hotspotX: 4,
    hotspotY: 4,
}

export class SoftwareCursor {
    private readonly root = document.createElement("div")
    private readonly img = document.createElement("img")
    private mounted = false
    private visible = false
    private x = 0
    private y = 0
    private hasPosition = false
    private clampLeft = 0
    private clampTop = 0
    private clampRight = 0
    private clampBottom = 0
    private hostFrame: HostCursorFrame | null = null

    constructor() {
        this.root.id = ROOT_ID
        this.root.className = "ml-software-cursor ml-software-cursor--host"
        this.root.setAttribute("aria-hidden", "true")
        this.img.className = "ml-software-cursor__img"
        this.img.alt = ""
        this.img.draggable = false
        this.applyCursorImage()
        this.root.appendChild(this.img)
        this.root.style.display = "none"
    }

    mount(parent: HTMLElement = document.body): void {
        if (this.mounted) return
        parent.appendChild(this.root)
        this.mounted = true
    }

    unmount(): void {
        if (!this.mounted) return
        this.root.remove()
        this.mounted = false
        this.visible = false
    }

    isVisible(): boolean {
        return this.visible
    }

    getPositionClient(): { x: number; y: number } | null {
        if (!this.hasPosition) return null
        return { x: this.x, y: this.y }
    }

    setHostFrame(frame: HostCursorFrame | null): void {
        this.hostFrame = frame
        this.applyCursorImage()
        if (this.hasPosition) {
            this.clampAndApply()
        }
    }

    clearHostFrame(): void {
        this.setHostFrame(null)
    }

    setClampRect(rect: DOMRect): void {
        this.clampLeft = rect.left + MARGIN_PX
        this.clampTop = rect.top + MARGIN_PX
        this.clampRight = rect.right - MARGIN_PX
        this.clampBottom = rect.bottom - MARGIN_PX
        if (this.hasPosition) {
            this.clampAndApply()
        }
    }

    /** Show/hide. When newly shown without a position, seed to clamp-rect center. */
    setVisible(visible: boolean, opts?: { recenter?: boolean }): void {
        const wasVisible = this.visible
        this.visible = visible
        this.root.style.display = visible ? "block" : "none"
        if (!visible) return
        if (!wasVisible || opts?.recenter || !this.hasPosition) {
            this.seedToCenter()
        } else {
            this.clampAndApply()
        }
    }

    setPositionClient(x: number, y: number): void {
        this.x = x
        this.y = y
        this.hasPosition = true
        this.clampAndApply()
    }

    moveByClient(dx: number, dy: number): void {
        if (!this.hasPosition) {
            this.seedToCenter()
        }
        this.x += dx
        this.y += dy
        this.clampAndApply()
    }

    private applyCursorImage(): void {
        const frame = this.hostFrame
        if (frame) {
            this.img.src = frame.dataUrl
            this.img.width = frame.renderWidth
            this.img.height = frame.renderHeight
        } else {
            this.img.src = DEFAULT_CURSOR.dataUrl
            this.img.width = DEFAULT_CURSOR.renderWidth
            this.img.height = DEFAULT_CURSOR.renderHeight
        }
    }

    private activeHotspot(): { x: number; y: number } {
        if (this.hostFrame) {
            return { x: this.hostFrame.hotspotX, y: this.hostFrame.hotspotY }
        }
        return { x: DEFAULT_CURSOR.hotspotX, y: DEFAULT_CURSOR.hotspotY }
    }

    private seedToCenter(): void {
        const { vw, vh } = this.viewportFallback()
        const left = this.clampRight > this.clampLeft ? this.clampLeft : MARGIN_PX
        const top = this.clampBottom > this.clampTop ? this.clampTop : MARGIN_PX
        const right = this.clampRight > this.clampLeft ? this.clampRight : vw - MARGIN_PX
        const bottom = this.clampBottom > this.clampTop ? this.clampBottom : vh - MARGIN_PX
        this.x = (left + right) / 2
        this.y = (top + bottom) / 2
        this.hasPosition = true
        this.clampAndApply()
    }

    private clampAndApply(): void {
        const { vw, vh } = this.viewportFallback()
        const left = this.clampRight > this.clampLeft ? this.clampLeft : MARGIN_PX
        const top = this.clampBottom > this.clampTop ? this.clampTop : MARGIN_PX
        const right = this.clampRight > this.clampLeft ? this.clampRight : vw - MARGIN_PX
        const bottom = this.clampBottom > this.clampTop ? this.clampBottom : vh - MARGIN_PX
        this.x = Math.max(left, Math.min(right, this.x))
        this.y = Math.max(top, Math.min(bottom, this.y))

        const hotspot = this.activeHotspot()
        this.root.style.transform = "none"
        this.root.style.left = `${Math.round(this.x - hotspot.x)}px`
        this.root.style.top = `${Math.round(this.y - hotspot.y)}px`
    }

    private viewportFallback(): { vw: number; vh: number } {
        return {
            vw: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
            vh: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0),
        }
    }
}
