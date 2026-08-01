/** Phone-only radial fan FAB (Keyboard / Controller / Mouse / HUD). */

export type MobileFabActionId = "keyboard" | "controller" | "hud" | "mouse"

export type MobileFabMenuDeps = {
    onKeyboard: () => void
    onController: () => void
    onHud: () => void
    onMouse: () => void
    /** Called when open state changes (for syncing active indicators). */
    onOpenChange?: (open: boolean) => void
}

export type MobileFabActiveState = {
    keyboard?: boolean
    controller?: boolean
    hud?: boolean
    /** True when Follow mouse mode is active (vs Touch). */
    mouseFollow?: boolean
}

const ROOT_ID = "ml-mobile-fab-menu"
/** Bumped from v1 — that key often stored a bogus top-left from clamping while `display:none`. */
const POS_STORAGE_KEY = "ml.mobileFab.pos.v2"
const DRAG_THRESHOLD_PX = 6
/** Hold still this long to unlock FAB reposition (separate from slide-to-select). */
const HOLD_TO_DRAG_MS = 480
/** Extra hit padding when sliding from the primary FAB onto a satellite. */
const SLIDE_HIT_PAD_PX = 14

type ActionDef = {
    id: MobileFabActionId
    label: string
    iconSrc: string
    invertIcon?: boolean
}

/** Arc order along the 90° fan: keyboard, controller, mouse, layers/HUD. */
const ACTIONS: ActionDef[] = [
    { id: "keyboard", label: "Keyboard", iconSrc: "resources/nextgpu-keyboard.svg" },
    { id: "controller", label: "Virtual controller", iconSrc: "resources/game-controller.svg", invertIcon: true },
    { id: "mouse", label: "Touch / Follow mouse", iconSrc: "resources/mouse-pointer-click.svg", invertIcon: true },
    { id: "hud", label: "Toggle HUD", iconSrc: "resources/layers-plus.svg", invertIcon: true },
]

/** Standard math degrees: 0° = right, 90° = up, 180° = left, 270° = down. */
function fanArcForPosition(centerX: number, centerY: number, vw: number, vh: number): {
    startDeg: number
    endDeg: number
} {
    const preferRight = centerX < vw / 2
    const preferDown = centerY < vh / 2
    if (preferRight && preferDown) {
        // Top-left → fan right + down (0° → -90°)
        return { startDeg: 0, endDeg: -90 }
    }
    if (!preferRight && preferDown) {
        // Top-right → fan left + down
        return { startDeg: 180, endDeg: 270 }
    }
    if (preferRight && !preferDown) {
        // Bottom-left → fan right + up
        return { startDeg: 0, endDeg: 90 }
    }
    // Bottom-right (default) → fan left + up
    return { startDeg: 180, endDeg: 90 }
}

function degToRad(deg: number): number {
    return (deg * Math.PI) / 180
}

function viewportSize(): { vw: number; vh: number } {
    return {
        vw: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
        vh: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0),
    }
}

export class MobileFabMenu {
    private readonly root = document.createElement("div")
    private readonly backdrop = document.createElement("button")
    private readonly primary = document.createElement("button")
    private readonly primaryIcon = document.createElement("span")
    private readonly dragHint = document.createElement("div")
    private readonly satellites = new Map<MobileFabActionId, HTMLButtonElement>()
    private readonly deps: MobileFabMenuDeps
    private open = false
    private mounted = false
    private dragPointerId: number | null = null
    private dragStartX = 0
    private dragStartY = 0
    private dragOffsetX = 0
    private dragOffsetY = 0
    private dragged = false
    /** True after hold timer — finger movement repositions the FAB. */
    private dragArmed = false
    private holdTimer: ReturnType<typeof setTimeout> | null = null
    private suppressClickUntilMs = 0
    /** True when this gesture opened the menu (tap should leave it open, not toggle closed). */
    private openedByThisGesture = false
    /** True when the finger slid onto a satellite during this gesture. */
    private slideSelecting = false
    private slideHoverId: MobileFabActionId | null = null
    private readonly onResize = () => this.clampToViewport()

