
export type TextEvent = CustomEvent<{ text: string }>

export type KeyboardMode = "letters" | "numbers" | "fkeys"

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
    private modeIndicator = document.createElement("span")
    private modifierIndicator = document.createElement("span")
    private rowHost = document.createElement("div")
    private capsLock = false
    private mode: KeyboardMode = "letters"
    private capsKey: HTMLButtonElement | null = null
    private modeKey: HTMLButtonElement | null = null
    private modifierKeys: { ctrl: HTMLButtonElement | null; alt: HTMLButtonElement | null; shift: HTMLButtonElement | null; win: HTMLButtonElement | null } = {
        ctrl: null,
        alt: null,
        shift: null,
        win: null,
    }
    private activeModifiers: Set<string> = new Set()
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
    private modifierPicker: HTMLDivElement | null = null
    private currentPickerKey: string = ""
    private currentPickerCode: string = ""
    private activeModifierType: string = ""
    private popupContent: HTMLDivElement | null = null
    private popupTabContent: Record<string, HTMLElement | null> = {}
    private readonly onOutsidePointer = (e: PointerEvent) => {
        if (!this.visible) return
        if (this.shell.contains(e.target as Node)) return
        if (this.modifierPicker?.contains(e.target as Node)) return
        this.hide()
    }

    private readonly modifierCombos: Record<string, { key: string; code: string }[]> = {
        ctrl: [
            { key: "c", code: "KeyC" },
            { key: "v", code: "KeyV" },
            { key: "z", code: "KeyZ" },
            { key: "x", code: "KeyX" },
            { key: "s", code: "KeyS" },
            { key: "a", code: "KeyA" },
        ],
        alt: [
            { key: "Tab", code: "Tab" },
        ],
        shift: [],
        win: [
            { key: "D", code: "KeyD" },
            { key: "E", code: "KeyE" },
        ],
    }

    constructor(opts?: ScreenKeyboardOptions) {
        this.onVisibilityChange = opts?.onVisibilityChange
        this.isTouchDevice = ("maxTouchPoints" in navigator && navigator.maxTouchPoints > 0)
        this.root.classList.add("ml-screen-keyboard")
        this.shell.classList.add("ml-screen-keyboard-shell")
        this.root.appendChild(this.shell)

        this.header.classList.add("ml-screen-keyboard-header")

        const modeSwitcherContainer = document.createElement("div")
        modeSwitcherContainer.classList.add("ml-screen-keyboard-mode-switcher")
        ;["ABC", "123", "F-Keys"].forEach((label, index) => {
            const btn = document.createElement("button")
            btn.type = "button"
            btn.classList.add("ml-screen-keyboard-mode-btn")
            btn.textContent = label
            const modes: KeyboardMode[] = ["letters", "numbers", "fkeys"]
            btn.addEventListener("click", () => {
                this.mode = modes[index]
                this.buildKeys()
            })
            modeSwitcherContainer.appendChild(btn)
        })

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
        this.modeIndicator.classList.add("ml-screen-keyboard-mode")
        this.modifierIndicator.classList.add("ml-screen-keyboard-modifier")
        this.modifierIndicator.style.cursor = "pointer"
        this.modifierIndicator.title = "Tap to release modifiers"
        this.modifierIndicator.addEventListener("click", () => {
            this.clearActiveModifiers()
            this.buildKeys()
        })
        this.header.appendChild(modeSwitcherContainer)
        this.header.appendChild(closeHeader)
        this.header.appendChild(this.capsIndicator)
        this.header.appendChild(this.modeIndicator)
        this.header.appendChild(this.modifierIndicator)
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
        this.clearActiveModifiers()
        this.hideModifierPicker()
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

    private emitKeyDown(code: string, key?: string) {
        const down = new KeyboardEvent("keydown", { code, key: key ?? code })
        this.eventTarget.dispatchEvent(down)
    }

    private emitKeyUp(code: string, key?: string) {
        const up = new KeyboardEvent("keyup", { code, key: key ?? code })
        this.eventTarget.dispatchEvent(up)
    }

    private toggleModifier(modifier: string) {
        if (this.activeModifiers.has(modifier)) {
            this.activeModifiers.delete(modifier)
            this.emitModifierRelease(modifier)
        } else {
            this.activeModifiers.add(modifier)
            this.emitModifierPress(modifier)
        }
        this.updateModifierUi()
        if (this.mode !== "fkeys") {
            this.buildKeys()
        }
    }

    private emitModifierPress(modifier: string) {
        const codeMap: Record<string, string> = {
            ctrl: "ControlLeft",
            alt: "AltLeft",
            shift: "ShiftLeft",
            win: "MetaLeft",
        }
        this.emitKeyDown(codeMap[modifier], modifier)
    }

    private emitModifierRelease(modifier: string) {
        const codeMap: Record<string, string> = {
            ctrl: "ControlLeft",
            alt: "AltLeft",
            shift: "ShiftLeft",
            win: "MetaLeft",
        }
        this.emitKeyUp(codeMap[modifier], modifier)
    }

    private emitModifierCombo(modifier: string, combo: { key: string; code: string }) {
        this.emitModifierPress(modifier)
        this.emitKeyDown(combo.code, combo.key)
        this.emitKeyUp(combo.code, combo.key)
        this.emitModifierRelease(modifier)
    }

    private emitModifierKeyPress(key: string, code: string) {
        for (const modifier of this.activeModifiers) {
            this.emitModifierPress(modifier)
        }
        this.emitKeyDown(code, key)
        this.emitKeyUp(code, key)
        for (const modifier of this.activeModifiers) {
            this.emitModifierRelease(modifier)
        }
    }

    private clearActiveModifiers() {
        for (const modifier of this.activeModifiers) {
            this.emitModifierRelease(modifier)
        }
        this.activeModifiers.clear()
        this.updateModifierUi()
    }

    private updateModifierUi() {
        const activeList = Array.from(this.activeModifiers).map(m => m.toUpperCase())
        if (activeList.length > 0) {
            this.modifierIndicator.textContent = `[${activeList.join("+")}]`
            this.modifierIndicator.classList.add("is-active")
        } else {
            this.modifierIndicator.textContent = ""
            this.modifierIndicator.classList.remove("is-active")
        }
        if (this.modifierKeys.ctrl) {
            this.modifierKeys.ctrl.classList.toggle("is-toggled", this.activeModifiers.has("ctrl"))
        }
        if (this.modifierKeys.alt) {
            this.modifierKeys.alt.classList.toggle("is-toggled", this.activeModifiers.has("alt"))
        }
        if (this.modifierKeys.shift) {
            this.modifierKeys.shift.classList.toggle("is-toggled", this.activeModifiers.has("shift"))
        }
        if (this.modifierKeys.win) {
            this.modifierKeys.win.classList.toggle("is-toggled", this.activeModifiers.has("win"))
        }
    }

    private updateModeButtonUi() {
        const buttons = this.header.querySelectorAll(".ml-screen-keyboard-mode-btn")
        const modes: KeyboardMode[] = ["letters", "numbers", "fkeys"]
        buttons.forEach((btn, index) => {
            btn.classList.toggle("is-active", modes[index] === this.mode)
        })
    }

    private getModeLabel(): string {
        switch (this.mode) {
            case "letters": return "ABC"
            case "numbers": return "123"
            case "fkeys": return "F-Keys"
        }
    }

    private cycleMode() {
        switch (this.mode) {
            case "letters": this.mode = "numbers"; break
            case "numbers": this.mode = "fkeys"; break
            case "fkeys": this.mode = "letters"; break
        }
        this.buildKeys()
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
        this.capsIndicator.textContent = this.capsLock ? "Caps: ON" : "Caps: Off"
        this.modeIndicator.textContent = `[${this.getModeLabel()}]`
        if (this.capsKey) {
            this.capsKey.classList.toggle("is-toggled", this.capsLock)
            this.capsKey.textContent = this.capsLock ? "Caps On" : "Caps"
        }
        this.updateModeButtonUi()
        // Update ABC popup if open
        if (this.popupTabContent && this.popupTabContent["ABC"]) {
            this.popupTabContent["ABC"] = this.buildPopupAbcContent()
            if (this.popupContent?.querySelector(".ml-popup-keyboard")) {
                this.showPopupTab("ABC")
            }
        }
    }

    private buildKeys() {
        this.rowHost.innerHTML = ""
        const appendChars = (row: HTMLDivElement, chars: string, small = false) => {
            for (const c of chars) {
                row.appendChild(this.createKey(c, () => {
                    const out = this.capsLock ? c.toUpperCase() : c
                    if (this.activeModifiers.size > 0) {
                        this.emitModifierKeyPress(out, out.toUpperCase())
                    } else {
                        this.emitText(out)
                    }
                }, { small, action: false }))
            }
        }

        if (this.mode === "fkeys") {
            this.buildFkeysPanel()
            this.appendBottomRow()
            return
        }

        if (this.mode === "letters") {
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

        this.appendBottomRow()
    }

    private appendBottomRow() {
        const row4 = this.createRow("ml-screen-keyboard-row--bottom")
        row4.appendChild(this.createKey("Space", () => this.emitText(" "), { span: 6 }))
        row4.appendChild(this.createKey("Enter", () => this.emitKeyTap("Enter", "Enter"), { span: 2, emphasized: true, action: true }))
        row4.appendChild(this.createKey("Esc", () => this.emitKeyTap("Escape", "Escape"), { span: 2, emphasized: true, action: true }))
        this.updateCapsUi()
    }

    private buildFkeysPanel() {
        const row1 = this.createRow("ml-screen-keyboard-row--fkeys")
        row1.appendChild(this.createKey("Esc", () => this.emitKeyTap("Escape", "Escape"), { span: 2, emphasized: true, action: true }))
        ;["F1", "F2", "F3", "F4", "F5", "F6"].forEach(f => {
            row1.appendChild(this.createKey(f, () => this.emitKeyTap(f, f), { small: true, action: true }))
        })

        const row2 = this.createRow("ml-screen-keyboard-row--fkeys")
        ;["F7", "F8", "F9", "F10", "F11", "F12"].forEach(f => {
            row2.appendChild(this.createKey(f, () => this.emitKeyTap(f, f), { small: true, action: true }))
        })

        const row3 = this.createRow("ml-screen-keyboard-row--modifiers")
        this.modifierKeys.ctrl = this.createKey("Ctrl", () => {
            if (this.modifierKeys.ctrl) this.showModifierPickerPopup(this.modifierKeys.ctrl, "ctrl")
        }, { span: 2, emphasized: true, action: true })
        this.modifierKeys.alt = this.createKey("Alt", () => {
            if (this.modifierKeys.alt) this.showModifierPickerPopup(this.modifierKeys.alt, "alt")
        }, { span: 2, emphasized: true, action: true })
        this.modifierKeys.shift = this.createKey("Shift", () => {
            if (this.modifierKeys.shift) this.showModifierPickerPopup(this.modifierKeys.shift, "shift")
        }, { span: 2, emphasized: true, action: true })
        this.modifierKeys.win = this.createKey("Win", () => {
            if (this.modifierKeys.win) this.showModifierPickerPopup(this.modifierKeys.win, "win")
        }, { span: 2, emphasized: true, action: true })
        row3.appendChild(this.modifierKeys.ctrl)
        row3.appendChild(this.modifierKeys.alt)
        row3.appendChild(this.modifierKeys.shift)
        row3.appendChild(this.modifierKeys.win)

        const row4 = this.createRow("ml-screen-keyboard-row--nav")
        ;["Home", "End", "PgUp", "PgDn", "Ins", "Del"].forEach(k => {
            row4.appendChild(this.createKey(k, () => this.emitKeyTap(k, k), { small: true, action: true }))
        })

        this.updateModifierUi()
    }

    private installDragHandlers() {
        this.header.addEventListener("pointerdown", (event: PointerEvent) => {
            // Don't drag if clicking on the modifier indicator (it's tappable)
            if (event.target === this.modifierIndicator) {
                return
            }
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

    private showModifierPickerPopup(anchorEl: HTMLElement, modifierType: string) {
        this.hideModifierPicker()
        this.activeModifierType = modifierType

        this.modifierPicker = document.createElement("div")
        this.modifierPicker.classList.add("ml-modifier-popup")

        // Header with modifier label and tabs
        const header = document.createElement("div")
        header.classList.add("ml-modifier-popup-header")

        const label = document.createElement("span")
        label.classList.add("ml-modifier-popup-label")
        label.textContent = modifierType.toUpperCase()
        header.appendChild(label)

        const tabs = document.createElement("div")
        tabs.classList.add("ml-modifier-popup-tabs")
        const tabNames = ["123", "ABC", "F1-F12"]
        for (const tab of tabNames) {
            const tabBtn = document.createElement("button")
            tabBtn.type = "button"
            tabBtn.classList.add("ml-modifier-popup-tab")
            if (tab === "123") tabBtn.classList.add("is-active")
            tabBtn.textContent = tab
            tabBtn.addEventListener("click", () => {
                header.querySelectorAll(".ml-modifier-popup-tab").forEach(t => t.classList.remove("is-active"))
                tabBtn.classList.add("is-active")
                this.showPopupTab(tab)
            })
            tabs.appendChild(tabBtn)
        }
        header.appendChild(tabs)

        const closeBtn = document.createElement("button")
        closeBtn.type = "button"
        closeBtn.classList.add("ml-modifier-popup-close")
        closeBtn.textContent = "×"
        closeBtn.title = "Close"
        closeBtn.addEventListener("click", () => this.hideModifierPicker())
        header.appendChild(closeBtn)
        this.modifierPicker.appendChild(header)

        // Keyboard content container
        this.popupContent = document.createElement("div")
        this.popupContent.classList.add("ml-modifier-popup-content")
        this.modifierPicker.appendChild(this.popupContent)

        // Build content for each tab
        this.popupTabContent = {
            "123": this.buildPopup123Content(),
            "ABC": this.buildPopupAbcContent(),
            "F1-F12": this.buildPopupFkeysContent(),
        }
        this.showPopupTab("123")

        document.body.appendChild(this.modifierPicker)

        // Position near the anchor element
        const rect = anchorEl.getBoundingClientRect()
        const pickerWidth = this.modifierPicker.offsetWidth || 320
        const pickerHeight = this.modifierPicker.offsetHeight || 200

        let left = rect.left
        let top = rect.top - pickerHeight - 8

        // Keep within viewport
        if (left + pickerWidth > window.innerWidth) {
            left = window.innerWidth - pickerWidth - 8
        }
        if (top < 0) {
            top = rect.bottom + 8
        }

        this.modifierPicker.style.left = `${left}px`
        this.modifierPicker.style.top = `${top}px`
    }

    private showPopupTab(tabName: string) {
        if (!this.popupContent || !this.popupTabContent) return
        this.popupContent.innerHTML = ""
        const content = this.popupTabContent[tabName]
        if (content) {
            this.popupContent.appendChild(content)
        }
    }

    private buildPopup123Content(): HTMLElement {
        const container = document.createElement("div")
        container.classList.add("ml-popup-keyboard")

        const row1 = document.createElement("div")
        row1.classList.add("ml-popup-row")
        for (const c of "1234567890") {
            row1.appendChild(this.createPopupKey(c, c))
        }

        const row2 = document.createElement("div")
        row2.classList.add("ml-popup-row")
        for (const c of "-/:;()$&@\"") {
            row2.appendChild(this.createPopupKey(c, c, true))
        }

        const row3 = document.createElement("div")
        row3.classList.add("ml-popup-row")
        for (const c of ".,?!'#+=%*") {
            row3.appendChild(this.createPopupKey(c, c, true))
        }

        container.appendChild(row1)
        container.appendChild(row2)
        container.appendChild(row3)
        return container
    }

    private buildPopupAbcContent(): HTMLElement {
        const container = document.createElement("div")
        container.classList.add("ml-popup-keyboard")

        const row1 = document.createElement("div")
        row1.classList.add("ml-popup-row")
        for (const c of "QWERTYUIOP") {
            const display = this.capsLock ? c : c.toLowerCase()
            const code = c.toLowerCase()
            row1.appendChild(this.createPopupKey(display, code))
        }

        const row2 = document.createElement("div")
        row2.classList.add("ml-popup-row")
        for (const c of "ASDFGHJKL") {
            const display = this.capsLock ? c : c.toLowerCase()
            const code = c.toLowerCase()
            row2.appendChild(this.createPopupKey(display, code))
        }

        const row3 = document.createElement("div")
        row3.classList.add("ml-popup-row")
        for (const c of "ZXCVBNM") {
            const display = this.capsLock ? c : c.toLowerCase()
            const code = c.toLowerCase()
            row3.appendChild(this.createPopupKey(display, code))
        }

        container.appendChild(row1)
        container.appendChild(row2)
        container.appendChild(row3)
        return container
    }

    private buildPopupFkeysContent(): HTMLElement {
        const container = document.createElement("div")
        container.classList.add("ml-popup-keyboard")

        const row1 = document.createElement("div")
        row1.classList.add("ml-popup-row")
        for (const f of ["F1", "F2", "F3", "F4", "F5", "F6"]) {
            row1.appendChild(this.createPopupKey(f, f, false, true))
        }

        const row2 = document.createElement("div")
        row2.classList.add("ml-popup-row")
        for (const f of ["F7", "F8", "F9", "F10", "F11", "F12"]) {
            row2.appendChild(this.createPopupKey(f, f, false, true))
        }

        container.appendChild(row1)
        container.appendChild(row2)
        return container
    }

    private createPopupKey(label: string, code: string, small = false, action = false): HTMLElement {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.classList.add("ml-popup-key")
        if (small) btn.classList.add("ml-popup-key--small")
        if (action) btn.classList.add("ml-popup-key--action")
        btn.textContent = label
        btn.addEventListener("click", (e) => {
            e.stopPropagation()
            this.emitModifierCombo(this.activeModifierType, { key: code, code })
            this.hideModifierPicker()
        })
        return btn
    }

    private readonly closePickerOutside = (e: MouseEvent) => {
        if (this.modifierPicker && !this.modifierPicker.contains(e.target as Node)) {
            this.hideModifierPicker()
        }
    }

    private hideModifierPicker() {
        if (this.modifierPicker) {
            this.modifierPicker.remove()
            this.modifierPicker = null
        }
        document.removeEventListener("click", this.closePickerOutside)
    }

    private emitWithModifiers(modifiers: string[], key: string, code: string) {
        for (const mod of modifiers) {
            this.emitModifierPress(mod)
        }
        this.emitKeyDown(code, key)
        this.emitKeyUp(code, key)
        for (const mod of modifiers) {
            this.emitModifierRelease(mod)
        }
    }
}