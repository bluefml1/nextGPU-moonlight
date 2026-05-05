
export type TextEvent = CustomEvent<{ text: string }>

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

    constructor() {
        this.root.style.cssText =
            "position:fixed;left:0;right:0;bottom:0;z-index:100006;display:none;" +
            "padding:8px 10px calc(env(safe-area-inset-bottom,0px) + 10px);" +
            "background:linear-gradient(180deg,color-mix(in srgb, var(--bg-1, #001a2e) 72%, black),color-mix(in srgb, var(--bg-2, #000d18) 88%, black));" +
            "backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);" +
            "box-shadow:0 -10px 34px rgba(0,0,0,.55), 0 0 14px rgba(0,212,255,.08)"

        this.shell.style.cssText =
            "max-width:760px;margin:0 auto;background:color-mix(in srgb, var(--bg-2, #000d18) 78%, rgba(0,0,0,.62));" +
            "border:1px solid color-mix(in srgb, var(--accent-cyan-2, #00d4ff) 40%, rgba(255,255,255,.18));" +
            "border-radius:16px;padding:8px;box-sizing:border-box;" +
            "max-height:min(42vh,320px);overflow:auto"
        this.root.appendChild(this.shell)

        this.header.style.cssText =
            "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"
        const title = document.createElement("span")
        title.textContent = "Keyboard"
        title.style.cssText = "font:600 12px system-ui,sans-serif;letter-spacing:.02em;color:color-mix(in srgb, var(--accent-cyan-2, #00d4ff) 72%, #ffffff)"
        this.header.style.cursor = "grab"
        this.header.style.touchAction = "none"
        this.capsIndicator.style.cssText = "font:600 12px system-ui,sans-serif;color:var(--text-2, #ffffff)"
        this.header.appendChild(title)
        this.header.appendChild(this.capsIndicator)
        this.shell.appendChild(this.header)
        this.installDragHandlers()

        this.rowHost.style.cssText = "display:flex;flex-direction:column;gap:clamp(4px,1.2vw,8px)"
        this.shell.appendChild(this.rowHost)
        this.buildKeys()
        this.updateCapsUi()
    }

    getHiddenElement() {
        return this.root
    }

    show() {
        this.visible = true
        this.root.style.display = "block"
        this.applyKeyboardPosition()
    }
    hide() {
        this.visible = false
        this.root.style.display = "none"
        this.stopBackspaceRepeat()
        this.symbolMode = false
    }

    isVisible(): boolean {
        return this.visible
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

    private createRow(): HTMLDivElement {
        const row = document.createElement("div")
        row.style.cssText = "display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:clamp(4px,1.2vw,8px);align-items:stretch"
        this.rowHost.appendChild(row)
        return row
    }

    private createKey(label: string, onPress: () => void, options?: { flex?: number; emphasized?: boolean; small?: boolean }): HTMLButtonElement {
        const flex = options?.flex ?? 1
        const emphasized = options?.emphasized ?? false
        const small = options?.small ?? false
        const singleCharKey = label.length === 1 && flex === 1
        const key = document.createElement("button")
        key.type = "button"
        key.textContent = label
        key.style.gridColumn = `span ${flex}`
        key.style.cssText =
            `grid-column:span ${flex};height:${singleCharKey ? "clamp(34px,8.2vw,42px)" : (small ? "clamp(34px,8.2vw,40px)" : "clamp(36px,8.8vw,44px)")};` +
            `min-width:0;border-radius:clamp(8px,2.2vw,10px);` +
            `border:1px solid ${emphasized ? "color-mix(in srgb, var(--accent-cyan-2, #00d4ff) 52%, rgba(255,255,255,.20))" : "rgba(255,255,255,.12)"};` +
            `background:${emphasized ? "color-mix(in srgb, var(--accent-cyan-2, #00d4ff) 16%, var(--bg-2, #000d18))" : "color-mix(in srgb, var(--bg-2, #000d18) 74%, rgba(255,255,255,.05))"};` +
            `color:var(--text-2, #ffffff);` +
            `font:600 ${small ? "clamp(11px,3vw,13px)" : "clamp(12px,3.4vw,15px)"} system-ui,sans-serif;` +
            "padding:0 clamp(4px,1.4vw,10px);line-height:1;white-space:nowrap;" +
            "display:flex;align-items:center;justify-content:center;text-align:center;" +
            "overflow:hidden;text-overflow:clip;touch-action:manipulation;" +
            "box-shadow:inset 0 -1px 0 rgba(0,0,0,.32), 0 0 8px rgba(0,212,255,.05)"
        if (singleCharKey) {
            key.style.aspectRatio = "1 / 1"
        }
        key.addEventListener("click", (event) => {
            event.preventDefault()
            onPress()
        })
        return key
    }

    private createRepeatBackspaceKey(): HTMLButtonElement {
        const key = this.createKey("Bksp", () => this.emitKeyTap("Backspace", "Backspace"), { flex: 2, emphasized: true, small: true })
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
            this.capsKey.style.background = this.capsLock
                ? "color-mix(in srgb, var(--accent-cyan-light, #00ffff) 16%, var(--bg-2, #000d18))"
                : "color-mix(in srgb, var(--accent-cyan-2, #00d4ff) 14%, var(--bg-2, #000d18))"
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
                }, { small }))
            }
        }

        if (!this.symbolMode) {
            const row1 = this.createRow()
            appendChars(row1, "qwertyuiop")

            const row2 = this.createRow()
            appendChars(row2, "asdfghjkl")

            const row3 = this.createRow()
            this.capsKey = this.createKey("Caps", () => {
                this.capsLock = !this.capsLock
                this.updateCapsUi()
            }, { flex: 2, emphasized: true })
            row3.appendChild(this.capsKey)
            appendChars(row3, "zxcvbnm")
            row3.appendChild(this.createRepeatBackspaceKey())
        } else {
            const row1 = this.createRow()
            appendChars(row1, "1234567890")

            const row2 = this.createRow()
            appendChars(row2, "-/:;()$&@\"", true)

            const row3 = this.createRow()
            appendChars(row3, ".,?!'#+=%*", true)
            row3.appendChild(this.createRepeatBackspaceKey())
            this.capsKey = null
        }

        const row4 = this.createRow()
        this.modeKey = this.createKey(this.symbolMode ? "ABC" : "123", () => {
            this.symbolMode = !this.symbolMode
            this.buildKeys()
        }, { flex: 2, emphasized: true })
        row4.appendChild(this.modeKey)
        row4.appendChild(this.createKey("Space", () => this.emitText(" "), { flex: 4 }))
        row4.appendChild(this.createKey("Enter", () => this.emitKeyTap("Enter", "Enter"), { flex: 2, emphasized: true }))
        row4.appendChild(this.createKey("Close", () => this.hide(), { flex: 2, emphasized: true }))
        this.updateCapsUi()
    }

    private installDragHandlers() {
        this.header.addEventListener("pointerdown", (event: PointerEvent) => {
            const rect = this.shell.getBoundingClientRect()
            this.dragPointerId = event.pointerId
            this.dragged = false
            this.dragOffsetX = event.clientX - rect.left
            this.dragOffsetY = event.clientY - rect.top
            this.header.setPointerCapture(event.pointerId)
        })
        this.header.addEventListener("pointermove", (event: PointerEvent) => {
            if (this.dragPointerId == null || event.pointerId !== this.dragPointerId) return
            const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
            const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
            const w = this.shell.offsetWidth || 320
            const h = this.shell.offsetHeight || 220
            const left = Math.max(8, Math.min(vw - w - 8, event.clientX - this.dragOffsetX))
            const top = Math.max(8, Math.min(vh - h - 8, event.clientY - this.dragOffsetY))
            this.keyboardPos = { left, top }
            this.applyKeyboardPosition()
            this.dragged = true
        })
        const endDrag = (event: PointerEvent) => {
            if (this.dragPointerId == null || event.pointerId !== this.dragPointerId) return
            if (this.header.hasPointerCapture(event.pointerId)) this.header.releasePointerCapture(event.pointerId)
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

    private applyKeyboardPosition() {
        if (!this.keyboardPos) {
            this.root.style.left = "0"
            this.root.style.right = "0"
            this.root.style.bottom = "0"
            this.root.style.top = "auto"
            this.root.style.width = "auto"
            return
        }
        this.root.style.left = `${Math.round(this.keyboardPos.left)}px`
        this.root.style.top = `${Math.round(this.keyboardPos.top)}px`
        this.root.style.right = "auto"
        this.root.style.bottom = "auto"
        this.root.style.width = `${Math.round(this.shell.offsetWidth || 360)}px`
    }
}