    constructor(deps: MobileFabMenuDeps) {
        this.deps = deps
        this.root.id = ROOT_ID
        this.root.className = "ml-mobile-fab"
        this.root.setAttribute("aria-expanded", "false")

        this.backdrop.type = "button"
        this.backdrop.className = "ml-mobile-fab__backdrop"
        this.backdrop.tabIndex = -1
        this.backdrop.setAttribute("aria-label", "Dismiss menu")
        this.backdrop.addEventListener("click", (e) => {
            e.preventDefault()
            e.stopPropagation()
            this.close()
        })

        this.primary.type = "button"
        this.primary.className = "ml-mobile-fab__primary"
        this.primary.setAttribute("aria-label", "Open stream controls")
        this.primary.title = "Stream controls — tap to open, slide to an option, hold to move"
        this.primaryIcon.className = "ml-mobile-fab__primary-icon"
        this.primaryIcon.setAttribute("aria-hidden", "true")
        const primaryImg = document.createElement("img")
        primaryImg.src = "resources/list.svg"
        primaryImg.alt = ""
        primaryImg.className = "ml-mobile-fab__primary-glyph"
        this.primaryIcon.appendChild(primaryImg)
        this.primary.appendChild(this.primaryIcon)

        this.dragHint.className = "ml-mobile-fab__drag-hint"
        this.dragHint.setAttribute("aria-hidden", "true")
        for (const dir of ["n", "e", "s", "w"] as const) {
            const arrow = document.createElement("span")
            arrow.className = `ml-mobile-fab__drag-arrow ml-mobile-fab__drag-arrow--${dir}`
            this.dragHint.appendChild(arrow)
        }
        this.root.appendChild(this.dragHint)

        this.installPrimaryPointer()
        this.primary.addEventListener("click", (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (this.dragged || this.dragArmed || this.slideSelecting) return
            if (Date.now() < this.suppressClickUntilMs) return
            this.toggle()
        })

        ACTIONS.forEach((action, index) => {
            const btn = document.createElement("button")
            btn.type = "button"
            btn.className = "ml-mobile-fab__action"
            btn.dataset.action = action.id
            btn.setAttribute("aria-label", action.label)
            btn.title = action.label
            btn.style.setProperty("--ml-fab-i", String(index))

            const img = document.createElement("img")
            img.src = action.iconSrc
            img.alt = ""
            img.setAttribute("aria-hidden", "true")
            img.className = "ml-mobile-fab__action-icon"
            if (action.invertIcon) {
                img.classList.add("ml-mobile-fab__action-icon--invert")
            }
            btn.appendChild(img)

            btn.addEventListener("click", (e) => {
                e.preventDefault()
                e.stopPropagation()
                this.handleAction(action.id)
            })

            this.satellites.set(action.id, btn)
            this.root.appendChild(btn)
        })

        this.root.appendChild(this.backdrop)
        this.root.appendChild(this.primary)
        // Default = CSS `right`/`bottom`. Only override with left/top after a user drag (or restore).
        this.applyCssDefaultBottomRight()
        this.restorePosition()
    }

    mount(parent: HTMLElement = document.body): void {
        if (this.mounted) return
        parent.appendChild(this.root)
        window.addEventListener("resize", this.onResize)
        this.mounted = true
        // Do not clamp here — root is still `display:none` until setVisible(true).
    }

    unmount(): void {
        if (!this.mounted) return
        this.close()
        this.endPointerSession()
        window.removeEventListener("resize", this.onResize)
        this.root.remove()
        this.mounted = false
    }

    setVisible(visible: boolean): void {
        this.root.classList.toggle("ml-mobile-fab--visible", visible)
        if (!visible) {
            this.close()
            return
        }
        // Measure only after the FAB is actually shown (avoids 0×0 → top-left clamp).
        requestAnimationFrame(() => {
            if (!this.root.classList.contains("ml-mobile-fab--visible")) return
            this.clampToViewport()
        })
    }

