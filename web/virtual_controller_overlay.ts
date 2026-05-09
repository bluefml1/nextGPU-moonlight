import { StreamControllerButton, StreamKeys } from "./api_bindings.js"
import { emptyGamepadState, GamepadState } from "./stream/gamepad.js"
import { convertToKey } from "./stream/keyboard.js"
import type { StreamInput } from "./stream/input.js"
import { ScreenKeyboard, TextEvent } from "./screen_keyboard.js"

const STORAGE_KEY = "ml.virtualController.layout.v1"
const DRAG_THRESHOLD_PX = 6
const LISTEN_CANCEL_KEYS = new Set(["Escape"])
const STICK_KEY_DEADZONE = 0.2
/** Reliable pressed styling on touch (not only :hover / :active). */
const FACE_PRESSED_CLASS = "ml-virtual-controller-face--pressed"

export type VirtualControlRole =
    | "cross"
    | "circle"
    | "triangle"
    | "square"
    | "dpad-up"
    | "dpad-down"
    | "dpad-left"
    | "dpad-right"
    | "l1"
    | "r1"
    | "l2"
    | "r2"
    | "stickL"
    | "stickR"
    /** WASD-style stick: sends keyboard keys via dominant direction */
    | "stickWasd"
    | "custom"

export interface VirtualControlRect {
    x: number
    y: number
    w: number
    h: number
}

export interface VirtualStickKeys {
    up: number
    down: number
    left: number
    right: number
}

export interface VirtualControlDef {
    id: string
    role: VirtualControlRole
    rect: VirtualControlRect
    enabled: boolean
    keyboardKey?: number | null
    /** Default gamepad flag for custom / fallback */
    gamepadFlag?: number
    /** Key bindings for {@link VirtualControlRole} `stickWasd` */
    stickKeys?: VirtualStickKeys
}

export interface VirtualLayoutFile {
    version: 1 | 2
    controls: VirtualControlDef[]
}

export type VirtualControllerDeps = {
    getStreamInput: () => StreamInput | null
    getScreenKeyboard: () => ScreenKeyboard
}

type StickDragRole = "stickL" | "stickR" | "stickWasd"

type KeyListenCtx =
    | { kind: "digital", controlId: string }
    | { kind: "stickDir", controlId: string, dir: keyof VirtualStickKeys }

function defaultStickKeys(): VirtualStickKeys {
    return {
        up: StreamKeys.VK_KEY_W,
        left: StreamKeys.VK_KEY_A,
        down: StreamKeys.VK_KEY_S,
        right: StreamKeys.VK_KEY_D,
    }
}

function roleToGamepadFlag(role: VirtualControlRole): number {
    switch (role) {
        case "cross":
            return StreamControllerButton.BUTTON_B
        case "circle":
            return StreamControllerButton.BUTTON_A
        case "triangle":
            return StreamControllerButton.BUTTON_Y
        case "square":
            return StreamControllerButton.BUTTON_X
        case "dpad-up":
            return StreamControllerButton.BUTTON_UP
        case "dpad-down":
            return StreamControllerButton.BUTTON_DOWN
        case "dpad-left":
            return StreamControllerButton.BUTTON_LEFT
        case "dpad-right":
            return StreamControllerButton.BUTTON_RIGHT
        case "l1":
            return StreamControllerButton.BUTTON_LB
        case "r1":
            return StreamControllerButton.BUTTON_RB
        case "l2":
        case "r2":
        case "stickL":
        case "stickR":
        case "stickWasd":
        case "custom":
            return 0
        default: {
            const _x: never = role
            return _x
        }
    }
}

function roleLabel(role: VirtualControlRole): string {
    switch (role) {
        case "cross":
            return "✕"
        case "circle":
            return "○"
        case "triangle":
            return "△"
        case "square":
            return "□"
        case "dpad-up":
            return "↑"
        case "dpad-down":
            return "↓"
        case "dpad-left":
            return "←"
        case "dpad-right":
            return "→"
        case "l1":
            return "L1"
        case "r1":
            return "R1"
        case "l2":
            return "L2"
        case "r2":
            return "R2"
        case "stickL":
            return "L"
        case "stickR":
            return "R"
        case "stickWasd":
            return "◎"
        case "custom":
            return "+"
        default: {
            const _x: never = role
            return _x
        }
    }
}

