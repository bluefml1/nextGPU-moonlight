
export type TextEvent = CustomEvent<{ text: string }>

export type ScreenKeyboardOptions = {
    /** Called whenever the keyboard is shown or hidden (stream touch gestures may be stale). */
    onVisibilityChange?: (visible: boolean) => void
}

export class ScreenKeyboard {

    private eventTarget = new EventTarget()
    private root = document.createElement("div")
    private shell = document.createElement("div")
    private header = document.createElement("div")
    private capsIndicator = document.createElement("span")
    private rowHost = document.createElement("div")
    private capsLock = false
    private symbolMode = false
    private capsKey: HTMLButtonElement | null = null
    private modeKey: HTMLButtonElement | null = null
    private backspaceRepeatDelayTimer: ReturnType<typeof setTimeout> | null = null
    private backspaceRepeatInterval: ReturnType<typeof setInterval> | null = null
    private visible: boolean = false
    private dragPointerId: number | null = null
    private dragOffsetX = 0
    private dragOffsetY = 0
    private dragged = false
    private keyboardPos: { left: number; top: number } | null = null
    private readonly isTouchDevice: boolean
    private readonly minViewportMarginPx = 8
    private readonly onVisibilityChange?: (visible: boolean) => void
    private readonly onOutsidePointer = (e: PointerEvent) => {
        if (!this.visible) return
        if (this.shell.contains(e.target as Node)) return
        this.hide()
    }