    isOpen(): boolean {
        return this.open
    }

    openMenu(): void {
        if (this.open) return
        this.layoutSatelliteArc()
        this.clearSlideHover()
        this.open = true
        this.root.classList.add("ml-mobile-fab--open")
        this.root.setAttribute("aria-expanded", "true")
        this.primary.setAttribute("aria-label", "Close stream controls")
        this.deps.onOpenChange?.(true)
    }

    close(): void {
        if (!this.open) return
        this.open = false
        this.clearSlideHover()
        this.root.classList.remove("ml-mobile-fab--open")
        this.root.setAttribute("aria-expanded", "false")
        this.primary.setAttribute("aria-label", "Open stream controls")
        this.deps.onOpenChange?.(false)
    }

    toggle(): void {
        if (this.open) this.close()
        else this.openMenu()
    }

    setActiveState(state: MobileFabActiveState): void {
        this.setActionActive("keyboard", !!state.keyboard)
        this.setActionActive("controller", !!state.controller)
        this.setActionActive("hud", !!state.hud)
        this.setActionActive("mouse", !!state.mouseFollow)
        const mouseBtn = this.satellites.get("mouse")
        if (mouseBtn) {
            mouseBtn.title = state.mouseFollow ? "Follow mouse (tap for Touch)" : "Touch (tap for Follow)"
            mouseBtn.setAttribute(
                "aria-label",
                state.mouseFollow ? "Switch to Touch mode" : "Switch to Follow mouse"
            )
        }
        const hudBtn = this.satellites.get("hud")
        if (hudBtn) {
            hudBtn.title = state.hud ? "Hide HUD" : "Show HUD"
            hudBtn.setAttribute("aria-label", state.hud ? "Hide HUD" : "Show HUD")
        }
    }

    private setActionActive(id: MobileFabActionId, active: boolean): void {
        this.satellites.get(id)?.classList.toggle("ml-mobile-fab__action--active", active)
    }

    private handleAction(id: MobileFabActionId): void {
        switch (id) {
            case "keyboard":
                this.deps.onKeyboard()
                break
            case "controller":
                this.deps.onController()
                break
            case "hud":
                this.deps.onHud()
                break
            case "mouse":
                this.deps.onMouse()
                break
        }
        this.close()
    }

    private installPrimaryPointer(): void {
        this.primary.addEventListener("pointerdown", (event: PointerEvent) => {
            if (event.button !== 0 && event.pointerType === "mouse") return
            this.clearHoldTimer()
            this.dragPointerId = event.pointerId
            this.dragged = false
            this.dragArmed = false
            this.slideSelecting = false
            this.slideHoverId = null
            this.openedByThisGesture = !this.open
            this.dragStartX = event.clientX
            this.dragStartY = event.clientY
            const rect = this.root.getBoundingClientRect()
            this.dragOffsetX = event.clientX - rect.left
            this.dragOffsetY = event.clientY - rect.top
            this.setDragHintVisible(false)
            try {
                this.primary.setPointerCapture(event.pointerId)
            } catch {
                /* ignore */
            }
            // Open immediately so the user can slide onto an option in the same gesture.
            if (!this.open) {
                this.openMenu()
            }
            this.holdTimer = setTimeout(() => {
                this.holdTimer = null
                if (this.dragPointerId == null || this.slideSelecting) return
                // Hold still long enough → unlock reposition; cancel slide-select for this gesture.
                this.dragArmed = true
                this.clearSlideHover()
                this.close()
                this.setDragHintVisible(true)
                this.root.classList.add("ml-mobile-fab--drag-armed")
            }, HOLD_TO_DRAG_MS)
            document.addEventListener("pointermove", this.onPointerMove)
            document.addEventListener("pointerup", this.onPointerEnd)
            document.addEventListener("pointercancel", this.onPointerEnd)
        })
    }