function defaultLayout(): VirtualLayoutFile {
    return {
        version: 2,
        controls: [
            { id: "l1", role: "l1", rect: { x: 0.08, y: 0.06, w: 0.12, h: 0.06 }, enabled: true },
            { id: "l2", role: "l2", rect: { x: 0.08, y: 0.14, w: 0.12, h: 0.08 }, enabled: true },
            { id: "r1", role: "r1", rect: { x: 0.8, y: 0.06, w: 0.12, h: 0.06 }, enabled: true },
            { id: "r2", role: "r2", rect: { x: 0.8, y: 0.14, w: 0.12, h: 0.08 }, enabled: true },
            { id: "dpad-u", role: "dpad-up", rect: { x: 0.1, y: 0.32, w: 0.08, h: 0.08 }, enabled: true },
            { id: "dpad-d", role: "dpad-down", rect: { x: 0.1, y: 0.48, w: 0.08, h: 0.08 }, enabled: true },
            { id: "dpad-l", role: "dpad-left", rect: { x: 0.02, y: 0.4, w: 0.08, h: 0.08 }, enabled: true },
            { id: "dpad-r", role: "dpad-right", rect: { x: 0.18, y: 0.4, w: 0.08, h: 0.08 }, enabled: true },
            { id: "sq", role: "square", rect: { x: 0.72, y: 0.34, w: 0.09, h: 0.09 }, enabled: true },
            { id: "tr", role: "triangle", rect: { x: 0.81, y: 0.26, w: 0.09, h: 0.09 }, enabled: true },
            { id: "cr", role: "circle", rect: { x: 0.9, y: 0.34, w: 0.09, h: 0.09 }, enabled: true },
            { id: "cx", role: "cross", rect: { x: 0.81, y: 0.42, w: 0.09, h: 0.09 }, enabled: true },
            { id: "sl", role: "stickL", rect: { x: 0.22, y: 0.62, w: 0.18, h: 0.2 }, enabled: true },
            { id: "sr", role: "stickR", rect: { x: 0.6, y: 0.62, w: 0.18, h: 0.2 }, enabled: true },
        ],
    }
}

const KNOWN_ROLES = new Set<VirtualControlRole>([
    "cross",
    "circle",
    "triangle",
    "square",
    "dpad-up",
    "dpad-down",
    "dpad-left",
    "dpad-right",
    "l1",
    "r1",
    "l2",
    "r2",
    "stickL",
    "stickR",
    "stickWasd",
    "custom",
])

function migrateLayout(raw: unknown): VirtualLayoutFile {
    const o = raw as Partial<VirtualLayoutFile>
    if (!o || (o.version !== 1 && o.version !== 2) || !Array.isArray(o.controls)) {
        return defaultLayout()
    }
    const controls: VirtualControlDef[] = []
    for (const c of o.controls as VirtualControlDef[]) {
        if (!c?.id || !c.role || !c.rect || !KNOWN_ROLES.has(c.role)) continue
        const next: VirtualControlDef = {
            id: c.id,
            role: c.role,
            rect: { ...c.rect },
            enabled: c.enabled !== false,
            keyboardKey: c.keyboardKey,
            gamepadFlag: c.gamepadFlag,
        }
        if (c.role === "stickWasd") {
            next.stickKeys = c.stickKeys ?? defaultStickKeys()
        }
        controls.push(next)
    }
    if (controls.length === 0) return defaultLayout()
    return { version: 2, controls }
}

function loadLayout(): VirtualLayoutFile {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return defaultLayout()
        return migrateLayout(JSON.parse(raw))
    } catch {
        return defaultLayout()
    }
}

function saveLayout(layout: VirtualLayoutFile): void {
    const toSave: VirtualLayoutFile = { version: 2, controls: layout.controls }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
}

function charToStreamKey(ch: string): number | null {
    if (!ch || ch.length !== 1) return null
    if (ch === " ") return StreamKeys.VK_SPACE
    const u = ch.toUpperCase()
    if (u >= "A" && u <= "Z") {
        return StreamKeys.VK_KEY_A + (u.charCodeAt(0) - "A".charCodeAt(0))
    }
    if (ch >= "0" && ch <= "9") {
        return StreamKeys.VK_KEY_0 + (ch.charCodeAt(0) - "0".charCodeAt(0))
    }
    const map: Record<string, number> = {
        ".": StreamKeys.VK_OEM_PERIOD,
        ",": StreamKeys.VK_OEM_COMMA,
        "/": StreamKeys.VK_OEM_2,
        ";": StreamKeys.VK_OEM_1,
        "'": StreamKeys.VK_OEM_7,
        "[": StreamKeys.VK_OEM_4,
        "]": StreamKeys.VK_OEM_6,
        "\\": StreamKeys.VK_OEM_5,
        "`": StreamKeys.VK_OEM_3,
        "-": StreamKeys.VK_OEM_MINUS,
        "=": StreamKeys.VK_OEM_PLUS,
    }
    return map[ch] ?? null
}

function streamKeyDisplayName(vk: number): string {
    for (const keyName of Object.keys(StreamKeys) as Array<keyof typeof StreamKeys>) {
        if (StreamKeys[keyName] === vk) {
            return keyName.replace(/^VK_/, "")
        }
    }
    return String(vk)
}

/** Short caption for on-control labels (e.g. `g`, `Space`, `↑`). */
function formatKeyCaption(vk: number): string {
    if (vk >= StreamKeys.VK_KEY_A && vk <= StreamKeys.VK_KEY_Z) {
        return String.fromCharCode(vk).toLowerCase()
    }
    if (vk >= StreamKeys.VK_KEY_0 && vk <= StreamKeys.VK_KEY_9) {
        return String.fromCharCode(vk)
    }
    if (vk >= StreamKeys.VK_NUMPAD0 && vk <= StreamKeys.VK_NUMPAD9) {
        return `Num${vk - StreamKeys.VK_NUMPAD0}`
    }
    const named: Array<[number, string]> = [
        [StreamKeys.VK_SPACE, "Space"],
        [StreamKeys.VK_RETURN, "Enter"],
        [StreamKeys.VK_TAB, "Tab"],
        [StreamKeys.VK_BACK, "Bksp"],
        [StreamKeys.VK_ESCAPE, "Esc"],
        [StreamKeys.VK_SHIFT, "Shift"],
        [StreamKeys.VK_CONTROL, "Ctrl"],
        [StreamKeys.VK_MENU, "Alt"],
        [StreamKeys.VK_LEFT, "←"],
        [StreamKeys.VK_UP, "↑"],
        [StreamKeys.VK_RIGHT, "→"],
        [StreamKeys.VK_DOWN, "↓"],
        [StreamKeys.VK_INSERT, "Ins"],
        [StreamKeys.VK_DELETE, "Del"],
        [StreamKeys.VK_HOME, "Home"],
        [StreamKeys.VK_END, "End"],
        [StreamKeys.VK_PRIOR, "PgUp"],
        [StreamKeys.VK_NEXT, "PgDn"],
    ]
    for (const [code, label] of named) {
        if (vk === code) return label
    }
    if (vk >= StreamKeys.VK_F1 && vk <= StreamKeys.VK_F24) {
        return `F${vk - StreamKeys.VK_F1 + 1}`
    }
    const short = streamKeyDisplayName(vk)
    return short.length > 8 ? short.slice(0, 7) + "…" : short
}

