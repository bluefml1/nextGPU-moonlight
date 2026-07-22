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
const POS_STORAGE_KEY = "ml.mobileFab.pos.v1"
const LAST_ACTION_KEY = "ml.mobileFab.lastAction.v1"
const DRAG_THRESHOLD_PX = 6
/** Hold primary FAB this long (without dragging) to show last action for slide-to-confirm. */
const HOLD_QUICK_PICK_MS = 350

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

const ACTION_IDS = new Set<MobileFabActionId>(ACTIONS.map((a) => a.id))

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
    private suppressClickUntilMs = 0
    private holdTimer: ReturnType<typeof setTimeout> | null = null
    private quickPick = false
    private quickPickAction: MobileFabActionId | null = null
    private quickPickHover = false
    private lastActionId: MobileFabActionId | null = null
    private readonly onResize = () => this.clampToViewport()

    constructor(deps: MobileFabMenuDeps) {
        this.deps = deps
        this.root.id = ROOT_ID
        this.root.className = "ml-mobile-fab"
        this.root.setAttribute("aria-expanded", "false")
        this.lastActionId = this.loadLastAction()

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
        this.primary.title = "Stream controls — hold for last action"
        this.primaryIcon.className = "ml-mobile-fab__primary-icon"
        this.primaryIcon.setAttribute("aria-hidden", "true")
        const primaryImg = document.createElement("img")
        primaryImg.src = "resources/list.svg"
        primaryImg.alt = ""
        primaryImg.className = "ml-mobile-fab__primary-glyph"
        this.primaryIcon.appendChild(primaryImg)
        this.primary.appendChild(this.primaryIcon)
        this.installPrimaryPointer()
        this.primary.addEventListener("click", (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (this.dragged || this.quickPick) return
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
        this.restorePosition()
        this.layoutSatelliteArc()
    }

    mount(parent: HTMLElement = document.body): void {
        if (this.mounted) return
        parent.appendChild(this.root)
        window.addEventListener("resize", this.onResize)
        this.mounted = true
        this.clampToViewport()
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
        if (!visible) this.close()
    }

    isOpen(): boolean {
        return this.open
    }

    openMenu(): void {
        this.endQuickPick(false)
        if (this.open) return
        this.layoutSatelliteArc()
        this.showAllSatellites()
        this.open = true
        this.root.classList.add("ml-mobile-fab--open")
        this.root.setAttribute("aria-expanded", "true")
        this.primary.setAttribute("aria-label", "Close stream controls")
        this.deps.onOpenChange?.(true)
    }

    close(): void {
        this.endQuickPick(false)
        if (!this.open) return
        this.open = false
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
        this.rememberLastAction(id)
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
            this.dragPointerId = event.pointerId
            this.dragged = false
            this.quickPick = false
            this.quickPickHover = false
            this.dragStartX = event.clientX
            this.dragStartY = event.clientY
            const rect = this.root.getBoundingClientRect()
            this.dragOffsetX = event.clientX - rect.left
            this.dragOffsetY = event.clientY - rect.top
            try {
                this.primary.setPointerCapture(event.pointerId)
            } catch {
                /* ignore */
            }
            this.clearHoldTimer()
            this.holdTimer = setTimeout(() => {
                this.holdTimer = null
                if (this.dragPointerId == null || this.dragged) return
                this.beginQuickPick()
            }, HOLD_QUICK_PICK_MS)
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

        if (this.quickPick) {
            event.preventDefault()
            this.updateQuickPickHover(event.clientX, event.clientY)
            return
        }

        if (!this.dragged && dist > DRAG_THRESHOLD_PX) {
            this.clearHoldTimer()
            this.dragged = true
            this.close()
            this.root.classList.add("ml-mobile-fab--dragging")
        }
        if (!this.dragged) return
        event.preventDefault()
        this.setRootPosition(event.clientX - this.dragOffsetX, event.clientY - this.dragOffsetY)
    }

    private readonly onPointerEnd = (event: PointerEvent): void => {
        if (this.dragPointerId == null || event.pointerId !== this.dragPointerId) return
        const wasDragging = this.dragged
        const wasQuickPick = this.quickPick
        const hover = this.quickPickHover
        const quickAction = this.quickPickAction

        this.clearHoldTimer()
        this.endPointerSession()

        if (wasDragging) {
            event.preventDefault()
            event.stopPropagation()
            this.suppressClickUntilMs = Date.now() + 500
            this.persistPosition()
            this.layoutSatelliteArc()
            return
        }

        if (wasQuickPick) {
            event.preventDefault()
            event.stopPropagation()
            this.suppressClickUntilMs = Date.now() + 500
            this.endQuickPick(false)
            if (hover && quickAction) {
                this.handleAction(quickAction)
            }
        }
    }

    private beginQuickPick(): void {
        const last = this.lastActionId
        if (!last || !this.satellites.has(last)) {
            // No history yet — fall back to full fan.
            this.openMenu()
            this.suppressClickUntilMs = Date.now() + 500
            return
        }
        if (this.open) {
            this.open = false
            this.root.classList.remove("ml-mobile-fab--open")
            this.deps.onOpenChange?.(false)
        }
        this.layoutSatelliteArc()
        this.quickPick = true
        this.quickPickAction = last
        this.quickPickHover = false
        this.root.classList.add("ml-mobile-fab--quick")
        this.root.setAttribute("aria-expanded", "true")
        for (const [id, btn] of this.satellites) {
            const isTarget = id === last
            btn.classList.toggle("ml-mobile-fab__action--quick-target", isTarget)
            btn.classList.toggle("ml-mobile-fab__action--quick-hover", false)
        }
    }

    private updateQuickPickHover(clientX: number, clientY: number): void {
        if (!this.quickPick || !this.quickPickAction) return
        const btn = this.satellites.get(this.quickPickAction)
        if (!btn) return
        const rect = btn.getBoundingClientRect()
        // Slightly generous hit area for finger slide.
        const pad = 12
        const over =
            clientX >= rect.left - pad &&
            clientX <= rect.right + pad &&
            clientY >= rect.top - pad &&
            clientY <= rect.bottom + pad
        if (over !== this.quickPickHover) {
            this.quickPickHover = over
            btn.classList.toggle("ml-mobile-fab__action--quick-hover", over)
        }
    }

    private endQuickPick(_activate: boolean): void {
        if (!this.quickPick && !this.root.classList.contains("ml-mobile-fab--quick")) {
            this.quickPickAction = null
            this.quickPickHover = false
            return
        }
        this.quickPick = false
        this.quickPickHover = false
        this.quickPickAction = null
        this.root.classList.remove("ml-mobile-fab--quick")
        if (!this.open) {
            this.root.setAttribute("aria-expanded", "false")
        }
        for (const btn of this.satellites.values()) {
            btn.classList.remove("ml-mobile-fab__action--quick-target", "ml-mobile-fab__action--quick-hover")
        }
    }

    private showAllSatellites(): void {
        for (const btn of this.satellites.values()) {
            btn.classList.remove("ml-mobile-fab__action--quick-target", "ml-mobile-fab__action--quick-hover")
        }
        this.root.classList.remove("ml-mobile-fab--quick")
    }

    private clearHoldTimer(): void {
        if (this.holdTimer != null) {
            clearTimeout(this.holdTimer)
            this.holdTimer = null
        }
    }

    private endPointerSession(): void {
        this.dragPointerId = null
        this.root.classList.remove("ml-mobile-fab--dragging")
        document.removeEventListener("pointermove", this.onPointerMove)
        document.removeEventListener("pointerup", this.onPointerEnd)
        document.removeEventListener("pointercancel", this.onPointerEnd)
    }

    private rememberLastAction(id: MobileFabActionId): void {
        this.lastActionId = id
        try {
            localStorage.setItem(LAST_ACTION_KEY, id)
        } catch {
            /* ignore */
        }
    }

    private loadLastAction(): MobileFabActionId | null {
        try {
            const raw = localStorage.getItem(LAST_ACTION_KEY)
            if (raw && ACTION_IDS.has(raw as MobileFabActionId)) {
                return raw as MobileFabActionId
            }
        } catch {
            /* ignore */
        }
        return null
    }

    private setRootPosition(left: number, top: number): void {
        const size = this.root.offsetWidth || 48
        const { vw, vh } = viewportSize()
        const margin = 8
        const clampedLeft = Math.max(margin, Math.min(vw - size - margin, left))
        const clampedTop = Math.max(margin, Math.min(vh - size - margin, top))
        this.root.style.right = "auto"
        this.root.style.bottom = "auto"
        this.root.style.left = `${Math.round(clampedLeft)}px`
        this.root.style.top = `${Math.round(clampedTop)}px`
    }

    private clampToViewport(): void {
        if (!this.root.style.left && !this.root.style.top) return
        const rect = this.root.getBoundingClientRect()
        this.setRootPosition(rect.left, rect.top)
        this.persistPosition()
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
            if (typeof o.left === "number" && typeof o.top === "number") {
                this.setRootPosition(o.left, o.top)
            }
        } catch {
            /* ignore */
        }
    }

    private persistPosition(): void {
        if (!this.root.style.left || !this.root.style.top) return
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