    private readonly onPointerMove = (event: PointerEvent): void => {
        if (this.dragPointerId == null || event.pointerId !== this.dragPointerId) return
        const dx = event.clientX - this.dragStartX
        const dy = event.clientY - this.dragStartY
        const dist = Math.hypot(dx, dy)

        // Before hold unlocks drag: movement is slide-to-select only (never reposition).
        if (!this.dragArmed) {
            if (dist > DRAG_THRESHOLD_PX) {
                // Finger left the primary — cancel hold-to-drag so slide stays the gesture.
                this.clearHoldTimer()
            }
            const hoverId = this.hitTestSatellite(event.clientX, event.clientY)
            if (hoverId) {
                this.slideSelecting = true
                this.setSlideHover(hoverId)
            } else {
                this.setSlideHover(null)
            }
            return
        }

        // Drag-armed: reposition FAB.
        if (!this.dragged && dist > DRAG_THRESHOLD_PX) {
            this.dragged = true
            this.root.classList.add("ml-mobile-fab--dragging")
        }
        if (!this.dragged) return
        event.preventDefault()
        this.setRootPosition(event.clientX - this.dragOffsetX, event.clientY - this.dragOffsetY)
    }

    private readonly onPointerEnd = (event: PointerEvent): void => {
        if (this.dragPointerId == null || event.pointerId !== this.dragPointerId) return
        const wasDragging = this.dragged
        const wasDragArmed = this.dragArmed
        const hoverId = this.slideHoverId
        const openedByThisGesture = this.openedByThisGesture
        const wasSlideSelecting = this.slideSelecting

        this.clearSlideHover()
        this.endPointerSession()

        if (wasDragging || wasDragArmed) {
            event.preventDefault()
            event.stopPropagation()
            this.suppressClickUntilMs = Date.now() + 500
            if (wasDragging) {
                this.persistPosition()
                this.layoutSatelliteArc()
            }
            return
        }

        if (hoverId) {
            event.preventDefault()
            event.stopPropagation()
            this.suppressClickUntilMs = Date.now() + 500
            this.handleAction(hoverId)
            return
        }

        // Tap that opened the menu: leave it open. Tap while already open: close.
        this.suppressClickUntilMs = Date.now() + 500
        if (!openedByThisGesture && !wasSlideSelecting) {
            this.close()
        }
    }

    private hitTestSatellite(clientX: number, clientY: number): MobileFabActionId | null {
        if (!this.open) return null
        let best: MobileFabActionId | null = null
        let bestDist = Infinity
        for (const [id, btn] of this.satellites) {
            const rect = btn.getBoundingClientRect()
            const pad = SLIDE_HIT_PAD_PX
            if (
                clientX < rect.left - pad ||
                clientX > rect.right + pad ||
                clientY < rect.top - pad ||
                clientY > rect.bottom + pad
            ) {
                continue
            }
            const cx = (rect.left + rect.right) / 2
            const cy = (rect.top + rect.bottom) / 2
            const dist = Math.hypot(clientX - cx, clientY - cy)
            if (dist < bestDist) {
                bestDist = dist
                best = id
            }
        }
        return best
    }

    private setSlideHover(id: MobileFabActionId | null): void {
        if (this.slideHoverId === id) return
        if (this.slideHoverId) {
            this.satellites.get(this.slideHoverId)?.classList.remove("ml-mobile-fab__action--slide-hover")
        }
        this.slideHoverId = id
        if (id) {
            this.satellites.get(id)?.classList.add("ml-mobile-fab__action--slide-hover")
        }
    }

    private clearSlideHover(): void {
        this.setSlideHover(null)
        this.slideSelecting = false
    }

    private clearHoldTimer(): void {
        if (this.holdTimer != null) {
            clearTimeout(this.holdTimer)
            this.holdTimer = null
        }
    }

    private setDragHintVisible(visible: boolean): void {
        this.root.classList.toggle("ml-mobile-fab--drag-hint", visible)
    }