function digitalFaceLabel(def: VirtualControlDef): string {
    const hasKey = def.keyboardKey != null && def.keyboardKey !== undefined
    if (hasKey) {
        return formatKeyCaption(def.keyboardKey!)
    }
    return roleLabel(def.role)
}

function stickDirFromVector(mx: number, my: number, deadzone: number): keyof VirtualStickKeys | null {
    if (Math.abs(mx) < deadzone && Math.abs(my) < deadzone) {
        return null
    }
    if (Math.abs(mx) >= Math.abs(my)) {
        return mx > 0 ? "right" : "left"
    }
    return my > 0 ? "up" : "down"
}

function dirLabel(dir: keyof VirtualStickKeys): string {
    switch (dir) {
        case "up":
            return "Up"
        case "down":
            return "Down"
        case "left":
            return "Left"
        case "right":
            return "Right"
    }
}

function viewportSize(): { vw: number, vh: number } {
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
    const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
    return { vw, vh }
}

/** DOM + input for the on-screen virtual controller (mobile HUD: fixed controls, no panel shell). */
export class VirtualControllerOverlay {
    private deps: VirtualControllerDeps
    private root = document.createElement("div")
    private hudLayer = document.createElement("div")
    private settingsBtn = document.createElement("button")
    private settingsBar = document.createElement("div")
    private addBtn = document.createElement("button")
    private addMenu = document.createElement("div")
    private addPickDigital = document.createElement("button")
    private addPickStick = document.createElement("button")
    private addPickCancel = document.createElement("button")
    private resetBtn = document.createElement("button")
    private applyBtn = document.createElement("button")
    private shroud = document.createElement("div")
    private listenHint = document.createElement("div")

    private layout: VirtualLayoutFile = defaultLayout()
    private settingsMode = false
    private addMenuOpen = false
    private visible = false
    private listenCtx: KeyListenCtx | null = null
    private rafId: number | null = null

    private pointerDownOnControl = new Map<string, { x: number, y: number, dragged: boolean }>()
    private activePress = new Set<string>()
    private stickL = { x: 0, y: 0 }
    private stickR = { x: 0, y: 0 }
    /** Per-control knob position for {@link VirtualControlRole} `stickWasd` (each stick is independent). */
    private stickKeyVisual = new Map<string, { x: number, y: number }>()
    private stickKeyDir = new Map<string, keyof VirtualStickKeys | null>()
    private stickDrag: null | {
        id: string
        role: StickDragRole
        ox: number
        oy: number
        startX: number
        startY: number
    } = null

    private moveDrag: null | { id: string, rect0: VirtualControlRect, ptr0X: number, ptr0Y: number } = null
    private resizeDrag: null | { id: string, startW: number, startH: number, ptrX: number, ptrY: number } = null

    private readonly screenKbTextHandler = (ev: Event) => this.onScreenKbText(ev)
    private readonly screenKbKeyHandler = (ev: KeyboardEvent) => this.onScreenKbKey(ev)