    constructor(opts?: ScreenKeyboardOptions) {
        this.onVisibilityChange = opts?.onVisibilityChange
        this.isTouchDevice = ("maxTouchPoints" in navigator && navigator.maxTouchPoints > 0)
        this.root.classList.add("ml-screen-keyboard")
        this.shell.classList.add("ml-screen-keyboard-shell")
        this.root.appendChild(this.shell)

        this.header.classList.add("ml-screen-keyboard-header")
        const closeHeader = document.createElement("button")
        closeHeader.type = "button"
        closeHeader.classList.add("ml-screen-keyboard-close")
        closeHeader.setAttribute("aria-label", "Close keyboard")
        closeHeader.textContent = "×"
        closeHeader.addEventListener("pointerdown", (event) => event.stopPropagation())
        closeHeader.addEventListener("click", (event) => {
            event.preventDefault()
            this.hide()
        })
        this.header.style.cursor = "grab"
        this.header.style.touchAction = "none"
        this.capsIndicator.classList.add("ml-screen-keyboard-caps")
        this.header.appendChild(closeHeader)
        this.header.appendChild(this.capsIndicator)
        this.shell.appendChild(this.header)
        this.installDragHandlers()
        window.addEventListener("resize", () => {
            if (!this.visible) return
            if (this.isTouchDevice) {
                // Orientation/viewport changes on tablets can invalidate previous drag position.
                this.keyboardPos = null
            }
            this.applyKeyboardPosition()
        })

        window.addEventListener("blur", () => this.forceStopInteractions())
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                this.forceStopInteractions()
            }
        })

        this.rowHost.classList.add("ml-screen-keyboard-rows")
        this.shell.appendChild(this.rowHost)
        this.buildKeys()
        this.updateCapsUi()
    }

    getHiddenElement() {
        return this.root
    }

    show() {
        if (!this.root.parentElement && document.body) {
            document.body.appendChild(this.root)
        }
        if (this.rowHost.childElementCount === 0) {
            this.buildKeys()
        }
        this.visible = true
        this.root.style.display = "block"
        this.root.style.visibility = "visible"
        this.root.style.opacity = "1"
        this.root.style.pointerEvents = "auto"
        // Tablet/iPad reliability: always start from a guaranteed visible docked position.
        if (this.isTouchDevice) {
            this.keyboardPos = null
        }
        this.applyKeyboardPosition()
        document.addEventListener("pointerdown", this.onOutsidePointer, true)
        this.onVisibilityChange?.(true)
    }
    hide() {
        this.visible = false
        this.root.style.display = "none"
        this.stopBackspaceRepeat()
        this.symbolMode = false
        document.removeEventListener("pointerdown", this.onOutsidePointer, true)
        this.onVisibilityChange?.(false)
    }

    isVisible(): boolean {
        return this.visible
    }

    isActuallyVisible(): boolean {
        if (!this.root.isConnected) return false
        const style = window.getComputedStyle(this.root)
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
    }

    addKeyDownListener(listener: (event: KeyboardEvent) => void) {
        this.eventTarget.addEventListener("keydown", listener as any)
    }
    addKeyUpListener(listener: (event: KeyboardEvent) => void) {
        this.eventTarget.addEventListener("keyup", listener as any)
    }
    addTextListener(listener: (event: TextEvent) => void) {
        this.eventTarget.addEventListener("ml-text", listener as any)
    }

    removeTextListener(listener: (event: TextEvent) => void) {
        this.eventTarget.removeEventListener("ml-text", listener as any)
    }

    removeKeyDownListener(listener: (event: KeyboardEvent) => void) {
        this.eventTarget.removeEventListener("keydown", listener as any)
    }

    private emitText(text: string) {
        const customEvent: TextEvent = new CustomEvent("ml-text", { detail: { text } })
        this.eventTarget.dispatchEvent(customEvent)
    }

    private emitKeyTap(code: string, key?: string) {
        const down = new KeyboardEvent("keydown", { code, key: key ?? code })
        const up = new KeyboardEvent("keyup", { code, key: key ?? code })
        this.eventTarget.dispatchEvent(down)
        this.eventTarget.dispatchEvent(up)
    }

    private createRow(layoutClass: string): HTMLDivElement {
        const row = document.createElement("div")
        row.classList.add("ml-screen-keyboard-row", layoutClass)
        this.rowHost.appendChild(row)
        return row
    }

    private createKey(label: string, onPress: () => void, options?: {
        span?: number
        emphasized?: boolean
        small?: boolean
        action?: boolean
    }): HTMLButtonElement {
        const span = options?.span ?? 1
        const emphasized = options?.emphasized ?? false
        const small = options?.small ?? false
        const action = options?.action ?? false
        const key = document.createElement("button")
        key.type = "button"
        key.textContent = label
        key.classList.add("ml-screen-key")
        if (emphasized) key.classList.add("ml-screen-key--emphasized")
        if (small) key.classList.add("ml-screen-key--small")
        if (action) key.classList.add("ml-screen-key--action")
        key.style.gridColumn = `span ${span}`
        const setPressed = (pressed: boolean) => {
            if (pressed) {
                key.classList.add("is-pressed")
            } else {
                key.classList.remove("is-pressed")
            }
        }
        key.addEventListener("pointerdown", () => setPressed(true))
        key.addEventListener("pointerup", () => setPressed(false))
        key.addEventListener("pointercancel", () => setPressed(false))
        key.addEventListener("pointerleave", () => setPressed(false))
        key.addEventListener("click", (event) => {
            event.preventDefault()
            onPress()
        })
        return key
    }

    private createRepeatBackspaceKey(span = 1): HTMLButtonElement {
        const key = this.createKey("⌫", () => this.emitKeyTap("Backspace", "Backspace"), { span, emphasized: true, small: true, action: true })
        const tapBackspace = () => this.emitKeyTap("Backspace", "Backspace")
        key.addEventListener("pointerdown", (event) => {
            event.preventDefault()
            tapBackspace()
            this.stopBackspaceRepeat()
            this.backspaceRepeatDelayTimer = setTimeout(() => {
                this.backspaceRepeatInterval = setInterval(tapBackspace, 70)
            }, 320)
        })
        key.addEventListener("pointerup", () => this.stopBackspaceRepeat())
        key.addEventListener("pointercancel", () => this.stopBackspaceRepeat())
        key.addEventListener("pointerleave", () => this.stopBackspaceRepeat())
        return key
    }

    private stopBackspaceRepeat() {
        if (this.backspaceRepeatDelayTimer != null) {
            clearTimeout(this.backspaceRepeatDelayTimer)
            this.backspaceRepeatDelayTimer = null
        }
        if (this.backspaceRepeatInterval != null) {
            clearInterval(this.backspaceRepeatInterval)
            this.backspaceRepeatInterval = null
        }
    }

    private updateCapsUi() {
        this.capsIndicator.textContent = this.symbolMode ? "Symbols" : (this.capsLock ? "Caps Lock: ON" : "Caps Lock: Off")
        if (this.capsKey) {
            this.capsKey.classList.toggle("is-toggled", this.capsLock)
            this.capsKey.textContent = this.capsLock ? "Caps On" : "Caps"
        }
    }

    private buildKeys() {
        this.rowHost.innerHTML = ""
        const appendChars = (row: HTMLDivElement, chars: string, small = false) => {
            for (const c of chars) {
                row.appendChild(this.createKey(c, () => {
                    const out = this.capsLock ? c.toUpperCase() : c
                    this.emitText(out)
                }, { small, action: false }))
            }
        }

        if (!this.symbolMode) {
            const row1 = this.createRow("ml-screen-keyboard-row--ten")
            appendChars(row1, "qwertyuiop")

            const row2 = this.createRow("ml-screen-keyboard-row--nine")
            appendChars(row2, "asdfghjkl")

            const row3 = this.createRow("ml-screen-keyboard-row--ten")
            this.capsKey = this.createKey("Caps", () => {
                this.capsLock = !this.capsLock
                this.updateCapsUi()
            }, { span: 2, emphasized: true, action: true })
            row3.appendChild(this.capsKey)
            appendChars(row3, "zxcvbnm")
            row3.appendChild(this.createRepeatBackspaceKey(1))
        } else {
            const row1 = this.createRow("ml-screen-keyboard-row--ten")
            appendChars(row1, "1234567890")

            const row2 = this.createRow("ml-screen-keyboard-row--ten")
            appendChars(row2, "-/:;()$&@\"", true)

            const row3 = this.createRow("ml-screen-keyboard-row--symbol")
            appendChars(row3, ".,?!'#+=%*", true)
            row3.appendChild(this.createRepeatBackspaceKey(2))
            this.capsKey = null
        }

        const row4 = this.createRow("ml-screen-keyboard-row--bottom")
        this.modeKey = this.createKey(this.symbolMode ? "ABC" : "123", () => {
            this.symbolMode = !this.symbolMode
            this.buildKeys()
        }, { span: 2, emphasized: true, action: true })
        row4.appendChild(this.modeKey)
        row4.appendChild(this.createKey("Space", () => this.emitText(" "), { span: 4 }))
        row4.appendChild(this.createKey("Enter", () => this.emitKeyTap("Enter", "Enter"), { span: 2, emphasized: true, action: true }))
        row4.appendChild(this.createKey("Esc", () => this.emitKeyTap("Escape", "Escape"), { span: 2, emphasized: true, action: true }))
        this.updateCapsUi()
    }

    private installDragHandlers() {
        this.header.addEventListener("pointerdown", (event: PointerEvent) => {
            const rect = this.shell.getBoundingClientRect()
            this.dragPointerId = event.pointerId
            this.dragged = false
            this.dragOffsetX = event.clientX - rect.left
            this.dragOffsetY = event.clientY - rect.top
            try {
                this.header.setPointerCapture(event.pointerId)
            } catch {
                // iPad/tablet browsers can throw InvalidStateError intermittently.
            }
        })
        this.header.addEventListener("pointermove", (event: PointerEvent) => {
            if (this.dragPointerId == null || event.pointerId !== this.dragPointerId) return
            const [vw, vh] = this.getViewportSize()
            const w = this.shell.offsetWidth || 320
            const h = this.shell.offsetHeight || 220
            const left = Math.max(this.minViewportMarginPx, Math.min(vw - w - this.minViewportMarginPx, event.clientX - this.dragOffsetX))
            const top = Math.max(this.minViewportMarginPx, Math.min(vh - h - this.minViewportMarginPx, event.clientY - this.dragOffsetY))
            this.keyboardPos = { left, top }
            this.applyKeyboardPosition()
            this.dragged = true
        })
        const endDrag = (event: PointerEvent) => {
            if (this.dragPointerId == null || event.pointerId !== this.dragPointerId) return
            try {
                if (this.header.hasPointerCapture(event.pointerId)) this.header.releasePointerCapture(event.pointerId)
            } catch {
                // Ignore pointer capture state races on mobile browsers.
            }
            this.dragPointerId = null
            if (this.dragged) {
                event.preventDefault()
                event.stopPropagation()
            }
            this.dragged = false
            this.header.style.cursor = "grab"
        }
        this.header.addEventListener("pointerup", endDrag)
        this.header.addEventListener("pointercancel", endDrag)
    }

    private forceStopInteractions() {
        this.stopBackspaceRepeat()
        this.dragPointerId = null
    }

    private getViewportSize(): [number, number] {
        const viewport = window.visualViewport
        if (viewport) {
            return [Math.max(0, viewport.width), Math.max(0, viewport.height)]
        }
        return [
            Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
            Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
        ]
    }

    private applyKeyboardPosition() {
        if (!this.keyboardPos) {
            this.root.style.left = "0"
            this.root.style.right = "0"
            this.root.style.bottom = "0"
            this.root.style.top = "auto"
            this.root.style.width = "auto"
            return
        }
        const [vw, vh] = this.getViewportSize()
        const rootStyle = window.getComputedStyle(this.root)
        const paddingLeft = Number.parseFloat(rootStyle.paddingLeft) || 0
        const paddingRight = Number.parseFloat(rootStyle.paddingRight) || 0
        const shellWidth = this.shell.offsetWidth || 360
        const w = shellWidth + paddingLeft + paddingRight
        const h = this.shell.offsetHeight || 240
        const left = Math.max(this.minViewportMarginPx, Math.min(vw - w - this.minViewportMarginPx, this.keyboardPos.left))
        const top = Math.max(this.minViewportMarginPx, Math.min(vh - h - this.minViewportMarginPx, this.keyboardPos.top))
        this.keyboardPos = { left, top }
        this.root.style.left = `${Math.round(left)}px`
        this.root.style.top = `${Math.round(top)}px`
        this.root.style.right = "auto"
        this.root.style.bottom = "auto"
        this.root.style.width = `${Math.round(w)}px`
    }
}