    private endPointerSession(): void {
        this.clearHoldTimer()
        this.dragPointerId = null
        this.dragArmed = false
        this.openedByThisGesture = false
        this.setDragHintVisible(false)
        this.root.classList.remove("ml-mobile-fab--dragging")
        this.root.classList.remove("ml-mobile-fab--drag-armed")
        document.removeEventListener("pointermove", this.onPointerMove)
        document.removeEventListener("pointerup", this.onPointerEnd)
        document.removeEventListener("pointercancel", this.onPointerEnd)
    }

    private hasCustomPosition(): boolean {
        return Boolean(this.root.style.left) && Boolean(this.root.style.top)
    }

    private setRootPosition(left: number, top: number): void {
        const size = this.root.offsetWidth || 48
        const { vw, vh } = viewportSize()
        const margin = 8
        // Invalid / not-ready viewport — keep CSS bottom-right instead of clamping to (8,8).
        if (vw < size + margin * 2 || vh < size + margin * 2) {
            this.applyCssDefaultBottomRight()
            return
        }
        const clampedLeft = Math.max(margin, Math.min(vw - size - margin, left))
        const clampedTop = Math.max(margin, Math.min(vh - size - margin, top))
        this.root.style.right = "auto"
        this.root.style.bottom = "auto"
        this.root.style.left = `${Math.round(clampedLeft)}px`
        this.root.style.top = `${Math.round(clampedTop)}px`
    }

    /** Clear inline coords so CSS `right`/`bottom` place the FAB at bottom-right. */
    private applyCssDefaultBottomRight(): void {
        this.root.style.left = ""
        this.root.style.top = ""
        this.root.style.right = ""
        this.root.style.bottom = ""
    }

    private clampToViewport(): void {
        if (!this.root.classList.contains("ml-mobile-fab--visible")) return
        const { vw, vh } = viewportSize()
        if (vw < 64 || vh < 64) return

        if (!this.hasCustomPosition()) {
            this.layoutSatelliteArc()
            return
        }

        const rect = this.root.getBoundingClientRect()
        // Hidden / not laid out — never persist a 0×0 top-left reading.
        if (rect.width < 1 || rect.height < 1) return

        this.setRootPosition(rect.left, rect.top)
        this.layoutSatelliteArc()
    }

    /** Point the 90° fan into the quadrant with the most free space. */
    private layoutSatelliteArc(): void {
        const rect = this.root.getBoundingClientRect()
        const { vw, vh } = viewportSize()
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        const { startDeg, endDeg } = fanArcForPosition(centerX, centerY, vw, vh)
        const n = ACTIONS.length
        ACTIONS.forEach((action, index) => {
            const btn = this.satellites.get(action.id)
            if (!btn) return
            const t = n === 1 ? 0 : index / (n - 1)
            const angleDeg = startDeg + (endDeg - startDeg) * t
            const rad = degToRad(angleDeg)
            // 0° = right, 90° = up → x = cos, y = -sin for screen coords
            btn.style.setProperty("--ml-fab-x", String(Math.cos(rad)))
            btn.style.setProperty("--ml-fab-y", String(-Math.sin(rad)))
        })
    }

    private restorePosition(): void {
        try {
            const raw = localStorage.getItem(POS_STORAGE_KEY)
            if (!raw) return
            const o = JSON.parse(raw) as { left?: number; top?: number }
            if (typeof o.left !== "number" || typeof o.top !== "number") return
            if (!Number.isFinite(o.left) || !Number.isFinite(o.top)) return
            this.setRootPosition(o.left, o.top)
        } catch {
            /* ignore */
        }
    }

    private persistPosition(): void {
        if (!this.hasCustomPosition()) return
        try {
            localStorage.setItem(
                POS_STORAGE_KEY,
                JSON.stringify({
                    left: Number.parseFloat(this.root.style.left),
                    top: Number.parseFloat(this.root.style.top),
                })
            )
        } catch {
            /* ignore */
        }
    }
}