    constructor(deps: VirtualControllerDeps) {
        this.deps = deps
        this.root.className = "ml-virtual-controller"
        this.hudLayer.className = "ml-virtual-controller-hud"
        this.settingsBtn.type = "button"
        this.settingsBtn.className = "ml-virtual-controller-fab ml-virtual-controller-fab--settings"
        this.settingsBtn.title = "Controller layout settings"
        this.settingsBtn.setAttribute("aria-label", "Controller layout settings")
        this.settingsBtn.textContent = "⚙"

        this.settingsBar.className = "ml-virtual-controller-settings-dock"
        this.addBtn.type = "button"
        this.addBtn.className = "ml-virtual-controller-settings-action"
        this.addBtn.textContent = "+ Add"
        this.addMenu.className = "ml-virtual-controller-add-menu"
        this.addPickDigital.type = "button"
        this.addPickDigital.className = "ml-virtual-controller-settings-action"
        this.addPickDigital.textContent = "Button"
        this.addPickStick.type = "button"
        this.addPickStick.className = "ml-virtual-controller-settings-action"
        this.addPickStick.textContent = "Joystick (keys)"
        this.addPickCancel.type = "button"
        this.addPickCancel.className = "ml-virtual-controller-settings-action"
        this.addPickCancel.textContent = "Cancel"
        this.addMenu.appendChild(this.addPickDigital)
        this.addMenu.appendChild(this.addPickStick)
        this.addMenu.appendChild(this.addPickCancel)

        this.resetBtn.type = "button"
        this.resetBtn.className = "ml-virtual-controller-settings-action"
        this.resetBtn.textContent = "Reset"
        this.applyBtn.type = "button"
        this.applyBtn.className = "ml-virtual-controller-settings-action ml-virtual-controller-settings-action--primary"
        this.applyBtn.textContent = "Apply"

        this.shroud.className = "ml-virtual-controller-shroud"
        this.listenHint.className = "ml-virtual-controller-listen-hint"
        this.listenHint.textContent = "Tap a key on the keyboard or press a hardware key…"

        this.settingsBar.appendChild(this.addBtn)
        this.settingsBar.appendChild(this.resetBtn)
        this.settingsBar.appendChild(this.applyBtn)
        this.settingsBar.appendChild(this.addMenu)

        this.hudLayer.appendChild(this.shroud)
        this.root.appendChild(this.hudLayer)
        this.root.appendChild(this.settingsBtn)
        this.root.appendChild(this.settingsBar)
        this.root.appendChild(this.listenHint)

        this.settingsBtn.addEventListener("click", () => this.toggleSettings())
        this.addBtn.addEventListener("click", () => {
            this.addMenuOpen = !this.addMenuOpen
            this.syncAddMenu()
        })
        this.addPickDigital.addEventListener("click", () => {
            this.addMenuOpen = false
            this.syncAddMenu()
            this.addDigitalControl()
        })
        this.addPickStick.addEventListener("click", () => {
            this.addMenuOpen = false
            this.syncAddMenu()
            this.addStickKeysControl()
        })
        this.addPickCancel.addEventListener("click", () => {
            this.addMenuOpen = false
            this.syncAddMenu()
        })
        this.resetBtn.addEventListener("click", () => {
            this.layout = defaultLayout()
            this.renderControls()
        })
        this.applyBtn.addEventListener("click", () => this.applySettings())
    }

    private readonly onWindowKeyWhileListening = (ev: KeyboardEvent) => {
        if (!this.listenCtx) return
        if (LISTEN_CANCEL_KEYS.has(ev.key)) {
            ev.preventDefault()
            this.stopListening()
            return
        }
        const vk = convertToKey(ev)
        if (vk == null) return
        ev.preventDefault()
        this.applyListenKey(vk)
    }

    private syncAddMenu(): void {
        this.addMenu.classList.toggle("ml-virtual-controller-add-menu--open", this.addMenuOpen && this.settingsMode)
    }

    getElement(): HTMLElement {
        return this.root
    }

    show(): void {
        this.layout = loadLayout()
        if (!this.root.parentElement) {
            document.body.appendChild(this.root)
        }
        window.removeEventListener("keydown", this.onWindowKeyWhileListening)
        window.addEventListener("keydown", this.onWindowKeyWhileListening)
        this.visible = true
        this.root.style.display = "block"
        this.syncSettingsUi()
        this.renderControls()
        const input = this.deps.getStreamInput()
        if (input?.isConnected()) {
            input.enableVirtualController()
        }
        this.startRaf()
    }

    hide(): void {
        this.releaseAllStickKeyDirections()
        this.visible = false
        this.stopListening()
        window.removeEventListener("keydown", this.onWindowKeyWhileListening)
        this.settingsMode = false
        this.addMenuOpen = false
        this.root.style.display = "none"
        this.deps.getStreamInput()?.disableVirtualController()
        this.stopRaf()
        this.activePress.clear()
        this.pointerDownOnControl.clear()
        this.stickDrag = null
        this.moveDrag = null
        this.resizeDrag = null
        this.stickKeyVisual.clear()
    }

    isVisible(): boolean {
        return this.visible
    }

    /** Call when stream connects while overlay is open. */
    onStreamConnected(): void {
        if (this.visible) {
            this.deps.getStreamInput()?.enableVirtualController()
        }
    }

    /** Call when stream disconnects. */
    onStreamDisconnected(): void {
        this.stopListening()
    }

    private startRaf(): void {
        if (this.rafId != null) return
        const tick = () => {
            this.rafId = window.requestAnimationFrame(tick)
            this.flushGamepad()
        }
        this.rafId = window.requestAnimationFrame(tick)
    }

    private stopRaf(): void {
        if (this.rafId != null) {
            window.cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
    }

    private flushGamepad(): void {
        const input = this.deps.getStreamInput()
        if (!input?.isConnected() || input.getVirtualControllerSlot() == null) {
            return
        }
        if (this.settingsMode) {
            input.pushVirtualControllerState(emptyGamepadState())
            return
        }
        const state = this.buildGamepadState()
        input.pushVirtualControllerState(state)
    }

    private buildGamepadState(): GamepadState {
        const s = emptyGamepadState()
        for (const def of this.layout.controls) {
            if (!def.enabled) continue
            const flag =
                def.role === "custom" ? (def.gamepadFlag ?? StreamControllerButton.BUTTON_A) : roleToGamepadFlag(def.role)
            if (def.role === "l2" && this.activePress.has(def.id)) {
                s.leftTrigger = 1
            } else if (def.role === "r2" && this.activePress.has(def.id)) {
                s.rightTrigger = 1
            } else if (
                flag !== 0 &&
                (def.role === "custom" || ["l2", "r2", "stickL", "stickR", "stickWasd"].indexOf(def.role) < 0) &&
                this.activePress.has(def.id)
            ) {
                s.buttonFlags |= flag
            }
        }
        s.leftStickX = this.stickL.x
        s.leftStickY = this.stickL.y
        s.rightStickX = this.stickR.x
        s.rightStickY = this.stickR.y
        return s
    }

    private toggleSettings(): void {
        this.settingsMode = !this.settingsMode
        if (this.settingsMode) {
            this.releaseAllStickKeyDirections()
            this.stickL = { x: 0, y: 0 }
            this.stickR = { x: 0, y: 0 }
            this.stickKeyVisual.clear()
            this.stickDrag = null
            this.pointerDownOnControl.clear()
            this.moveDrag = null
            this.activePress.clear()
        } else {
            this.addMenuOpen = false
            this.stopListening()
        }
        this.syncSettingsUi()
        this.renderControls()
    }

    private syncSettingsUi(): void {
        this.root.classList.toggle("ml-virtual-controller--settings", this.settingsMode)
        this.settingsBar.style.display = this.settingsMode ? "flex" : "none"
        this.shroud.style.display = this.settingsMode ? "block" : "none"
        this.syncAddMenu()
    }

    private applySettings(): void {
        saveLayout(this.layout)
        this.settingsMode = false
        this.addMenuOpen = false
        this.stopListening()
        this.syncSettingsUi()
        this.renderControls()
    }

    private addDigitalControl(): void {
        const id = `custom-${Date.now().toString(36)}`
        this.layout.controls.push({
            id,
            role: "custom",
            rect: { x: 0.4, y: 0.45, w: 0.1, h: 0.08 },
            enabled: true,
            gamepadFlag: StreamControllerButton.BUTTON_A,
            keyboardKey: null,
        })
        this.renderControls()
    }

    private addStickKeysControl(): void {
        const id = `wasd-${Date.now().toString(36)}`
        this.layout.controls.push({
            id,
            role: "stickWasd",
            rect: { x: 0.38, y: 0.44, w: 0.16, h: 0.18 },
            enabled: true,
            stickKeys: defaultStickKeys(),
        })
        this.renderControls()
    }

    private applyListenKey(vk: number): void {
        const ctx = this.listenCtx
        if (!ctx) return
        if (ctx.kind === "digital") {
            this.assignKeyToControl(ctx.controlId, vk)
        } else {
            const c = this.layout.controls.find((x) => x.id === ctx.controlId)
            if (c?.role === "stickWasd") {
                if (!c.stickKeys) c.stickKeys = defaultStickKeys()
                c.stickKeys[ctx.dir] = vk
            }
        }
        this.stopListening()
        this.renderControls()
    }

    private assignKeyToControl(controlId: string, vk: number): void {
        const c = this.layout.controls.find((x) => x.id === controlId)
        if (!c) return
        c.keyboardKey = vk
    }

    private stopListening(): void {
        this.listenCtx = null
        this.listenHint.style.display = "none"
        const kb = this.deps.getScreenKeyboard()
        kb.removeTextListener(this.screenKbTextHandler as (e: TextEvent) => void)
        kb.removeKeyDownListener(this.screenKbKeyHandler)
    }

    private onScreenKbText(ev: Event) {
        if (!this.listenCtx) return
        const te = ev as TextEvent
        const ch = te.detail?.text?.[0]
        if (!ch) return
        const vk = charToStreamKey(ch)
        if (vk == null) return
        this.applyListenKey(vk)
    }

    private onScreenKbKey(ev: KeyboardEvent) {
        if (!this.listenCtx) return
        const vk = convertToKey(ev as KeyboardEvent)
        if (vk == null) return
        this.applyListenKey(vk)
    }

    private startListeningDigital(controlId: string): void {
        this.stopListening()
        this.listenCtx = { kind: "digital", controlId }
        this.updateListenHint()
        const kb = this.deps.getScreenKeyboard()
        kb.show()
        kb.addTextListener(this.screenKbTextHandler as (e: TextEvent) => void)
        kb.addKeyDownListener(this.screenKbKeyHandler)
    }

    private startListeningStickDir(controlId: string, dir: keyof VirtualStickKeys): void {
        this.stopListening()
        this.listenCtx = { kind: "stickDir", controlId, dir }
        this.updateListenHint()
        const kb = this.deps.getScreenKeyboard()
        kb.show()
        kb.addTextListener(this.screenKbTextHandler as (e: TextEvent) => void)
        kb.addKeyDownListener(this.screenKbKeyHandler)
    }

    private updateListenHint(): void {
        if (!this.listenCtx) return
        if (this.listenCtx.kind === "digital") {
            this.listenHint.textContent = "Tap a key on the keyboard or press a hardware key…"
        } else {
            this.listenHint.textContent = `Press a key for ${dirLabel(this.listenCtx.dir)}…`
        }
        this.listenHint.style.display = "block"
    }

    private releaseAllStickKeyDirections(): void {
        const input = this.deps.getStreamInput()
        if (!input?.isConnected()) {
            this.stickKeyDir.clear()
            return
        }
        for (const [id, dir] of this.stickKeyDir) {
            if (!dir) continue
            const def = this.layout.controls.find((c) => c.id === id)
            if (def?.role === "stickWasd" && def.stickKeys) {
                input.sendKey(false, def.stickKeys[dir], 0)
            }
        }
        this.stickKeyDir.clear()
    }

    private updateStickKeyDirections(def: VirtualControlDef, mx: number, my: number): void {
        if (def.role !== "stickWasd" || !def.stickKeys) return
        const input = this.deps.getStreamInput()
        if (!input?.isConnected()) return
        const next = stickDirFromVector(mx, my, STICK_KEY_DEADZONE)
        const prev = this.stickKeyDir.get(def.id) ?? null
        if (prev === next) return
        if (prev != null) {
            input.sendKey(false, def.stickKeys[prev], 0)
        }
        if (next != null) {
            input.sendKey(true, def.stickKeys[next], 0)
        }
        this.stickKeyDir.set(def.id, next)
    }

    private renderControls(): void {
        for (const el of this.hudLayer.querySelectorAll(".ml-virtual-controller-control")) {
            el.remove()
        }
        for (const def of this.layout.controls) {
            if (!def.enabled && !this.settingsMode) continue

            const wrap = document.createElement("div")
            wrap.className = "ml-virtual-controller-control"
            wrap.dataset.controlId = def.id
            if (!def.enabled) wrap.classList.add("ml-virtual-controller-control--disabled")
            if (
                this.listenCtx &&
                this.listenCtx.controlId === def.id &&
                (this.listenCtx.kind === "digital" || this.listenCtx.kind === "stickDir")
            ) {
                wrap.classList.add("ml-virtual-controller-control--listening")
            }

            const pct = (r: VirtualControlRect) => ({
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
            })
            const p = pct(def.rect)
            wrap.style.left = p.left
            wrap.style.top = p.top
            wrap.style.width = p.width
            wrap.style.height = p.height

            const face = document.createElement("div")
            face.className = "ml-virtual-controller-face"
            const isAnalogStick = def.role === "stickL" || def.role === "stickR"
            const isKeyStick = def.role === "stickWasd"
            if (isAnalogStick || isKeyStick) {
                face.classList.add("ml-virtual-controller-face--stick")
                const disc = document.createElement("div")
                disc.className = "ml-virtual-controller-stick-disc"
                const knob = document.createElement("div")
                knob.className = "ml-virtual-controller-stick-knob"
                disc.appendChild(knob)
                face.appendChild(disc)
                const vec =
                    def.role === "stickL"
                        ? this.stickL
                        : def.role === "stickR"
                          ? this.stickR
                          : (this.stickKeyVisual.get(def.id) ?? { x: 0, y: 0 })
                this.positionKnob(knob, vec)
                if (this.settingsMode && isKeyStick && def.stickKeys) {
                    this.appendStickDirCaps(wrap, def)
                }
            } else {
                const lbl = document.createElement("span")
                lbl.className = "ml-virtual-controller-label"
                lbl.textContent = digitalFaceLabel(def)
                face.appendChild(lbl)
            }

            wrap.appendChild(face)

            if (this.settingsMode) {
                const resizeHandle = document.createElement("div")
                resizeHandle.className = "ml-virtual-controller-handle ml-virtual-controller-handle--resize"
                resizeHandle.title = "Resize"
                resizeHandle.textContent = "⤢"
                const toggleHandle = document.createElement("div")
                toggleHandle.className = "ml-virtual-controller-handle ml-virtual-controller-handle--toggle"
                toggleHandle.title = "Remove control"
                toggleHandle.textContent = "⊘"
                const onToggle = (e: Event) => {
                    e.preventDefault()
                    e.stopPropagation()
                    const idx = this.layout.controls.findIndex((c) => c.id === def.id)
                    if (idx >= 0) this.layout.controls.splice(idx, 1)
                    if (this.listenCtx?.controlId === def.id) this.stopListening()
                    this.renderControls()
                }
                toggleHandle.addEventListener("pointerdown", (e) => e.stopPropagation())
                toggleHandle.addEventListener("pointerup", onToggle)
                toggleHandle.addEventListener("click", (e) => e.preventDefault())
                resizeHandle.addEventListener("pointerdown", (e) => {
                    e.stopPropagation()
                    this.beginResize(def.id, e)
                })
                wrap.appendChild(resizeHandle)
                wrap.appendChild(toggleHandle)
            }

            this.installControlPointers(wrap, face, def)
            this.hudLayer.appendChild(wrap)
        }
    }

    private appendStickDirCaps(wrap: HTMLElement, def: VirtualControlDef): void {
        if (!def.stickKeys) return
        const dirs: Array<{ dir: keyof VirtualStickKeys, classSuffix: string }> = [
            { dir: "up", classSuffix: "up" },
            { dir: "left", classSuffix: "left" },
            { dir: "down", classSuffix: "down" },
            { dir: "right", classSuffix: "right" },
        ]
        for (const { dir, classSuffix } of dirs) {
            const cap = document.createElement("button")
            cap.type = "button"
            cap.className = `ml-virtual-controller-stick-key-dir ml-virtual-controller-stick-key-dir--${classSuffix}`
            cap.textContent = formatKeyCaption(def.stickKeys[dir])
            cap.title = `Assign ${dirLabel(dir)}`
            cap.addEventListener("pointerdown", (e) => {
                e.stopPropagation()
                e.preventDefault()
            })
            cap.addEventListener("pointerup", (e) => {
                e.stopPropagation()
                e.preventDefault()
                this.startListeningStickDir(def.id, dir)
            })
            wrap.appendChild(cap)
        }
    }

    private positionKnob(knob: HTMLElement, stick: { x: number, y: number }) {
        const cx = 50 + stick.x * 35
        const cy = 50 - stick.y * 35
        knob.style.left = `${cx}%`
        knob.style.top = `${cy}%`
    }

    private installControlPointers(wrap: HTMLElement, face: HTMLElement, def: VirtualControlDef): void {
        const isAnalogStick = def.role === "stickL" || def.role === "stickR"
        const isKeyStick = def.role === "stickWasd"
        const isAnyStick = isAnalogStick || isKeyStick
        const stickRole: StickDragRole | null = isAnalogStick
            ? (def.role as "stickL" | "stickR")
            : isKeyStick
              ? "stickWasd"
              : null

        /* Combos: each control id can be in activePress; each face captures its pointer — multiple buttons, multiple pointers. Same face + two fingers still one capture target. */
        face.addEventListener("lostpointercapture", () => {
            face.classList.remove(FACE_PRESSED_CLASS)
        })

        face.addEventListener("pointerdown", (e) => {
            if (!def.enabled) return
            if (!this.settingsMode) {
                e.preventDefault()
                e.stopPropagation()
                face.classList.add(FACE_PRESSED_CLASS)
            }
            if (this.settingsMode) {
                const t = e.target as HTMLElement
                if (t.closest(".ml-virtual-controller-handle")) return
                if (t.closest(".ml-virtual-controller-stick-key-dir")) return
                this.pointerDownOnControl.set(def.id, { x: e.clientX, y: e.clientY, dragged: false })
                /* Edit: sticks move like buttons (whole control drag); no inner stick axis drag. */
                return
            }
            if (isAnyStick && stickRole) {
                const disc = face.querySelector(".ml-virtual-controller-stick-disc") as HTMLElement | null
                const rect = (disc ?? face).getBoundingClientRect()
                const ox = (e.clientX - rect.left) / rect.width - 0.5
                const oy = 0.5 - (e.clientY - rect.top) / rect.height
                this.stickDrag = {
                    id: def.id,
                    role: stickRole,
                    ox,
                    oy,
                    startX: e.clientX,
                    startY: e.clientY,
                }
                face.setPointerCapture(e.pointerId)
            } else {
                this.sendDigitalDown(def)
                face.setPointerCapture(e.pointerId)
            }
        })

        face.addEventListener("pointermove", (e) => {
            if (this.settingsMode && this.pointerDownOnControl.has(def.id)) {
                const rec = this.pointerDownOnControl.get(def.id)!
                const dx = e.clientX - rec.x
                const dy = e.clientY - rec.y
                if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
                    if (!rec.dragged) {
                        rec.dragged = true
                        this.moveDrag = {
                            id: def.id,
                            rect0: { ...def.rect },
                            ptr0X: e.clientX,
                            ptr0Y: e.clientY,
                        }
                    }
                }
                if (this.moveDrag?.id === def.id) {
                    const { vw, vh } = viewportSize()
                    const dx2 = (e.clientX - this.moveDrag.ptr0X) / vw
                    const dy2 = (e.clientY - this.moveDrag.ptr0Y) / vh
                    def.rect.x = Math.max(0, Math.min(1 - def.rect.w, this.moveDrag.rect0.x + dx2))
                    def.rect.y = Math.max(0, Math.min(1 - def.rect.h, this.moveDrag.rect0.y + dy2))
                    wrap.style.left = `${def.rect.x * 100}%`
                    wrap.style.top = `${def.rect.y * 100}%`
                }
            }
            if (this.stickDrag?.id === def.id) {
                const disc = face.querySelector(".ml-virtual-controller-stick-disc") as HTMLElement | null
                const rect = (disc ?? face).getBoundingClientRect()
                const nx = (e.clientX - rect.left) / rect.width - 0.5
                const ny = 0.5 - (e.clientY - rect.top) / rect.height
                const mx = Math.max(-1, Math.min(1, nx * 2))
                const my = Math.max(-1, Math.min(1, ny * 2))
                const role = this.stickDrag.role
                if (role === "stickL") {
                    this.stickL.x = mx
                    this.stickL.y = my
                    const knob = face.querySelector(".ml-virtual-controller-stick-knob") as HTMLElement
                    if (knob) this.positionKnob(knob, this.stickL)
                } else if (role === "stickR") {
                    this.stickR.x = mx
                    this.stickR.y = my
                    const knob = face.querySelector(".ml-virtual-controller-stick-knob") as HTMLElement
                    if (knob) this.positionKnob(knob, this.stickR)
                } else {
                    let sk = this.stickKeyVisual.get(def.id)
                    if (!sk) {
                        sk = { x: 0, y: 0 }
                        this.stickKeyVisual.set(def.id, sk)
                    }
                    sk.x = mx
                    sk.y = my
                    const knob = face.querySelector(".ml-virtual-controller-stick-knob") as HTMLElement
                    if (knob) this.positionKnob(knob, sk)
                    if (!this.settingsMode && def.role === "stickWasd") {
                        this.updateStickKeyDirections(def, mx, my)
                    }
                }
            }
        })

        const endStick = (e: PointerEvent) => {
            if (this.stickDrag?.id === def.id) {
                const role = this.stickDrag.role
                if (this.settingsMode) {
                    if (role === "stickL") {
                        this.stickL.x = 0
                        this.stickL.y = 0
                    } else if (role === "stickR") {
                        this.stickR.x = 0
                        this.stickR.y = 0
                    } else {
                        this.stickKeyVisual.set(def.id, { x: 0, y: 0 })
                    }
                    const knob = face.querySelector(".ml-virtual-controller-stick-knob") as HTMLElement
                    if (knob) {
                        const v =
                            role === "stickL"
                                ? this.stickL
                                : role === "stickR"
                                  ? this.stickR
                                  : (this.stickKeyVisual.get(def.id) ?? { x: 0, y: 0 })
                        this.positionKnob(knob, v)
                    }
                } else {
                    if (role === "stickL") {
                        this.stickL.x = 0
                        this.stickL.y = 0
                    } else if (role === "stickR") {
                        this.stickR.x = 0
                        this.stickR.y = 0
                    } else {
                        this.stickKeyVisual.set(def.id, { x: 0, y: 0 })
                        if (def.role === "stickWasd") {
                            const input = this.deps.getStreamInput()
                            const dir = this.stickKeyDir.get(def.id)
                            if (input?.isConnected() && dir != null && def.stickKeys) {
                                input.sendKey(false, def.stickKeys[dir], 0)
                            }
                            this.stickKeyDir.delete(def.id)
                        }
                    }
                    const knob = face.querySelector(".ml-virtual-controller-stick-knob") as HTMLElement
                    if (knob) {
                        const v =
                            role === "stickL"
                                ? this.stickL
                                : role === "stickR"
                                  ? this.stickR
                                  : (this.stickKeyVisual.get(def.id) ?? { x: 0, y: 0 })
                        this.positionKnob(knob, v)
                    }
                }
                this.stickDrag = null
            }
        }

        face.addEventListener("pointerup", (e) => {
            if (this.settingsMode) {
                const rec = this.pointerDownOnControl.get(def.id)
                this.pointerDownOnControl.delete(def.id)
                this.moveDrag = null
                if (rec && !rec.dragged && !isAnyStick && def.role !== "l2" && def.role !== "r2") {
                    this.startListeningDigital(def.id)
                }
                endStick(e)
                return
            }
            face.classList.remove(FACE_PRESSED_CLASS)
            if (!isAnyStick) {
                this.sendDigitalUp(def)
            } else {
                endStick(e)
            }
        })
        face.addEventListener("pointercancel", (e) => {
            this.pointerDownOnControl.delete(def.id)
            this.moveDrag = null
            if (!this.settingsMode && !isAnyStick) this.sendDigitalUp(def)
            endStick(e)
            if (!this.settingsMode) face.classList.remove(FACE_PRESSED_CLASS)
        })
    }

    private beginResize(controlId: string, e: PointerEvent): void {
        const def = this.layout.controls.find((c) => c.id === controlId)
        if (!def) return
        this.resizeDrag = {
            id: controlId,
            startW: def.rect.w,
            startH: def.rect.h,
            ptrX: e.clientX,
            ptrY: e.clientY,
        }
        const onMove = (ev: PointerEvent) => {
            if (!this.resizeDrag || this.resizeDrag.id !== controlId) return
            const { vw, vh } = viewportSize()
            const dw = (ev.clientX - this.resizeDrag.ptrX) / vw
            const dh = (ev.clientY - this.resizeDrag.ptrY) / vh
            let nw = Math.max(0.04, Math.min(0.55, this.resizeDrag.startW + dw))
            let nh = Math.max(0.04, Math.min(0.55, this.resizeDrag.startH + dh))
            if (def.role === "stickL" || def.role === "stickR") {
                const side = Math.max(nw, nh)
                nw = side
                nh = side
            }
            nw = Math.min(nw, 1 - def.rect.x)
            nh = Math.min(nh, 1 - def.rect.y)
            def.rect.w = nw
            def.rect.h = nh
            const wrap = this.hudLayer.querySelector(`[data-control-id="${controlId}"]`) as HTMLElement | null
            if (wrap) {
                wrap.style.left = `${def.rect.x * 100}%`
                wrap.style.top = `${def.rect.y * 100}%`
                wrap.style.width = `${def.rect.w * 100}%`
                wrap.style.height = `${def.rect.h * 100}%`
            }
        }
        const onEnd = () => {
            this.resizeDrag = null
            document.removeEventListener("pointermove", onMove)
            document.removeEventListener("pointerup", onEnd)
            document.removeEventListener("pointercancel", onEnd)
        }
        document.addEventListener("pointermove", onMove)
        document.addEventListener("pointerup", onEnd)
        document.addEventListener("pointercancel", onEnd)
    }

    private sendDigitalDown(def: VirtualControlDef): void {
        if (def.keyboardKey != null && def.keyboardKey !== undefined) {
            this.deps.getStreamInput()?.sendKey(true, def.keyboardKey, 0)
            return
        }
        this.activePress.add(def.id)
    }

    private sendDigitalUp(def: VirtualControlDef): void {
        if (def.keyboardKey != null && def.keyboardKey !== undefined) {
            this.deps.getStreamInput()?.sendKey(false, def.keyboardKey, 0)
            return
        }
        this.activePress.delete(def.id)
    }
}
