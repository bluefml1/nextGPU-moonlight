import "./polyfill/index.js"
import { Api, getApi } from "./api.js";
import { Component } from "./component/index.js";
import { showErrorPopup } from "./component/error.js";
import { InfoEvent, Stream } from "./stream/index.js"
import { getModalBackground, Modal, showMessage, showModal } from "./component/modal/index.js";
import { getSidebarDragOffsetY, getSidebarRoot, isSidebarExtended, setSidebar, setSidebarExtended, setSidebarStyle, Sidebar } from "./component/sidebar/index.js";
import { defaultStreamInputConfig, MouseMode, ScreenKeyboardSetVisibleEvent, StreamInputConfig } from "./stream/input.js";
import {
    exportAppSettingsToFile,
    getSettingsForApp,
    importAppSettingsFromJson,
    loadStaticAppSettingsFile,
    setSettingsForApp,
} from "./app_settings.js";
import { Settings, StreamSettingsComponent } from "./component/settings_menu.js";
import { setStyle as setPageStyle } from "./styles/index.js";
import { SelectComponent } from "./component/input.js";
import { LogMessageType, StreamCapabilities, StreamKeys, StreamKeyModifiers } from "./api_bindings.js";
import { ScreenKeyboard, TextEvent } from "./screen_keyboard.js";
import { VirtualControllerOverlay } from "./virtual_controller_overlay.js";
import { FormModal } from "./component/modal/form.js";
import { StreamStatsData } from "./stream/stats.js";
import { MoonlightLoadingScreen, MoonlightPointerLockOverlay } from "./stream_overlays.js";
import { runStreamProfileGate } from "./component/stream_profile_gate.js";
import {
    createRealtimeBitrateHud,
    formatStreamBitrateMbpsDisplay,
    type RealtimeBitrateHud,
} from "./component/realtime_bitrate_hud.js"
import {
    getBitrateTierForSettings,
    snapBitrateMbpsForTier,
} from "./stream_profile_presets.js"
import { streamDebugLine, streamLogMatches, streamLogStartsWith, streamT } from "./stream_locale.js"
import {
    applyStreamDocumentTitle,
    getStreamMachineLabel,
    initStreamMachineLabel,
    streamLoadingTitle,
} from "./stream_label.js"

/** Matches stream index.ts — host bitrate POST feedback from streamer. */
const MOONLIGHT_BITRATE_LOG_PREFIX = "[Moonlight][Bitrate]"

/** When false, skip `runStreamProfileGate` — stream uses `default_settings.ts` / saved mlSettings only (no picker, no `?profile=` merge from `stream_profile_presets.ts`). */
const ENABLE_STREAM_PROFILE_GATE = true

/** Persisted stream viewer mouse/touch mode (separate from `mlSettings`). */
const ML_STREAM_INPUT_MODES_KEY = "mlStreamInputModes"

function isPhoneLikeDevice(): boolean {
    try {
        const ua = navigator.userAgent || ""
        const isiPadLike = /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
        const isTabletUa = /Tablet|Android/.test(ua)
        const touchPrimary = !window.matchMedia("(hover: hover) and (pointer: fine)").matches
        return (
            ("maxTouchPoints" in navigator && navigator.maxTouchPoints > 0) &&
            (window.matchMedia("(pointer: coarse)").matches || isiPadLike || (isTabletUa && touchPrimary))
        )
    } catch {
        return false
    }
}

function defaultStreamInputConfigForDevice(): StreamInputConfig {
    const config = defaultStreamInputConfig()
    if (isPhoneLikeDevice()) {
        config.touchMode = "touch"
    }
    return config
}

function mergePersistedStreamInputModes(base: StreamInputConfig): StreamInputConfig {
    try {
        const raw = localStorage.getItem(ML_STREAM_INPUT_MODES_KEY)
        if (!raw) return base
        const o = JSON.parse(raw) as Partial<{ mouseMode: string; touchMode: string }>
        if (o.mouseMode === "relative" || o.mouseMode === "follow" || o.mouseMode === "pointAndDrag") {
            base.mouseMode = o.mouseMode
        }
        if (o.touchMode === "touch" || o.touchMode === "mouseRelative" || o.touchMode === "pointAndDrag") {
            base.touchMode = o.touchMode
        }
    } catch {
        /* ignore corrupt storage */
    }
    return base
}

/** Local dev hostnames — connection log panel is available here when DevTools is open. */
function isLocalDevHostname(): boolean {
    const h = location.hostname
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".local")
}

/** Enable dev connection log: localhost family, or `?streamLog=1` (any host; panel stays visible). */
function shouldAttachDevConnectionLog(): boolean {
    if (typeof location === "undefined") return false
    if (new URLSearchParams(location.search).get("streamLog") === "1") return true
    return isLocalDevHostname()
}

/** Heuristic: docked DevTools usually shrinks the viewport vs the outer window. */
function detectDevToolsOpen(): boolean {
    const threshold = 140
    const w = window.outerWidth - window.innerWidth
    const h = window.outerHeight - window.innerHeight
    return w > threshold || h > threshold
}

function computeDevConnectionLogPanelVisible(): boolean {
    if (new URLSearchParams(location.search).get("streamLog") === "1") return true
    if (!isLocalDevHostname()) return false
    return detectDevToolsOpen()
}

/**
 * Read-only connection log for development: same stream events as the old modal, but no modal overlay.
 * Shown when DevTools appears docked (localhost) or always with ?streamLog=1.
 */
class DevStreamConnectionLog {
    private shell = document.createElement("div")
    private root = document.createElement("div")
    private textTy: LogMessageType | null = null
    private text = document.createElement("p")
    private options = document.createElement("div")
    private debugDetailButton = document.createElement("button")
    private hidePanelButton = document.createElement("button")
    private debugDetail = ""
    private debugDetailDisplay = document.createElement("div")
    private hideUntil = 0

    constructor() {
        this.shell.className = "dev-stream-connection-log-shell"
        this.shell.style.cssText =
            "position:fixed;bottom:10px;left:10px;max-width:min(420px,calc(100vw - 20px));max-height:36vh;" +
            "z-index:99985;display:none;overflow:hidden;border-radius:10px;" +
            "box-shadow:0 8px 32px rgba(0,0,0,.55);background:rgba(12,12,14,.92);" +
            "backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);" +
            "border:1px solid rgba(255,255,255,.1);font:13px system-ui,sans-serif;color:rgba(255,255,255,.9)"

        const head = document.createElement("div")
        head.style.cssText =
            "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;" +
            "border-bottom:1px solid rgba(255,255,255,.08);font-size:11px;font-weight:600;" +
            "letter-spacing:.04em;text-transform:uppercase;color:rgba(255,255,255,.45)"
        head.textContent = streamT("devLog.title")
        this.shell.appendChild(head)

        this.root.classList.add("modal-video-connect")
        this.root.style.cssText = "margin:0;padding:10px 12px 12px;max-height:calc(36vh - 40px);overflow:auto"
        this.text.innerText = streamT("modal.connecting")
        this.root.appendChild(this.text)

        this.root.appendChild(this.options)
        this.options.classList.add("modal-video-connect-options")

        this.debugDetailButton.innerText = streamT("devLog.showLogs")
        this.debugDetailButton.addEventListener("click", this.onDebugDetailClick.bind(this))
        this.options.appendChild(this.debugDetailButton)

        this.hidePanelButton.innerText = streamT("devLog.hide")
        this.hidePanelButton.addEventListener("click", () => {
            this.hideUntil = Date.now() + 20000
            this.shell.style.display = "none"
        })
        this.options.appendChild(this.hidePanelButton)

        this.debugDetailDisplay.classList.add("textlike")
        this.debugDetailDisplay.classList.add("modal-video-connect-debug")

        this.shell.appendChild(this.root)
        document.body.appendChild(this.shell)
    }

    applyDesiredVisibility(visible: boolean) {
        if (Date.now() < this.hideUntil) {
            this.shell.style.display = "none"
            return
        }
        this.shell.style.display = visible ? "block" : "none"
    }

    private onDebugDetailClick() {
        const shown = this.root.contains(this.debugDetailDisplay)
        if (shown) {
            this.debugDetailButton.innerText = streamT("devLog.showLogs")
            this.root.removeChild(this.debugDetailDisplay)
        } else {
            this.debugDetailButton.innerText = streamT("devLog.hideLogs")
            this.root.appendChild(this.debugDetailDisplay)
            this.debugDetailDisplay.innerText = this.debugDetail
        }
    }

    private debugLog(line: string) {
        this.debugDetail += `${line}\n`
        this.debugDetailDisplay.innerText = this.debugDetail
        console.info(`[Stream]: ${line}`)
    }

    onInfo(event: InfoEvent) {
        const data = event.detail

        if (data.type == "app") {
            this.debugLog(`App: ${data.app.title}`)
        } else if (data.type == "connectionComplete") {
            const t = streamT("devLog.connectionComplete")
            this.text.innerText = t
            this.debugLog(t)
        } else if (data.type == "addDebugLine") {
            const message = data.line.trim()
            if (message) {
                this.debugLog(message)
                if (!this.textTy) {
                    this.text.innerText = message
                    this.textTy = data.additional?.type ?? null
                } else if (
                    data.additional?.type == "fatalDescription" ||
                    data.additional?.type == "ifErrorDescription"
                ) {
                    this.text.innerText = this.text.innerText ? `${this.text.innerText}\n${message}` : message
                    this.textTy = data.additional.type
                }
            }
        } else if (data.type == "serverMessage") {
            const t = streamT("modal.serverPrefix", { message: data.message })
            this.text.innerText = t
            this.debugLog(t)
        } else if (data.type == "connectionStatus") {
            this.debugLog(streamDebugLine("log.connectionStatus", { status: String(data.status) }))
        }
    }
}

class StreamRecoveryOverlay {
    private root = document.createElement("div")
    private card = document.createElement("div")
    private title = document.createElement("h2")
    private body = document.createElement("p")
    private actions = document.createElement("div")
    private retryButton = document.createElement("button")
    private settingsButton = document.createElement("button")
    private exitButton = document.createElement("button")

    constructor(
        onRetry: () => void,
        onOpenSettings: () => void,
        onExit: () => void,
    ) {
        this.root.style.cssText =
            "position:fixed;inset:0;z-index:100003;display:none;align-items:center;justify-content:center;" +
            "background:radial-gradient(circle at 20% 20%, rgba(76,128,255,.18), transparent 45%),rgba(5,8,14,.80);" +
            "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:20px"

        this.card.style.cssText =
            "max-width:min(560px,calc(100vw - 24px));width:100%;border-radius:16px;padding:22px 22px 18px;" +
            "background:linear-gradient(180deg, rgba(14,20,34,.98), rgba(10,14,24,.98));" +
            "border:1px solid rgba(122,154,255,.28);box-shadow:0 18px 48px rgba(0,0,0,.52);" +
            "color:rgba(244,248,255,.96);font-family:Inter,system-ui,-apple-system,\"Segoe UI\",sans-serif;box-sizing:border-box"
        this.root.appendChild(this.card)

        this.title.textContent = streamT("recovery.title")
        this.title.style.cssText =
            "margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:.015em;line-height:1.25"
        this.card.appendChild(this.title)

        this.body.style.cssText =
            "margin:0 0 18px;color:rgba(221,231,255,.82);line-height:1.55;font-size:14px"
        this.body.textContent = streamT("recovery.bodyDefault")
        this.card.appendChild(this.body)

        this.actions.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;align-items:center"
        this.card.appendChild(this.actions)

        const applyButtonBase = (button: HTMLButtonElement) => {
            button.style.cssText =
                "border-radius:10px;border:1px solid transparent;padding:9px 14px;min-height:38px;" +
                "font-size:13px;font-weight:600;letter-spacing:.01em;line-height:1;cursor:pointer;" +
                "transition:filter .12s ease,opacity .12s ease,border-color .12s ease"
            button.addEventListener("mouseenter", () => {
                if (!button.disabled) button.style.filter = "brightness(1.08)"
            })
            button.addEventListener("mouseleave", () => {
                button.style.filter = "none"
            })
        }

        this.retryButton.type = "button"
        this.retryButton.textContent = streamT("recovery.retry")
        applyButtonBase(this.retryButton)
        this.retryButton.style.background = "linear-gradient(135deg, #3e68ff, #1f8dff)"
        this.retryButton.style.borderColor = "rgba(134,170,255,.75)"
        this.retryButton.style.color = "#f6f9ff"
        this.retryButton.addEventListener("click", onRetry)
        this.actions.appendChild(this.retryButton)

        this.settingsButton.type = "button"
        this.settingsButton.textContent = streamT("recovery.settings")
        applyButtonBase(this.settingsButton)
        this.settingsButton.style.background = "rgba(255,255,255,.06)"
        this.settingsButton.style.borderColor = "rgba(158,184,255,.4)"
        this.settingsButton.style.color = "rgba(234,242,255,.95)"
        this.settingsButton.addEventListener("click", onOpenSettings)
        this.actions.appendChild(this.settingsButton)

        this.exitButton.type = "button"
        this.exitButton.textContent = streamT("recovery.exit")
        applyButtonBase(this.exitButton)
        this.exitButton.style.background = "rgba(255,255,255,.03)"
        this.exitButton.style.borderColor = "rgba(255,255,255,.2)"
        this.exitButton.style.color = "rgba(220,230,246,.86)"
        this.exitButton.addEventListener("click", onExit)
        this.actions.appendChild(this.exitButton)

        document.body.appendChild(this.root)
    }

    setBusy(busy: boolean) {
        this.retryButton.disabled = busy
        this.settingsButton.disabled = busy
        this.exitButton.disabled = busy
        const opacity = busy ? "0.65" : "1"
        this.retryButton.style.opacity = opacity
        this.settingsButton.style.opacity = opacity
        this.exitButton.style.opacity = opacity
    }

    show(message: string) {
        this.body.textContent = message
        this.root.style.display = "flex"
    }

    hide() {
        this.root.style.display = "none"
        this.setBusy(false)
    }
}

async function startApp() {
    await initStreamMachineLabel()

    const api = await getApi()

    const rootElement = document.getElementById("root");
    if (rootElement == null) {
        showErrorPopup(streamT("bootstrap.initFailed"), true)
        return;
    }

    // Get Host and App via Query
    const queryParams = new URLSearchParams(location.search)

    const hostIdStr = queryParams.get("hostId")
    const appIdStr = queryParams.get("appId")
    if (hostIdStr == null || appIdStr == null) {
        await showMessage(streamT("bootstrap.missingIds"))

        window.close()
        return
    }
    const hostId = Number.parseInt(hostIdStr)
    const appId = Number.parseInt(appIdStr)

    await loadStaticAppSettingsFile()

    if (ENABLE_STREAM_PROFILE_GATE) {
        await runStreamProfileGate(queryParams)
    }

    // event propagation on overlays
    const sidebarRoot = getSidebarRoot()
    if (sidebarRoot) {
        stopPropagationOn(sidebarRoot)
    }

    const modalBackground = getModalBackground()
    if (modalBackground) {
        stopPropagationOn(modalBackground)
    }

    // Start and Mount App
    const app = new ViewerApp(api, hostId, appId)
    app.mount(rootElement);

    (window as any)["app"] = app
}

// Prevent starting transition
window.requestAnimationFrame(() => {
    // Note: elements is a live array
    const elements = document.getElementsByClassName("prevent-start-transition")
    while (elements.length > 0) {
        elements.item(0)?.classList.remove("prevent-start-transition")
    }
})

startApp()

function formatTransferBytes(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1048576).toFixed(1)} MB`
}

class ViewerApp implements Component {
    private static readonly KEY_WATCHDOG_INTERVAL_MS = 350
    private static readonly HUD_TRAY_DRAG_THRESHOLD_PX = 6
    private static readonly BITRATE_APPLY_DISMISS_MS = 10000
    private api: Api
    private hostId: number
    private appId: number

    private sidebar: ViewerSidebar

    private div = document.createElement("div")

    private statsDiv = document.createElement("div")
    private statsTopBar = document.createElement("div")
    private statsTitleDiv = document.createElement("div")
    private statsActionsDiv = document.createElement("div")
    private statsMinimizeButton = document.createElement("button")
    private statsCloseButton = document.createElement("button")
    private statsSummaryDiv = document.createElement("div")
    private statsDetailsDiv = document.createElement("div")
    private statsMinimized = false
    private statsClosed = false
    private latestConnectionState = "Connecting"
    private statsUpdateInterval: ReturnType<typeof setInterval> | null = null
    private lastIceBytesReceived: number | null = null
    private lastIceBytesTsMs: number | null = null
    private lastBitrateMbps: number | null = null
    private stream: Stream | null = null
    private recoveryOverlay: StreamRecoveryOverlay
    private recoveryShown = false

    private settings: Settings

    private inputConfig: StreamInputConfig = mergePersistedStreamInputModes(defaultStreamInputConfigForDevice())
    private previousMouseMode: MouseMode
    private toggleFullscreenWithKeybind: boolean

    private fullscreenExitCircle: HTMLDivElement | null = null
    private fullscreenExitCircleArc: SVGCircleElement | null = null
    private fullscreenExitCircleLogo: HTMLImageElement | null = null
    private fullscreenExitCircleCircumference = 0
    private fullscreenExitEscAnimationFrame: number | null = null
    private fullscreenExitEscActive = false

    private fileTransferProgressCircle: HTMLDivElement | null = null
    private fileTransferProgressArc: SVGCircleElement | null = null
    private fileTransferProgressCircumference = 0
    private fileTransferProgressLabel: HTMLSpanElement | null = null
    private fileTransferProgressHideTimer: ReturnType<typeof setTimeout> | null = null
    /** One-line status for clipboard (click ring or Ctrl+Shift+C). */
    private fileTransferLastStatus = ""
    /** Avoid sending matching keyup to host after we skipped keydown (Ctrl/Cmd+Shift+V paste / copy-progress). */
    private skipNextHostKeyUpCodes: Set<string> = new Set()
    private keyWatchdogInterval: ReturnType<typeof setInterval> | null = null
    private adaptivePointerLockArmed = false
    private adaptivePointerLockActive = false
    private adaptivePointerLockReleaseTimer: ReturnType<typeof setTimeout> | null = null
    private latestHostCursorHidden = false
    private pendingEscRelockPrompt = false
    private pointerRelockNoticeEl: HTMLDivElement | null = null
    private loadingShownForCurrentStart = false
    private startupConnectionResolved = false
    private hasConnectedOnce = false

    private devConnectionLog: DevStreamConnectionLog | null = null
    private devConnectionLogPoll: ReturnType<typeof setInterval> | null = null
    private lastSidebarAnchorKey = ""
    private settingsQuickButton: HTMLButtonElement | null = null
    /** Viewport `right` offset (px) for #ml-settings-quick-button; shifts left when the right sidebar panel is open so the button stays outside the panel. */
    private settingsQuickButtonDockRightPx = 12
    private quickDockPostTransitionTimer: ReturnType<typeof setTimeout> | null = null
    private readonly windowResizeForQuickDock = () => {
        this.scheduleSyncSettingsQuickButtonDock()
    }
    private readonly sidebarBackgroundTransitionDock = (ev: Event) => {
        const te = ev as TransitionEvent
        if (!(ev.target instanceof HTMLElement) || !ev.target.classList.contains("sidebar-background")) {
            return
        }
        if (te.propertyName !== "transform") {
            return
        }
        this.syncSettingsQuickButtonDockPosition()
    }
    private keyboardFallbackButton: HTMLButtonElement | null = null
    private controllerFallbackButton: HTMLButtonElement | null = null
    private virtualControllerOverlay: VirtualControllerOverlay
    private fullscreenToggleButton: HTMLButtonElement | null = null
    private overlayHudTray: HTMLDivElement | null = null
    private overlayHudCluster: HTMLDivElement | null = null
    private overlayBitrateApplyBtn: HTMLButtonElement | null = null
    private overlayBitrateApplyDismissTimer: ReturnType<typeof setTimeout> | null = null
    private overlayBitrateRange: HTMLInputElement | null = null
    private realtimeBitrateHud: RealtimeBitrateHud | null = null
    private statsControlsGroup: HTMLDivElement | null = null
    private bitrateToastStack: HTMLDivElement | null = null
    private fullscreenToggleButtonManualPosition = false
    private fullscreenToggleButtonDragging = false
    private overlayHudToolbar: HTMLDivElement | null = null
    private overlayHudStatsSlot: HTMLDivElement | null = null
    private hudTrayQualityRestoreBtn: HTMLButtonElement | null = null
    private hudTrayStatsRestoreBtn: HTMLButtonElement | null = null
    private overlayHudDragHandle: HTMLDivElement | null = null
    private hudTrayDragPointerId: number | null = null
    private hudTrayDragCaptureEl: HTMLElement | null = null
    private hudTrayDragStartX = 0
    private hudTrayDragStartY = 0
    private hudTrayDragOffsetX = 0
    private hudTrayDragOffsetY = 0
    private hudTrayDragWasDragging = false
    private hudTrayDragSuppressClickUntilMs = 0

    private readonly streamConnectionConsoleLogger = new StreamConnectionInfoConsoleLogger()

    private anchorSidebarToSettingsButton() {
        const sidebarRoot = getSidebarRoot()
        const button = this.settingsQuickButton
        if (!sidebarRoot || !button) return
        const rect = button.getBoundingClientRect()
        const targetTop = Math.round(rect.top + (rect.height / 2))
        sidebarRoot.style.left = ""
        sidebarRoot.style.bottom = ""
        sidebarRoot.style.right = "12px"
        sidebarRoot.style.top = `${targetTop}px`
    }

    private syncSettingsQuickButtonVisibility() {
        const button = this.settingsQuickButton
        if (!button) return
        if (isPhoneLikeDevice()) {
            button.style.display = "none"
            this.syncKeyboardFallbackButtonVisibility()
            return
        }
        // Keep quick arrow visible on touch/tablet devices in fullscreen so it can toggle keyboard.
        button.style.display = this.isFullscreen() ? "none" : "flex"
        // In fullscreen, keep arrow above any overlay layers so taps always reach it.
        button.style.zIndex = this.isFullscreen() ? "200000" : "200000"
        this.syncKeyboardFallbackButtonVisibility()
        this.scheduleSyncSettingsQuickButtonDock()
    }

    private scheduleSyncSettingsQuickButtonDock() {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.syncSettingsQuickButtonDockPosition()
            })
        })
        if (this.quickDockPostTransitionTimer != null) {
            clearTimeout(this.quickDockPostTransitionTimer)
            this.quickDockPostTransitionTimer = null
        }
        this.quickDockPostTransitionTimer = setTimeout(() => {
            this.quickDockPostTransitionTimer = null
            this.syncSettingsQuickButtonDockPosition()
        }, 280)
    }

    private syncSettingsQuickButtonDockPosition() {
        const button = this.settingsQuickButton
        if (!button || isPhoneLikeDevice()) return
        const root = getSidebarRoot()
        const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
        const gapPx = 16
        if (!root || !root.classList.contains("sidebar-edge-right") || !root.classList.contains("sidebar-show")) {
            this.settingsQuickButtonDockRightPx = 12
            if (button.style.display !== "none") {
                button.style.right = "12px"
            }
            return
        }
        const bg = root.querySelector(".sidebar-background") as HTMLElement | null
        const parent = document.getElementById("sidebar-parent")
        const pr = parent?.getBoundingClientRect()
        const br = bg?.getBoundingClientRect()
        const candidates: number[] = []
        if (pr && pr.width > 2) {
            candidates.push(pr.left)
        }
        if (br && br.width > 2) {
            candidates.push(br.left)
        }
        const leftEdge = candidates.length ? Math.min(...candidates) : Number.NaN
        if (!Number.isFinite(leftEdge)) {
            this.settingsQuickButtonDockRightPx = 12
            if (button.style.display !== "none") {
                button.style.right = "12px"
            }
            return
        }
        const dockRight = Math.round(Math.max(12, viewportWidth - leftEdge + gapPx))
        this.settingsQuickButtonDockRightPx = dockRight
        if (button.style.display !== "none") {
            button.style.right = `${dockRight}px`
        }
    }

    private syncKeyboardFallbackButtonVisibility() {
        const show = isPhoneLikeDevice()
        const kb = this.keyboardFallbackButton
        if (kb) {
            kb.style.display = show ? "flex" : "none"
        }
        const ctl = this.controllerFallbackButton
        if (ctl) {
            ctl.style.display = show ? "flex" : "none"
        }
    }

    private syncFullscreenToggleButtonLabel() {
        const button = this.fullscreenToggleButton
        if (!button) return
        button.textContent = this.isFullscreen() ? "⤢" : "⛶"
    }

    private ensureStatsControlsGroup() {
        if (this.statsControlsGroup) return
        const group = document.createElement("div")
        group.classList.add("video-stats-controls-group")
        document.body.appendChild(group)
        this.statsControlsGroup = group
    }

    private async toggleFullscreenFromButton() {
        if (this.isFullscreen()) {
            await this.exitFullscreen()
            return
        }
        await this.requestFullscreen()
    }

    private getOverlayHudDragEl(): HTMLDivElement | null {
        return this.overlayHudCluster ?? this.overlayHudTray
    }

    private clearBitrateApplyDismissTimer(): void {
        if (this.overlayBitrateApplyDismissTimer !== null) {
            clearTimeout(this.overlayBitrateApplyDismissTimer)
            this.overlayBitrateApplyDismissTimer = null
        }
    }

    private syncOverlayBitrateApplyButton(dirty: boolean): void {
        const btn = this.overlayBitrateApplyBtn
        if (!btn) return
        btn.hidden = !dirty
        this.clearBitrateApplyDismissTimer()
        if (!dirty) return
        this.overlayBitrateApplyDismissTimer = setTimeout(() => {
            this.overlayBitrateApplyDismissTimer = null
            this.dismissPendingOverlayBitrate()
        }, ViewerApp.BITRATE_APPLY_DISMISS_MS)
    }

    private dismissPendingOverlayBitrate(): void {
        const hud = this.realtimeBitrateHud
        if (!hud) return
        hud.revertToCommitted()
        if (this.overlayBitrateApplyBtn) {
            this.overlayBitrateApplyBtn.hidden = true
        }
    }

    private onBitrateHudPendingChange(): void {
        const hud = this.realtimeBitrateHud
        if (!hud || hud.getPendingMbps() === hud.getCommittedMbps()) return
        this.syncOverlayBitrateApplyButton(true)
    }

    private syncFullscreenToggleButtonPosition() {
        const button = this.fullscreenToggleButton
        const tray = this.getOverlayHudDragEl()
        if (!button) return
        if (!tray) {
            if (isPhoneLikeDevice()) {
                button.style.display = "none"
                return
            }
            button.style.display = "inline-flex"
            return
        }
        tray.style.position = "fixed"
        tray.style.zIndex = "70"
        tray.style.display = "flex"
        if (isPhoneLikeDevice()) {
            button.style.display = "none"
        } else {
            button.style.display = "inline-grid"
        }
        const statsVisible = !this.statsDiv.hidden && !this.statsClosed
        const topBarHeight = this.statsTopBar.getBoundingClientRect().height
        const toolbarHeight = this.overlayHudToolbar?.getBoundingClientRect().height ?? 0
        const rowHeight = statsVisible ? topBarHeight : toolbarHeight
        const targetSize = Math.round(Math.min(56, Math.max(28, rowHeight || 30)))
        if (!isPhoneLikeDevice()) {
            button.style.width = `${targetSize}px`
            button.style.minWidth = `${targetSize}px`
            button.style.maxWidth = `${targetSize}px`
            button.style.height = `${targetSize}px`
            button.style.minHeight = `${targetSize}px`
            button.style.maxHeight = `${targetSize}px`
            button.style.fontSize = `${Math.round(targetSize * 0.44)}px`
        }
        if (this.fullscreenToggleButtonDragging) {
            return
        }
        const trayWidth = tray.offsetWidth || 200
        const trayHeight = tray.offsetHeight || targetSize
        const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
        const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
        if (this.fullscreenToggleButtonManualPosition) {
            const left = Number.parseFloat(tray.style.left || "0")
            const top = Number.parseFloat(tray.style.top || "0")
            const maxLeft = Math.max(8, viewportWidth - trayWidth - 8)
            const maxTop = Math.max(8, viewportHeight - trayHeight - 8)
            const nextLeft = Math.min(Math.max(8, Number.isFinite(left) ? left : 12), maxLeft)
            const nextTop = Math.min(Math.max(8, Number.isFinite(top) ? top : 12), maxTop)
            tray.style.right = "auto"
            tray.style.left = `${Math.round(nextLeft)}px`
            tray.style.top = `${Math.round(nextTop)}px`
            return
        }
        tray.style.left = "auto"
        tray.style.top = "12px"
        tray.style.right = "12px"
    }

    private syncOverlayBitrateRangeFromSettings(): void {
        const hud = this.realtimeBitrateHud
        if (!hud) return
        const s = getSettingsForApp(this.getAppId())
        if (!s) return
        const tier = getBitrateTierForSettings(s)
        hud.setBounds(tier)
        if (Number.isFinite(s.bitrate)) {
            const snapped = snapBitrateMbpsForTier(s.bitrate, tier)
            hud.setCommitted(snapped)
        }
    }

    private async applyOverlayBitrate(mbps: number): Promise<void> {
        const hud = this.realtimeBitrateHud
        if (!hud) return
        this.clearBitrateApplyDismissTimer()
        if (this.overlayBitrateApplyBtn) {
            this.overlayBitrateApplyBtn.hidden = true
        }
        const settings = getSettingsForApp(this.getAppId())
        const tier = getBitrateTierForSettings(settings)
        const snapped = snapBitrateMbpsForTier(mbps, tier)
        settings.bitrate = snapped
        setSettingsForApp(this.getAppId(), settings)
        hud.setApplyBusy(true)
        hud.setDisabled(true)
        if (this.overlayBitrateApplyBtn) {
            this.overlayBitrateApplyBtn.disabled = true
        }
        try {
            await this.restartStreamWithNewSettings(settings)
            hud.setCommitted(snapped)
        } finally {
            hud.setApplyBusy(false)
            if (this.overlayBitrateApplyBtn) {
                this.overlayBitrateApplyBtn.disabled = false
            }
            if (this.hasConnectedOnce || this.stream != null) {
                hud.setDisabled(false)
            }
        }
    }

    /** Show/hide Quality and Stats restore controls next to the bitrate HUD. */
    private syncHudTrayToolbarButtons(): void {
        const s = getSettingsForApp(this.getAppId())
        const showBitrate = s?.showStreamBitrateHud !== false
        if (this.realtimeBitrateHud) {
            this.realtimeBitrateHud.root.style.display = showBitrate ? "" : "none"
        }
        if (this.hudTrayQualityRestoreBtn) {
            this.hudTrayQualityRestoreBtn.style.display = showBitrate ? "none" : ""
        }
        if (this.hudTrayStatsRestoreBtn) {
            const streamStats = this.getStream()?.getStats()
            this.hudTrayStatsRestoreBtn.style.display = streamStats && this.statsDiv.hidden ? "" : "none"
        }
    }

    private reopenStreamStatsFromTray(): void {
        const stats = this.getStream()?.getStats()
        if (!stats) return
        this.statsClosed = false
        this.statsDiv.hidden = false
        if (!stats.isEnabled()) {
            stats.setEnabled(true)
        }
        this.syncHudTrayToolbarButtons()
        this.syncFullscreenToggleButtonPosition()
    }

    private startHudTrayDrag(event: PointerEvent, captureEl: HTMLElement): void {
        const hudTray = this.getOverlayHudDragEl()
        if (!hudTray || event.button !== 0) return
        if (this.hudTrayDragPointerId !== null) return
        this.fullscreenToggleButtonDragging = true
        this.fullscreenToggleButtonManualPosition = true
        this.hudTrayDragPointerId = event.pointerId
        this.hudTrayDragWasDragging = false
        this.hudTrayDragCaptureEl = captureEl
        const rect = hudTray.getBoundingClientRect()
        this.hudTrayDragStartX = event.clientX
        this.hudTrayDragStartY = event.clientY
        this.hudTrayDragOffsetX = event.clientX - rect.left
        this.hudTrayDragOffsetY = event.clientY - rect.top
        hudTray.style.right = "auto"
        hudTray.style.left = `${Math.round(rect.left)}px`
        hudTray.style.top = `${Math.round(rect.top)}px`
        captureEl.setPointerCapture(event.pointerId)
        document.addEventListener("pointermove", this.onHudTrayDragPointerMove)
        document.addEventListener("pointerup", this.onHudTrayDragPointerEnd)
        document.addEventListener("pointercancel", this.onHudTrayDragPointerEnd)
    }

    private readonly onHudTrayDragPointerMove = (event: PointerEvent): void => {
        if (this.hudTrayDragPointerId === null || event.pointerId !== this.hudTrayDragPointerId) return
        const hudTray = this.getOverlayHudDragEl()
        if (!hudTray) return
        event.preventDefault()
        event.stopPropagation()
        const dx = event.clientX - this.hudTrayDragStartX
        const dy = event.clientY - this.hudTrayDragStartY
        if (
            !this.hudTrayDragWasDragging &&
            (Math.abs(dx) > ViewerApp.HUD_TRAY_DRAG_THRESHOLD_PX ||
                Math.abs(dy) > ViewerApp.HUD_TRAY_DRAG_THRESHOLD_PX)
        ) {
            this.hudTrayDragWasDragging = true
        }
        if (!this.hudTrayDragWasDragging) return
        const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
        const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
        const trayW = hudTray.offsetWidth || 200
        const trayH = hudTray.offsetHeight || 36
        const nextLeft = Math.max(8, Math.min(viewportWidth - trayW - 8, event.clientX - this.hudTrayDragOffsetX))
        const nextTop = Math.max(8, Math.min(viewportHeight - trayH - 8, event.clientY - this.hudTrayDragOffsetY))
        hudTray.style.right = "auto"
        hudTray.style.left = `${Math.round(nextLeft)}px`
        hudTray.style.top = `${Math.round(nextTop)}px`
    }

    private readonly onHudTrayDragPointerEnd = (event: PointerEvent): void => {
        if (this.hudTrayDragPointerId === null || event.pointerId !== this.hudTrayDragPointerId) return
        event.preventDefault()
        event.stopPropagation()
        const cap = this.hudTrayDragCaptureEl
        if (cap && cap.hasPointerCapture(event.pointerId)) {
            cap.releasePointerCapture(event.pointerId)
        }
        this.hudTrayDragCaptureEl = null
        this.hudTrayDragPointerId = null
        this.fullscreenToggleButtonDragging = false
        document.removeEventListener("pointermove", this.onHudTrayDragPointerMove)
        document.removeEventListener("pointerup", this.onHudTrayDragPointerEnd)
        document.removeEventListener("pointercancel", this.onHudTrayDragPointerEnd)
        if (this.hudTrayDragWasDragging) {
            this.hudTrayDragSuppressClickUntilMs = Date.now() + 500
        }
        this.hudTrayDragWasDragging = false
        this.statsDiv.classList.remove("video-stats-dragging")
    }

    private ensureFullscreenToggleButton() {
        if (this.fullscreenToggleButton) return
        this.ensureStatsControlsGroup()

        const hudCluster = document.createElement("div")
        hudCluster.classList.add("video-overlay-hud-cluster")

        const hudTray = document.createElement("div")
        hudTray.classList.add("video-overlay-hud-tray")
        const toolbar = document.createElement("div")
        toolbar.classList.add("video-overlay-hud-tray__toolbar")
        const statsSlot = document.createElement("div")
        statsSlot.classList.add("video-overlay-hud-tray__stats")

        const dragHandle = document.createElement("div")
        dragHandle.className = "video-overlay-hud-tray__drag-handle"
        dragHandle.setAttribute("aria-hidden", "true")
        dragHandle.title = "Drag overlay"
        dragHandle.addEventListener("pointerdown", (event: PointerEvent) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            this.startHudTrayDrag(event, dragHandle)
        })

        const st = getSettingsForApp(this.getAppId())
        const bitrateTier = getBitrateTierForSettings(st)
        const committedMbps = snapBitrateMbpsForTier(
            Number.isFinite(st.bitrate) ? st.bitrate : bitrateTier.defaultMbps,
            bitrateTier,
        )
        const bitrateHud = createRealtimeBitrateHud({
            minMbps: bitrateTier.minMbps,
            maxMbps: bitrateTier.maxMbps,
            defaultMbps: bitrateTier.defaultMbps,
            committedMbps,
            onPendingChange: () => this.onBitrateHudPendingChange(),
            onDirtyChange: (dirty) => this.syncOverlayBitrateApplyButton(dirty),
            onCloseRequested: () => {
                const s = getSettingsForApp(this.getAppId())
                s.showStreamBitrateHud = false
                setSettingsForApp(this.getAppId(), s)
                this.refreshStreamOverlayBitrate()
            },
        })
        bitrateHud.setDisabled(true)
        bitrateHud.root.addEventListener("pointerdown", (event: PointerEvent) => {
            if (event.button !== 0) return
            const el = event.target
            if (!(el instanceof Element)) return
            if (el.closest("button")) return
            if (el.closest('input[type="range"]') || el.closest('input[type="number"]')) return
            event.preventDefault()
            event.stopPropagation()
            this.startHudTrayDrag(event, bitrateHud.root)
        })

        const qualityBtn = document.createElement("button")
        qualityBtn.type = "button"
        qualityBtn.className = "video-overlay-hud-tray__tool-btn video-overlay-hud-tray__tool-btn--quality"
        qualityBtn.setAttribute("aria-label", "Show stream quality / bitrate control")
        qualityBtn.title = "Show bitrate control"
        qualityBtn.textContent = streamT("hud.quality")
        qualityBtn.addEventListener("click", () => {
            const s = getSettingsForApp(this.getAppId())
            s.showStreamBitrateHud = true
            setSettingsForApp(this.getAppId(), s)
            this.refreshStreamOverlayBitrate()
        })

        const statsBtn = document.createElement("button")
        statsBtn.type = "button"
        statsBtn.className = "video-overlay-hud-tray__tool-btn video-overlay-hud-tray__tool-btn--stats"
        statsBtn.setAttribute("aria-label", "Show stream stats")
        statsBtn.title = "Show stream stats"
        statsBtn.textContent = streamT("hud.stats")
        statsBtn.addEventListener("click", () => this.reopenStreamStatsFromTray())

        const button = document.createElement("button")
        button.type = "button"
        button.classList.add("video-fullscreen-toggle-btn")
        button.setAttribute("aria-label", "Toggle fullscreen")
        button.title = "Toggle fullscreen"
        button.addEventListener("pointerdown", (event: PointerEvent) => {
            event.preventDefault()
            event.stopPropagation()
            this.startHudTrayDrag(event, button)
        })
        button.addEventListener("click", () => {
            if (Date.now() < this.hudTrayDragSuppressClickUntilMs) return
            void this.toggleFullscreenFromButton()
        })

        const bitrateApplyBtn = document.createElement("button")
        bitrateApplyBtn.type = "button"
        bitrateApplyBtn.className = "video-overlay-bitrate-apply"
        bitrateApplyBtn.textContent = streamT("bitrateHud.apply")
        bitrateApplyBtn.setAttribute("aria-label", streamT("bitrateHud.aria.apply"))
        bitrateApplyBtn.title = streamT("bitrateHud.aria.apply")
        bitrateApplyBtn.hidden = true
        bitrateApplyBtn.addEventListener("click", (e) => {
            e.stopPropagation()
            const hud = this.realtimeBitrateHud
            if (!hud || bitrateApplyBtn.disabled) return
            if (hud.getPendingMbps() === hud.getCommittedMbps()) return
            void this.applyOverlayBitrate(hud.getPendingMbps())
        })
        bitrateApplyBtn.addEventListener("pointerdown", (e) => e.stopPropagation())

        toolbar.appendChild(dragHandle)
        toolbar.appendChild(bitrateHud.root)
        toolbar.appendChild(bitrateApplyBtn)
        toolbar.appendChild(statsBtn)
        toolbar.appendChild(button)
        toolbar.appendChild(qualityBtn)
        hudTray.appendChild(toolbar)
        hudTray.appendChild(statsSlot)

        hudCluster.appendChild(hudTray)

        this.statsControlsGroup?.appendChild(hudCluster)
        this.overlayHudCluster = hudCluster
        this.overlayHudTray = hudTray
        this.overlayBitrateApplyBtn = bitrateApplyBtn
        this.overlayHudToolbar = toolbar
        this.overlayHudStatsSlot = statsSlot
        this.overlayHudDragHandle = dragHandle
        this.hudTrayQualityRestoreBtn = qualityBtn
        this.hudTrayStatsRestoreBtn = statsBtn
        this.overlayBitrateRange = bitrateHud.range
        this.realtimeBitrateHud = bitrateHud
        this.fullscreenToggleButton = button
        this.syncHudTrayToolbarButtons()
        this.syncFullscreenToggleButtonLabel()
        this.syncFullscreenToggleButtonPosition()
    }

    private ensureKeyboardFallbackButton() {
        if (this.keyboardFallbackButton) return
        const button = document.createElement("button")
        button.type = "button"
        button.id = "ml-keyboard-fallback-button"
        button.setAttribute("aria-label", "Toggle keyboard")
        button.title = "Toggle keyboard"
        const keyboardIcon = document.createElement("img")
        keyboardIcon.src = "resources/nextgpu-keyboard.svg"
        keyboardIcon.alt = ""
        keyboardIcon.setAttribute("aria-hidden", "true")
        keyboardIcon.style.width = "15px"
        keyboardIcon.style.height = "15px"
        keyboardIcon.style.display = "block"
        button.appendChild(keyboardIcon)
        button.style.cssText =
            "position:fixed;right:68px;bottom:72px;z-index:210000;display:none;" +
            "width:32px;height:32px;padding:0;border-radius:8px;border:1px solid rgba(255,255,255,.78);" +
            "background:rgba(0,0,0,.92);" +
            "box-shadow:0 12px 24px rgba(0,0,0,.48),0 0 0 1px rgba(255,255,255,.08) inset;" +
            "align-items:center;justify-content:center;cursor:pointer;touch-action:none"
        const toggleKeyboard = () => {
            const screenKeyboard = this.sidebar.getScreenKeyboard()
            if (screenKeyboard.isVisible() || screenKeyboard.isActuallyVisible()) {
                screenKeyboard.hide()
            } else {
                setSidebarExtended(false)
                screenKeyboard.show()
            }
        }
        let dragPointerId: number | null = null
        let dragStartX = 0
        let dragStartY = 0
        let dragOffsetX = 0
        let dragOffsetY = 0
        let dragged = false
        let suppressClickUntilMs = 0
        const DRAG_THRESHOLD = 6
        const onDocumentPointerMove = (event: PointerEvent) => {
            if (dragPointerId == null || event.pointerId !== dragPointerId) return
            const dx = event.clientX - dragStartX
            const dy = event.clientY - dragStartY
            if (!dragged && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                dragged = true
            }
            if (!dragged) return
            const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
            const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
            const nextLeft = Math.max(8, Math.min(vw - button.offsetWidth - 8, event.clientX - dragOffsetX))
            const nextTop = Math.max(8, Math.min(vh - button.offsetHeight - 8, event.clientY - dragOffsetY))
            button.style.right = "auto"
            button.style.bottom = "auto"
            button.style.left = `${nextLeft}px`
            button.style.top = `${nextTop}px`
        }
        const onDocumentPointerEnd = (event: PointerEvent) => {
            if (dragPointerId == null || event.pointerId !== dragPointerId) return
            dragPointerId = null
            document.removeEventListener("pointermove", onDocumentPointerMove)
            document.removeEventListener("pointerup", onDocumentPointerEnd)
            document.removeEventListener("pointercancel", onDocumentPointerEnd)
            if (dragged) {
                event.preventDefault()
                event.stopImmediatePropagation()
                dragged = false
                suppressClickUntilMs = Date.now() + 500
                return
            }
            suppressClickUntilMs = Date.now() + 500
            toggleKeyboard()
        }
        button.addEventListener("pointerdown", (event: PointerEvent) => {
            dragPointerId = event.pointerId
            dragged = false
            const rect = button.getBoundingClientRect()
            dragStartX = event.clientX
            dragStartY = event.clientY
            dragOffsetX = event.clientX - rect.left
            dragOffsetY = event.clientY - rect.top
            document.addEventListener("pointermove", onDocumentPointerMove)
            document.addEventListener("pointerup", onDocumentPointerEnd)
            document.addEventListener("pointercancel", onDocumentPointerEnd)
        })
        button.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            toggleKeyboard()
        })
        button.addEventListener("click", (event: MouseEvent) => {
            if (dragged) return
            if (Date.now() < suppressClickUntilMs) return
            event.preventDefault()
            toggleKeyboard()
        })
        document.body.appendChild(button)
        this.keyboardFallbackButton = button
        this.syncKeyboardFallbackButtonVisibility()
    }

    private ensureControllerFallbackButton() {
        if (this.controllerFallbackButton) return
        const button = document.createElement("button")
        button.type = "button"
        button.id = "ml-controller-fallback-button"
        button.setAttribute("aria-label", "Toggle on-screen controller")
        button.title = "On-screen controller"
        const icon = document.createElement("img")
        icon.src = "resources/game-controller.svg"
        icon.alt = ""
        icon.setAttribute("aria-hidden", "true")
        icon.style.width = "15px"
        icon.style.height = "15px"
        icon.style.display = "block"
        icon.style.filter = "brightness(0) invert(1)"
        button.appendChild(icon)
        button.style.cssText =
            "position:fixed;right:108px;bottom:72px;z-index:210000;display:none;" +
            "width:32px;height:32px;padding:0;border-radius:8px;border:1px solid rgba(255,255,255,.78);" +
            "background:rgba(0,0,0,.92);" +
            "box-shadow:0 12px 24px rgba(0,0,0,.48),0 0 0 1px rgba(255,255,255,.08) inset;" +
            "align-items:center;justify-content:center;cursor:pointer;touch-action:none"
        const toggleController = () => {
            const vc = this.virtualControllerOverlay
            if (vc.isVisible()) {
                vc.hide()
            } else {
                setSidebarExtended(false)
                vc.show()
            }
        }
        let dragPointerId: number | null = null
        let dragStartX = 0
        let dragStartY = 0
        let dragOffsetX = 0
        let dragOffsetY = 0
        let dragged = false
        let suppressClickUntilMs = 0
        const DRAG_THRESHOLD = 6
        const onDocumentPointerMove = (event: PointerEvent) => {
            if (dragPointerId == null || event.pointerId !== dragPointerId) return
            const dx = event.clientX - dragStartX
            const dy = event.clientY - dragStartY
            if (!dragged && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                dragged = true
            }
            if (!dragged) return
            const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
            const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
            const nextLeft = Math.max(8, Math.min(vw - button.offsetWidth - 8, event.clientX - dragOffsetX))
            const nextTop = Math.max(8, Math.min(vh - button.offsetHeight - 8, event.clientY - dragOffsetY))
            button.style.right = "auto"
            button.style.bottom = "auto"
            button.style.left = `${nextLeft}px`
            button.style.top = `${nextTop}px`
        }
        const onDocumentPointerEnd = (event: PointerEvent) => {
            if (dragPointerId == null || event.pointerId !== dragPointerId) return
            dragPointerId = null
            document.removeEventListener("pointermove", onDocumentPointerMove)
            document.removeEventListener("pointerup", onDocumentPointerEnd)
            document.removeEventListener("pointercancel", onDocumentPointerEnd)
            if (dragged) {
                event.preventDefault()
                event.stopImmediatePropagation()
                dragged = false
                suppressClickUntilMs = Date.now() + 500
                return
            }
            suppressClickUntilMs = Date.now() + 500
            toggleController()
        }
        button.addEventListener("pointerdown", (event: PointerEvent) => {
            dragPointerId = event.pointerId
            dragged = false
            const rect = button.getBoundingClientRect()
            dragStartX = event.clientX
            dragStartY = event.clientY
            dragOffsetX = event.clientX - rect.left
            dragOffsetY = event.clientY - rect.top
            document.addEventListener("pointermove", onDocumentPointerMove)
            document.addEventListener("pointerup", onDocumentPointerEnd)
            document.addEventListener("pointercancel", onDocumentPointerEnd)
        })
        button.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            toggleController()
        })
        button.addEventListener("click", (event: MouseEvent) => {
            if (dragged) return
            if (Date.now() < suppressClickUntilMs) return
            event.preventDefault()
            toggleController()
        })
        document.body.appendChild(button)
        this.controllerFallbackButton = button
        this.syncKeyboardFallbackButtonVisibility()
    }

    private ensureSettingsQuickButton() {
        if (this.settingsQuickButton) return
        const button = document.createElement("button")
        button.type = "button"
        button.id = "ml-settings-quick-button"
        button.textContent = "❮"
        button.setAttribute("aria-label", "Open sidebar controls")
        button.title = "Open sidebar controls"
        button.style.cssText =
            "position:fixed;right:12px;bottom:72px;z-index:200000;" +
            "width:48px;height:48px;padding:0;border-radius:12px;border:1px solid rgba(255,255,255,.78);" +
            "background:rgba(0,0,0,.92);" +
            "color:#ffffff;font-size:28px;font-weight:800;line-height:1;" +
            "box-shadow:0 12px 24px rgba(0,0,0,.48),0 0 0 1px rgba(255,255,255,.08) inset;" +
            "display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation"
        button.addEventListener("mouseenter", () => {
            button.style.transform = "scale(1.04)"
            button.style.boxShadow = "0 14px 28px rgba(0,0,0,.52),0 0 18px rgba(255,255,255,.26)"
        })
        button.addEventListener("mouseleave", () => {
            button.style.transform = "none"
            button.style.boxShadow = "0 12px 24px rgba(0,0,0,.48),0 0 0 1px rgba(255,255,255,.08) inset"
        })
        let dragPointerId: number | null = null
        let dragStartX = 0
        let dragStartY = 0
        let dragOffsetX = 0
        let dragOffsetY = 0
        let dragged = false
        let suppressClickUntilMs = 0
        const DRAG_THRESHOLD = 6
        const toggleFromQuickButton = () => {
            if (isPhoneLikeDevice()) {
                const screenKeyboard = this.sidebar.getScreenKeyboard()
                if (screenKeyboard.isVisible() || screenKeyboard.isActuallyVisible()) {
                    screenKeyboard.hide()
                } else {
                    setSidebarExtended(false)
                    screenKeyboard.show()
                }
                return
            }
            setSidebarStyle({ edge: "right" })
            this.anchorSidebarToSettingsButton()
            if (isSidebarExtended()) {
                setSidebarExtended(false)
            } else {
                setSidebarExtended(true)
            }
            this.scheduleSyncSettingsQuickButtonDock()
        }
        const triggerToggleFromButton = () => toggleFromQuickButton()
        const onDocumentPointerMove = (event: PointerEvent) => {
            if (dragPointerId == null || event.pointerId !== dragPointerId) return
            const dx = event.clientX - dragStartX
            const dy = event.clientY - dragStartY
            if (!dragged && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                dragged = true
            }
            if (!dragged) return
            const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
            const nextTop = Math.max(8, Math.min(vh - button.offsetHeight - 8, event.clientY - dragOffsetY))
            // Constrain dragging to vertical movement on the right side only.
            button.style.left = "auto"
            button.style.bottom = "auto"
            button.style.right = `${this.settingsQuickButtonDockRightPx}px`
            button.style.top = `${nextTop}px`
        }
        const onDocumentPointerEnd = (event: PointerEvent) => {
            if (dragPointerId == null || event.pointerId !== dragPointerId) return
            dragPointerId = null
            document.removeEventListener("pointermove", onDocumentPointerMove)
            document.removeEventListener("pointerup", onDocumentPointerEnd)
            document.removeEventListener("pointercancel", onDocumentPointerEnd)
            if (dragged) {
                event.preventDefault()
                event.stopImmediatePropagation()
                dragged = false
                suppressClickUntilMs = Date.now() + 500
                this.scheduleSyncSettingsQuickButtonDock()
                return
            }
            suppressClickUntilMs = Date.now() + 500
            triggerToggleFromButton()
        }
        button.addEventListener("pointerdown", (event: PointerEvent) => {
            dragPointerId = event.pointerId
            dragged = false
            const rect = button.getBoundingClientRect()
            dragStartX = event.clientX
            dragStartY = event.clientY
            dragOffsetX = event.clientX - rect.left
            dragOffsetY = event.clientY - rect.top
            document.addEventListener("pointermove", onDocumentPointerMove)
            document.addEventListener("pointerup", onDocumentPointerEnd)
            document.addEventListener("pointercancel", onDocumentPointerEnd)
        })
        button.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            triggerToggleFromButton()
        })
        // Fallback for iPad/tablet browsers where click is emitted but pointerup can be lost.
        button.addEventListener("click", (event: MouseEvent) => {
            if (dragged) return
            if (Date.now() < suppressClickUntilMs) return
            event.preventDefault()
            triggerToggleFromButton()
        })
        document.body.appendChild(button)
        this.settingsQuickButton = button
        this.ensureKeyboardFallbackButton()
        this.ensureControllerFallbackButton()
        this.syncSettingsQuickButtonVisibility()
    }

    private adaptiveLog(message: string) {
        console.info(`[AdaptiveMouse] ${message}`)
    }

    private canAttemptFullscreen(): boolean {
        const body = document.body
        const hasRequestFullscreen = !!(
            body &&
            "requestFullscreen" in body &&
            typeof body.requestFullscreen == "function"
        )
        const fullscreenEnabled = !("fullscreenEnabled" in document) || !!document.fullscreenEnabled
        return hasRequestFullscreen && fullscreenEnabled
    }

    private canAttemptPointerLock(): boolean {
        const inputElement = document.getElementById("input") as HTMLDivElement | null
        return !!(
            inputElement &&
            "requestPointerLock" in inputElement &&
            typeof inputElement.requestPointerLock == "function"
        )
    }

    private canUseAdaptivePointerRelockOverlay(): boolean {
        return this.canAttemptPointerLock()
    }

    private activateLoadingOverlayOnce() {
        if (this.loadingShownForCurrentStart || this.startupConnectionResolved) return
        MoonlightLoadingScreen.show(streamLoadingTitle())
        this.loadingShownForCurrentStart = true
    }

    private beginStartupOverlays() {
        this.loadingShownForCurrentStart = false
        this.startupConnectionResolved = false
        this.activateLoadingOverlayOnce()
    }

    private cleanupStartupOverlaysOnAbortOrUnmount() {
        this.loadingShownForCurrentStart = false
        this.startupConnectionResolved = true
        MoonlightLoadingScreen.hide()
    }

    private ensurePointerRelockNotice() {
        if (this.pointerRelockNoticeEl) return this.pointerRelockNoticeEl
        const el = document.createElement("div")
        el.id = "ml-pointer-relock-notice"
        el.textContent = streamT("pointerLock.relock")
        el.style.position = "fixed"
        el.style.top = "50%"
        el.style.left = "50%"
        el.style.transform = "translate(-50%, 42px)"
        el.style.zIndex = "100001"
        el.style.padding = "8px 11px"
        el.style.borderRadius = "9px"
        el.style.background = "linear-gradient(135deg, rgba(74, 111, 255, 0.2), rgba(0, 200, 255, 0.14)), rgba(12, 12, 16, 0.84)"
        el.style.border = "1px solid rgba(255, 255, 255, 0.14)"
        el.style.color = "rgba(255, 255, 255, 0.94)"
        el.style.fontSize = "11px"
        el.style.fontWeight = "600"
        el.style.letterSpacing = "0.03em"
        el.style.textTransform = "uppercase"
        el.style.pointerEvents = "none"
        el.style.boxShadow = "0 2px 12px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.05)"
        el.style.display = "none"
        document.body.appendChild(el)
        this.pointerRelockNoticeEl = el
        return el
    }

    private showPointerRelockNotice() {}

    private hidePointerRelockNotice() {}

    private showAdaptivePointerRelockOverlay() {
        if (!this.canUseAdaptivePointerRelockOverlay()) {
            this.adaptiveLog("skip esc relock overlay: pointer lock unsupported")
            return
        }
        if (!this.pendingEscRelockPrompt || !this.latestHostCursorHidden) {
            this.adaptiveLog(
                `skip esc relock overlay: pendingEscRelockPrompt=${this.pendingEscRelockPrompt} latestHostCursorHidden=${this.latestHostCursorHidden}`
            )
            return
        }
        getSidebarRoot()?.classList.add("sidebar-esc-relock-priority")
        this.adaptiveLog("show esc relock overlay")
        MoonlightPointerLockOverlay.show(() => {
            void this.attemptAdaptivePointerRelock("overlay-esc", false)
        }, () => {
            this.pendingEscRelockPrompt = false
            this.hidePointerRelockNotice()
            this.adaptiveLog("esc relock overlay dismissed by user")
        })
    }

    private hideAdaptivePointerRelockOverlay() {
        this.adaptiveLog("hide esc relock overlay")
        getSidebarRoot()?.classList.remove("sidebar-esc-relock-priority")
        MoonlightPointerLockOverlay.hide()
    }

    private async attemptAdaptivePointerRelock(trigger: "overlay-esc" | "click", withFullscreen = false) {
        this.adaptiveLog(`attempt pointer relock from ${trigger}`)
        try {
            if (withFullscreen && !this.isFullscreen()) {
                await this.requestFullscreen()
            }
            await this.requestPointerLock()
            this.adaptivePointerLockArmed = false
            this.adaptivePointerLockActive = true
            this.pendingEscRelockPrompt = false
            this.hideAdaptivePointerRelockOverlay()
            this.hidePointerRelockNotice()
            this.adaptiveLog("pointer lock acquired via adaptive relock path")
        } catch (error) {
            console.debug("failed to request pointer lock in adaptive relock path", error)
            this.adaptivePointerLockArmed = this.latestHostCursorHidden
            if (this.adaptivePointerLockArmed && this.pendingEscRelockPrompt) {
                this.showAdaptivePointerRelockOverlay()
            }
            this.adaptiveLog(`pointer lock request failed in adaptive relock path: ${String(error)}`)
        }
    }

    private canRelockFromGesture(): boolean {
        return (
            this.adaptivePointerLockArmed &&
            this.getInputConfig().mouseMode !== "relative" &&
            this.getInputConfig().mouseMode !== "pointAndDrag" &&
            !document.pointerLockElement
        )
    }

    private tryAdaptivePointerRelockFromGesture(trigger: "click"): boolean {
        if (!this.canRelockFromGesture()) return false
        this.adaptiveLog(`${trigger} with armed auto-lock -> requestPointerLock() (mouseMode=${this.getInputConfig().mouseMode})`)
        void this.attemptAdaptivePointerRelock(trigger)
        return true
    }

    constructor(api: Api, hostId: number, appId: number) {
        this.api = api
        this.hostId = hostId
        this.appId = appId

        // Configure sidebar
        this.sidebar = new ViewerSidebar(this)
        this.virtualControllerOverlay = new VirtualControllerOverlay({
            getStreamInput: () => this.getStream()?.getInput() ?? null,
            getScreenKeyboard: () => this.sidebar.getScreenKeyboard(),
        })
        setSidebar(this.sidebar)
        this.ensureSettingsQuickButton()
        window.addEventListener("resize", this.windowResizeForQuickDock)
        getSidebarRoot()?.addEventListener("transitionend", this.sidebarBackgroundTransitionDock)

        // Configure stats element
        this.ensureStatsControlsGroup()
        this.statsDiv.hidden = true
        this.statsDiv.classList.add("video-stats")
        this.ensureFullscreenToggleButton()
        this.statsMinimized = localStorage.getItem("streamStatsMinimized") === "1"
        this.statsTopBar.classList.add("video-stats-topbar")
        this.statsTopBar.addEventListener("pointerdown", this.onStatsTopBarPointerDownForTrayDrag)
        this.statsTitleDiv.classList.add("video-stats-title")
        this.statsTitleDiv.textContent = streamT("stats.title")
        this.statsActionsDiv.classList.add("video-stats-actions")
        this.statsMinimizeButton.classList.add("video-stats-action-btn")
        this.statsMinimizeButton.type = "button"
        this.statsMinimizeButton.addEventListener("click", () => {
            this.statsMinimized = !this.statsMinimized
            localStorage.setItem("streamStatsMinimized", this.statsMinimized ? "1" : "0")
        })
        this.statsCloseButton.classList.add("video-stats-action-btn")
        this.statsCloseButton.type = "button"
        this.statsCloseButton.textContent = "×"
        this.statsCloseButton.addEventListener("click", () => {
            this.statsClosed = true
            this.statsDiv.hidden = true
            this.getStream()?.getStats().setEnabled(false)
            this.syncHudTrayToolbarButtons()
            this.syncFullscreenToggleButtonPosition()
        })
        this.statsSummaryDiv.classList.add("video-stats-summary")
        this.statsDetailsDiv.classList.add("video-stats-details")
        this.statsTopBar.appendChild(this.statsTitleDiv)
        this.statsActionsDiv.appendChild(this.statsMinimizeButton)
        this.statsActionsDiv.appendChild(this.statsCloseButton)
        this.statsTopBar.appendChild(this.statsActionsDiv)
        this.statsDiv.appendChild(this.statsTopBar)
        this.statsDiv.appendChild(this.statsSummaryDiv)
        this.statsDetailsDiv.classList.add("video-stats-details")
        this.statsDiv.appendChild(this.statsDetailsDiv)
        if (this.overlayHudStatsSlot) {
            this.overlayHudStatsSlot.appendChild(this.statsDiv)
        } else {
            this.statsControlsGroup?.appendChild(this.statsDiv)
        }
        if (this.overlayHudCluster) {
            this.statsControlsGroup?.appendChild(this.overlayHudCluster)
        } else if (this.overlayHudTray) {
            this.statsControlsGroup?.appendChild(this.overlayHudTray)
        } else if (this.fullscreenToggleButton) {
            this.statsControlsGroup?.appendChild(this.fullscreenToggleButton)
        }

        this.statsUpdateInterval = setInterval(() => {
            const stats = this.getStream()?.getStats()
            if (stats && stats.isEnabled() && !this.statsClosed) {
                this.statsDiv.hidden = false
                const statsData = stats.getCurrentStats()
                this.renderStatsOverlay(statsData)
            } else {
                this.statsDiv.hidden = true
                this.lastIceBytesReceived = null
                this.lastIceBytesTsMs = null
                this.lastBitrateMbps = null
            }
            this.syncHudTrayToolbarButtons()
            this.syncFullscreenToggleButtonPosition()
        }, 500)

        this.recoveryOverlay = new StreamRecoveryOverlay(
            () => { void this.retryAfterConnectionIssue() },
            () => this.openSettingsModal(),
            () => { void this.exitToLibrary() },
        )

        this.createFullscreenExitCircle()
        this.createFileTransferProgressCircle()

        if (shouldAttachDevConnectionLog()) {
            this.devConnectionLog = new DevStreamConnectionLog()
            const syncDevLogVisibility = () => {
                this.devConnectionLog?.applyDesiredVisibility(computeDevConnectionLogPanelVisible())
            }
            this.devConnectionLogPoll = window.setInterval(syncDevLogVisibility, 500)
            syncDevLogVisibility()
        }

        // Configure stream (per-app: from localStorage or app_settings.json)
        const settings = getSettingsForApp(appId)

        let browserWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
        let browserHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)

        this.previousMouseMode = this.inputConfig.mouseMode
        this.toggleFullscreenWithKeybind = settings.toggleFullscreenWithKeybind
        this.startStream(hostId, appId, settings, [browserWidth, browserHeight])

        this.settings = settings

        // Configure input
        this.addListeners(document)
        this.addListeners(document.getElementById("input") as HTMLDivElement)

        window.addEventListener("blur", () => {
            this.releaseAllKeys("window blur")
        })
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState !== "visible") {
                this.releaseAllKeys("document hidden")
            }
        })
        window.addEventListener("ml-modal-visibility", () => {
            this.releaseAllKeys("modal visibility changed")
        })
        window.addEventListener("ml-sidebar-extended-change", () => {
            this.releaseAllKeys("sidebar expanded or collapsed")
            this.scheduleSyncSettingsQuickButtonDock()
        })

        document.addEventListener("pointerlockchange", this.onPointerLockChange.bind(this))
        document.addEventListener("fullscreenchange", this.onFullscreenChange.bind(this))

        this.keyWatchdogInterval = window.setInterval(() => {
            const stream = this.stream
            const isInputFocused = this.isStreamInputFocused()
            const modalBackground = getModalBackground()
            const modalActive = modalBackground ? !modalBackground.classList.contains("modal-disabled") : false
            const sidebarExpanded = !!getSidebarRoot()?.classList.contains("sidebar-show")
            const pointerLockLost = this.getInputConfig().mouseMode === "relative" && !document.pointerLockElement
            const shouldForceRelease = !isInputFocused || modalActive || sidebarExpanded || pointerLockLost
            stream?.getInput().watchdogTick(shouldForceRelease)
        }, ViewerApp.KEY_WATCHDOG_INTERVAL_MS)

        window.addEventListener("gamepadconnected", this.onGamepadConnect.bind(this))
        window.addEventListener("gamepaddisconnected", this.onGamepadDisconnect.bind(this))
        // Connect all gamepads
        for (const gamepad of navigator.getGamepads()) {
            if (gamepad != null) {
                this.onGamepadAdd(gamepad)
            }
        }
    }
    private addListeners(element: GlobalEventHandlers) {
        element.addEventListener("keydown", this.onKeyDown.bind(this), { passive: false })
        element.addEventListener("keyup", this.onKeyUp.bind(this), { passive: false })
        element.addEventListener("paste", this.onPaste.bind(this))

        element.addEventListener("mousedown", this.onMouseButtonDown.bind(this), { passive: false })
        element.addEventListener("mouseup", this.onMouseButtonUp.bind(this), { passive: false })
        element.addEventListener("mousemove", this.onMouseMove.bind(this), { passive: false })
        element.addEventListener("wheel", this.onMouseWheel.bind(this), { passive: false })
        element.addEventListener("contextmenu", this.onContextMenu.bind(this), { passive: false })

        element.addEventListener("touchstart", this.onTouchStart.bind(this), { passive: false })
        element.addEventListener("touchend", this.onTouchEnd.bind(this), { passive: false })
        element.addEventListener("touchcancel", this.onTouchCancel.bind(this), { passive: false })
        element.addEventListener("touchmove", this.onTouchMove.bind(this), { passive: false })
    }

    private async startStream(hostId: number, appId: number, settings: Settings, browserSize: [number, number]) {
        // Anchor sidebar/icon to the right edge by default.
        setSidebarStyle({
            edge: "right",
        })

        this.beginStartupOverlays()
        this.recoveryOverlay.hide()
        this.recoveryShown = false
        this.latestConnectionState = "Connecting"
        this.hasConnectedOnce = false

        this.stream = new Stream(this.api, hostId, appId, settings, browserSize)
        // Apply viewer input config immediately (phone default touch mode, persisted modes, etc.)
        // so users don't need to manually reselect modes in the sidebar.
        this.stream.getInput().setConfig(this.inputConfig)

        // Add app info listener
        this.stream.addInfoListener(this.onInfo.bind(this))
        this.stream.addInfoListener(this.streamConnectionConsoleLogger.onInfo.bind(this.streamConnectionConsoleLogger))
        if (this.devConnectionLog) {
            this.stream.addInfoListener(this.devConnectionLog.onInfo.bind(this.devConnectionLog))
        }

        // Start animation frame loop
        this.onTouchUpdate()
        this.onGamepadUpdate()

        this.stream.getInput().addScreenKeyboardVisibleEvent(this.onScreenKeyboardSetVisible.bind(this))

        this.stream.mount(this.div)
        this.moveSidebarRootIntoStreamLayer()
    }

    private openSettingsModal() {
        this.recoveryOverlay.hide()
        this.recoveryShown = false
        showModal(new SettingsPanelModal(this))
    }

    private async retryAfterConnectionIssue() {
        if (!this.recoveryShown) return
        this.recoveryOverlay.setBusy(true)
        window.location.reload()
    }

    async exitToLibrary() {
        const stream = this.stream
        if (stream) {
            const success = await stream.stop()
            if (!success) console.debug("Failed to close stream correctly")
        }
        window.close()
    }

    private showConnectionRecovery(message: string) {
        if (this.recoveryShown) return
        this.recoveryShown = true
        this.startupConnectionResolved = true
        this.cleanupStartupOverlaysOnAbortOrUnmount()
        MoonlightLoadingScreen.hide()
        this.recoveryOverlay.show(message)
    }

    getAppId(): number {
        return this.appId
    }
    getHostId(): number {
        return this.hostId
    }

    /** Graceful restart: stop current stream, then start again with new settings (no page refresh). */
    async restartStreamWithNewSettings(settings: Settings): Promise<void> {
        const stream = this.stream
        if (stream) {
            this.releaseAllKeys("before stream restart")
            this.adaptivePointerLockArmed = false
            this.adaptivePointerLockActive = false
            this.latestHostCursorHidden = false
            this.pendingEscRelockPrompt = false
            this.cleanupStartupOverlaysOnAbortOrUnmount()
            this.hideAdaptivePointerRelockOverlay()
            this.hidePointerRelockNotice()
            if (this.adaptivePointerLockReleaseTimer != null) {
                clearTimeout(this.adaptivePointerLockReleaseTimer)
                this.adaptivePointerLockReleaseTimer = null
            }
            this.adaptiveLog("reset adaptive mouse state (stream restart)")
            const success = await stream.stop()
            if (!success) {
                console.debug("Restart: stream stop reported failure, continuing anyway")
            }
            stream.unmount(this.div)
            this.stream = null
        }
        this.settings = settings
        const browserWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
        const browserHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
        await this.startStream(this.hostId, this.appId, settings, [browserWidth, browserHeight])
    }

    private async onInfo(event: InfoEvent) {
        const data = event.detail

        if (data.type == "app") {
            applyStreamDocumentTitle()
        } else if (data.type == "connectionComplete") {
            this.latestConnectionState = "Connected"
            this.hasConnectedOnce = true
            this.startupConnectionResolved = true
            this.sidebar.onCapabilitiesChange(data.capabilities)
            this.virtualControllerOverlay.onStreamConnected()
            MoonlightLoadingScreen.hide()
            this.recoveryOverlay.hide()
            this.recoveryShown = false
        } else if (data.type === "generalChannelReady") {
            this.enableRealtimeBitrateHud()
        } else if (data.type == "hostCursorHidden") {
            this.latestHostCursorHidden = data.hidden
            if (data.hidden) {
                if (this.adaptivePointerLockReleaseTimer != null) {
                    clearTimeout(this.adaptivePointerLockReleaseTimer)
                    this.adaptivePointerLockReleaseTimer = null
                    this.adaptiveLog("cancel debounced pointer lock release (host cursor hidden again)")
                }
                this.adaptivePointerLockArmed = true
                if (!document.pointerLockElement) {
                    this.showPointerRelockNotice()
                }
                this.adaptiveLog("host cursor hidden -> arm pointer lock on next click")
            } else {
                this.adaptivePointerLockArmed = false
                this.pendingEscRelockPrompt = false
                this.hideAdaptivePointerRelockOverlay()
                this.hidePointerRelockNotice()
                this.adaptiveLog("host cursor visible -> disarm pointer lock auto-capture")

                if (this.adaptivePointerLockActive && document.pointerLockElement) {
                    if (this.adaptivePointerLockReleaseTimer != null) {
                        clearTimeout(this.adaptivePointerLockReleaseTimer)
                    }
                    this.adaptiveLog("schedule debounced pointer lock release (250ms)")
                    this.adaptivePointerLockReleaseTimer = setTimeout(() => {
                        this.adaptivePointerLockReleaseTimer = null
                        if (!this.adaptivePointerLockActive) {
                            this.adaptiveLog("debounced release skipped (auto pointer lock no longer active)")
                            return
                        }
                        this.adaptiveLog("debounced release firing -> exitPointerLock()")
                        void this.exitPointerLock()
                        this.adaptivePointerLockActive = false
                    }, 250)
                } else {
                    this.adaptivePointerLockActive = false
                    this.adaptiveLog("visible host cursor, no auto pointer lock active")
                }
            }
        } else if (data.type == "addDebugLine") {
            const message = data.line.trim()
            const isTerminalFatal =
                streamLogStartsWith(message, "log.connectionTerminated") ||
                message.startsWith("ConnectionTerminated") ||
                message.includes("transport closed (failed)") ||
                message.includes("transport closed (disconnect)")
            if (
                message &&
                data.additional &&
                (data.additional.type === "fatal" || data.additional.type === "fatalDescription")
            ) {
                if (!this.hasConnectedOnce || isTerminalFatal) {
                    showErrorPopup(message)
                    this.latestConnectionState = "Failed"
                    this.showConnectionRecovery(streamT("recovery.streamFailed"))
                    if (this.realtimeBitrateHud) {
                        this.realtimeBitrateHud.setDisabled(true)
                    }
                }
            } else if (data.additional?.type === "informError") {
                const line = data.line
                if (line.includes(MOONLIGHT_BITRATE_LOG_PREFIX)) {
                    console.warn(line)
                } else {
                    showErrorPopup(line)
                }
            } else if (
                streamLogMatches(message, "log.wsClosed") ||
                streamLogMatches(message, "log.wsOrWebrtcError")
            ) {
                if (!this.hasConnectedOnce) {
                    this.latestConnectionState = "Disconnected"
                    this.showConnectionRecovery(streamT("recovery.connectionLost"))
                }
                if (this.realtimeBitrateHud) {
                    this.realtimeBitrateHud.setDisabled(true)
                }
            }
        } else if (data.type == "serverMessage") {
            MoonlightLoadingScreen.setSubtitle(streamT("modal.serverPrefix", { message: data.message }))
        } else if (data.type == "connectionStatus") {
            const statusText = String(data.status).toLowerCase()
            this.latestConnectionState = String(data.status)
            const shouldShowRecovery =
                statusText.includes("terminated") ||
                statusText.includes("failed") ||
                (!this.hasConnectedOnce && statusText.includes("disconnected"))
            if (shouldShowRecovery) {
                if (this.hasConnectedOnce && this.realtimeBitrateHud) {
                    this.realtimeBitrateHud.setDisabled(true)
                }
                this.showConnectionRecovery(streamT("recovery.disconnected"))
            }
        } else if (data.type == "fileTransferProgress") {
            this.updateFileTransferProgressCircle(data.percent, data.loaded, data.total, data.source)
        } else if (data.type == "fileTransferProgressEnd") {
            this.hideFileTransferProgressCircleImmediate()
        } else if (data.type === "bitrateRequestApplied") {
            if (data.source === "overlaySlider" || data.source === "preset") {
                this.showBitrateSentMiniToast(data.mbps, data.source)
            }
        } else if (data.type === "bitrateHostApplied") {
            if (this.shouldShowBitrateHudToast(data.source)) {
                this.showBitrateHostAppliedMiniToast(data.mbps)
            }
        } else if (data.type === "bitrateHostRejected") {
            if (this.shouldShowBitrateHudToast(data.source)) {
                this.showBitrateHostRejectedMiniToast(data.mbps, data.reason)
            }
        }
    }

    private shouldShowBitrateHudToast(source: "overlaySlider" | "preset" | "settings" | "slider" | undefined): boolean {
        return source === "overlaySlider" || source === "preset" || source === undefined
    }

    private enableRealtimeBitrateHud(): void {
        if (this.realtimeBitrateHud) {
            this.syncOverlayBitrateRangeFromSettings()
            this.realtimeBitrateHud.setDisabled(false)
        }
    }

    private focusInput() {
        if (this.stream?.getInput().getCurrentPredictedTouchAction() != "screenKeyboard" && !this.sidebar.getScreenKeyboard().isVisible()) {
            const inputElement = document.getElementById("input") as HTMLDivElement
            inputElement.focus()
        }
    }

    onUserInteraction() {
        this.focusInput()
        this.notifyStreamInteraction()
    }

    private notifyStreamInteraction() {
        this.stream?.getVideoRenderer()?.onUserInteraction()
        this.stream?.getAudioPlayer()?.onUserInteraction()
    }

    private releaseAllKeys(reason: string) {
        console.debug(`[Keyboard]: Reset all keys (${reason})`)
        this.stream?.getInput().onInputContextLost()
    }
    resetKeysForLifecycle(reason: string) {
        this.releaseAllKeys(reason)
    }

    private isStreamInputFocused(): boolean {
        const inputElement = document.getElementById("input") as HTMLDivElement | null
        return !!inputElement && document.activeElement === inputElement
    }

    private isOverlayTextInputFocused(): boolean {
        const active = document.activeElement
        return active instanceof HTMLInputElement && active.classList.contains("ml-rt-bitrate__value-input")
    }

    private shouldForwardKeyboardEvent(): boolean {
        return this.isStreamInputFocused()
    }

    private addConsumedShortcutSuppressions(event: KeyboardEvent, consumedCode: string) {
        this.skipNextHostKeyUpCodes.add(consumedCode)
        if (event.ctrlKey) {
            this.skipNextHostKeyUpCodes.add("ControlLeft")
            this.skipNextHostKeyUpCodes.add("ControlRight")
        }
        if (event.shiftKey) {
            this.skipNextHostKeyUpCodes.add("ShiftLeft")
            this.skipNextHostKeyUpCodes.add("ShiftRight")
        }
        if (event.altKey) {
            this.skipNextHostKeyUpCodes.add("AltLeft")
            this.skipNextHostKeyUpCodes.add("AltRight")
        }
        if (event.metaKey) {
            this.skipNextHostKeyUpCodes.add("MetaLeft")
            this.skipNextHostKeyUpCodes.add("MetaRight")
        }
    }
    private onScreenKeyboardSetVisible(event: ScreenKeyboardSetVisibleEvent) {
        console.info(event.detail)
        const screenKeyboard = this.sidebar.getScreenKeyboard()

        const newShown = event.detail.visible
        if (newShown != screenKeyboard.isVisible()) {
            if (newShown) {
                screenKeyboard.show()
            } else {
                screenKeyboard.hide()
            }
        }
    }

    // Input
    getInputConfig(): StreamInputConfig {
        return this.inputConfig
    }
    setInputConfig(config: StreamInputConfig) {
        const prevMouse = this.inputConfig.mouseMode
        const prevTouch = this.inputConfig.touchMode
        Object.assign(this.inputConfig, config)

        this.stream?.getInput().setConfig(this.inputConfig)

        if (this.inputConfig.mouseMode !== prevMouse || this.inputConfig.touchMode !== prevTouch) {
            try {
                localStorage.setItem(
                    ML_STREAM_INPUT_MODES_KEY,
                    JSON.stringify({
                        mouseMode: this.inputConfig.mouseMode,
                        touchMode: this.inputConfig.touchMode,
                    })
                )
            } catch {
                /* quota / private mode */
            }
        }
    }

    // Keyboard
    onKeyDown(event: KeyboardEvent) {
        this.notifyStreamInteraction()

        if (this.isOverlayTextInputFocused()) {
            return
        }

        console.debug(event)
        if (event.code === "Escape" && !!document.pointerLockElement) {
            this.pendingEscRelockPrompt = true
            this.adaptiveLog("esc down while pointer locked -> arm esc relock prompt")
        }
        if (event.code === "Escape" && this.isFullscreen()) {
            this.startFullscreenExitEscHold()
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyC") {
            if (this.isFileTransferProgressVisible() && this.fileTransferLastStatus) {
                event.preventDefault()
                event.stopPropagation()
                this.addConsumedShortcutSuppressions(event, "KeyC")
                this.releaseAllKeys("consumed Ctrl/Cmd+Shift+C shortcut")
                void navigator.clipboard.writeText(this.fileTransferLastStatus).catch((e) => {
                    console.warn("[Stream]: could not copy transfer status", e)
                })
                return
            }
        }

        // Ctrl/Cmd+Shift+V: read clipboard and send text to host (Ctrl/Cmd+V is forwarded as normal keys).
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyV") {
            if (!this.shouldForwardKeyboardEvent()) {
                this.releaseAllKeys("Ctrl/Cmd+Shift+V blocked because stream input is not focused")
                event.preventDefault()
                event.stopPropagation()
                return
            }
            event.preventDefault()
            event.stopPropagation()
            this.addConsumedShortcutSuppressions(event, "KeyV")
            this.releaseAllKeys("consumed Ctrl/Cmd+Shift+V paste shortcut")
            const input = this.stream?.getInput()
            if (input?.isConnected()) {
                void navigator.clipboard.readText().then((text) => {
                    if (text) {
                        input.pastePlainText(text)
                    }
                }).catch((e) => {
                    console.warn("[Stream]: clipboard read failed (Ctrl/Cmd+Shift+V)", e)
                })
            }
            return
        } else if (event.code == "F11") {
            // Allow manual fullscreen
        } else {
            if (!this.shouldForwardKeyboardEvent()) {
                this.releaseAllKeys("keydown blocked because stream input is not focused")
                event.preventDefault()
                event.stopPropagation()
                return
            }
            event.preventDefault()
            this.stream?.getInput().onKeyDown(event)
        }

        event.stopPropagation()
    }

    private isTogglingFullscreenWithKeybind: "waitForCtrl" | "makingFullscreen" | "none" = "none"
    onKeyUp(event: KeyboardEvent) {
        this.notifyStreamInteraction()

        if (this.isOverlayTextInputFocused()) {
            return
        }

        if (event.code === "Escape") {
            this.cancelFullscreenExitEscHold()
        }

        if (this.skipNextHostKeyUpCodes.has(event.code)) {
            this.skipNextHostKeyUpCodes.delete(event.code)
            event.preventDefault()
        } else {
            if (!this.shouldForwardKeyboardEvent()) {
                this.releaseAllKeys("keyup blocked because stream input is not focused")
                event.preventDefault()
                event.stopPropagation()
                return
            }
            event.preventDefault()
            this.stream?.getInput().onKeyUp(event)
        }
        event.stopPropagation()

        if (this.toggleFullscreenWithKeybind && this.isTogglingFullscreenWithKeybind == "none" && event.ctrlKey && event.shiftKey && event.code == "KeyI") {
            this.isTogglingFullscreenWithKeybind = "waitForCtrl"
        }
        if (this.isTogglingFullscreenWithKeybind == "waitForCtrl" && (event.code == "ControlRight" || event.code == "ControlLeft")) {
            this.isTogglingFullscreenWithKeybind = "makingFullscreen";

            (async () => {
                if (this.isFullscreen()) {
                    await this.exitPointerLock()
                    await this.exitFullscreen()
                } else {
                    await this.requestFullscreen()
                    await this.requestPointerLock()
                }

                this.isTogglingFullscreenWithKeybind = "none"
            })()
        }
    }

    onPaste(event: ClipboardEvent) {
        this.onUserInteraction()

        const files = event.clipboardData?.files
        const input = this.stream?.getInput()

        // Copied files from Explorer (etc.): upload like drag-and-drop to the configured host folder.
        if (files && files.length > 0 && input?.isConnected()) {
            event.preventDefault()
            void (async () => {
                const s = this.stream!
                for (let i = 0; i < files.length; i++) {
                    try {
                        await s.uploadFileToHost(files[i]!)
                    } catch (e) {
                        console.warn("[Stream]: paste file upload failed", e)
                    }
                }
            })()
            event.stopPropagation()
            return
        }

        // Text (usernames, passwords, etc.) goes through the keyboard channel into the focused host app.
        input?.onPaste(event)

        event.stopPropagation()
    }

    /**
     * Stream input hooks on `document` must not swallow touches/clicks aimed at browser UI.
     * In particular, the select polyfill teleports `.select-polyfill-list` to `body`; without this,
     * `preventDefault` on touchstart blocks click synthesis and options cannot be chosen on phones.
     */
    private isStreamInputUiTarget(target: EventTarget | null): boolean {
        const targetElement = target instanceof Element
            ? target
            : target instanceof Node
                ? target.parentElement
                : null
        if (!targetElement) return false
        if (targetElement.closest(".ml-virtual-controller")) return true
        if (targetElement.closest(".ml-rt-bitrate")) return true
        if (targetElement.closest(".video-overlay-hud-tray")) return true
        if (targetElement.closest(".video-overlay-hud-cluster")) return true
        if (targetElement.closest(".video-overlay-bitrate-apply")) return true
        if (targetElement.closest(".video-fullscreen-toggle-btn")) return true
        if (targetElement.closest(".modal-video-connect")) return true
        if (targetElement.closest(".modal-settings-panel")) return true
        if (targetElement.closest("#sidebar-button")) return true
        if (targetElement.closest("#ml-settings-quick-button")) return true
        if (targetElement.closest("#ml-keyboard-fallback-button")) return true
        if (targetElement.closest(".select-polyfill-list, .select-polyfill-display, .select-polyfill-wrapper")) {
            return true
        }
        if (targetElement.closest("button, input, select, textarea, label, a, [role='button'], [role='slider'], [contenteditable='true']")) {
            return true
        }
        if (targetElement.closest("#mlplo-overlay")) return true
        if (targetElement.closest(".sidebar-stream")) return true
        const modal = getModalBackground()
        if (modal && !modal.classList.contains("modal-disabled") && modal.contains(targetElement)) return true
        return false
    }

    // Mouse
    onMouseButtonDown(event: MouseEvent) {
        if (this.isStreamInputUiTarget(event.target)) return
        this.onUserInteraction()

        if (this.tryAdaptivePointerRelockFromGesture("click")) {
            event.preventDefault()
            event.stopPropagation()
            return
        }

        event.preventDefault()
        this.stream?.getInput().onMouseDown(event, this.getStreamRect());

        event.stopPropagation()
    }
    onMouseButtonUp(event: MouseEvent) {
        if (this.isStreamInputUiTarget(event.target)) return
        this.onUserInteraction()

        event.preventDefault()
        this.stream?.getInput().onMouseUp(event)

        event.stopPropagation()
    }
    onMouseMove(event: MouseEvent) {
        if (this.isStreamInputUiTarget(event.target)) return
        event.preventDefault()
        this.stream?.getInput().onMouseMove(event, this.getStreamRect())

        event.stopPropagation()
    }
    onMouseWheel(event: WheelEvent) {
        event.preventDefault()
        this.stream?.getInput().onMouseWheel(event)

        event.stopPropagation()
    }
    onContextMenu(event: MouseEvent) {
        event.preventDefault()

        event.stopPropagation()
    }

    // Touch
    onTouchStart(event: TouchEvent) {
        if (this.isStreamInputUiTarget(event.target)) return
        this.onUserInteraction()
        event.preventDefault()
        this.stream?.getInput().onTouchStart(event, this.getStreamRect())

        event.stopPropagation()
    }
    onTouchEnd(event: TouchEvent) {
        if (this.isStreamInputUiTarget(event.target)) return
        this.onUserInteraction()

        event.preventDefault()
        this.stream?.getInput().onTouchEnd(event, this.getStreamRect())

        event.stopPropagation()
    }
    onTouchCancel(event: TouchEvent) {
        if (this.isStreamInputUiTarget(event.target)) return
        this.onUserInteraction()

        event?.preventDefault()
        this.stream?.getInput().onTouchCancel(event, this.getStreamRect())

        event.stopPropagation()
    }
    onTouchUpdate() {
        this.stream?.getInput().onTouchUpdate(this.getStreamRect())
        this.updateSidebarAnchorToStreamRect()

        window.requestAnimationFrame(this.onTouchUpdate.bind(this))
    }
    onTouchMove(event: TouchEvent) {
        if (this.isStreamInputUiTarget(event.target)) return

        event.preventDefault()
        this.stream?.getInput().onTouchMove(event, this.getStreamRect())

        event.stopPropagation()
    }

    // Gamepad
    onGamepadConnect(event: GamepadEvent) {
        this.onGamepadAdd(event.gamepad)
    }
    onGamepadAdd(gamepad: Gamepad) {
        this.stream?.getInput().onGamepadConnect(gamepad)
    }
    onGamepadDisconnect(event: GamepadEvent) {
        this.stream?.getInput().onGamepadDisconnect(event)
    }
    onGamepadUpdate() {
        this.stream?.getInput().onGamepadUpdate()

        window.requestAnimationFrame(this.onGamepadUpdate.bind(this))
    }

    // Fullscreen
    private createFullscreenExitCircle() {
        const body = document.body
        if (!body) return

        const SIZE = 48
        const RADIUS = 18
        const CIRCUMFERENCE = 2 * Math.PI * RADIUS

        const wrapper = document.createElement("div")
        wrapper.style.position = "fixed"
        wrapper.style.top = "12px"
        wrapper.style.right = "12px"
        wrapper.style.width = `${SIZE}px`
        wrapper.style.height = `${SIZE}px`
        wrapper.style.zIndex = "10000"
        wrapper.style.display = "none"
        wrapper.style.cursor = "default"
        wrapper.style.borderRadius = "50%"
        wrapper.style.backdropFilter = "blur(8px)"
        wrapper.style.setProperty("-webkit-backdrop-filter", "blur(8px)")
        wrapper.style.background = "rgba(20, 20, 22, 0.75)"
        wrapper.style.boxShadow = "0 2px 12px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.08)"

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
        svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`)
        svg.setAttribute("width", `${SIZE}`)
        svg.setAttribute("height", `${SIZE}`)
        svg.style.position = "absolute"
        svg.style.top = "0"
        svg.style.left = "0"

        const borderCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
        borderCircle.setAttribute("cx", "24")
        borderCircle.setAttribute("cy", "24")
        borderCircle.setAttribute("r", `${RADIUS}`)
        borderCircle.setAttribute("fill", "none")
        borderCircle.setAttribute("stroke", "rgba(255,255,255,0.08)")
        borderCircle.setAttribute("stroke-width", "3")

        const arc = document.createElementNS("http://www.w3.org/2000/svg", "circle")
        arc.setAttribute("cx", "24")
        arc.setAttribute("cy", "24")
        arc.setAttribute("r", `${RADIUS}`)
        arc.setAttribute("fill", "none")
        arc.setAttribute("stroke", "rgba(255,255,255,0.85)")
        arc.setAttribute("stroke-width", "3")
        arc.setAttribute("stroke-dasharray", `${CIRCUMFERENCE}`)
        arc.setAttribute("stroke-dashoffset", `${CIRCUMFERENCE}`)
        arc.setAttribute("stroke-linecap", "round")
        arc.setAttribute("transform", "rotate(-90 24 24)")

        svg.appendChild(borderCircle)
        svg.appendChild(arc)

        const logoImg = document.createElement("img")
        logoImg.src = "./resources/sidebar-button-icon.png"
        logoImg.alt = "Moonlight"
        logoImg.style.position = "absolute"
        logoImg.style.top = "50%"
        logoImg.style.left = "50%"
        logoImg.style.width = "34px"
        logoImg.style.height = "34px"
        logoImg.style.transform = "translate(-50%, -50%)"
        logoImg.style.pointerEvents = "none"
        logoImg.style.opacity = "0.85"
        logoImg.style.transition = "opacity 0.08s ease"

        wrapper.appendChild(svg)
        wrapper.appendChild(logoImg)
        body.appendChild(wrapper)

        this.fullscreenExitCircle = wrapper
        this.fullscreenExitCircleArc = arc
        this.fullscreenExitCircleCircumference = CIRCUMFERENCE
        this.fullscreenExitCircleLogo = logoImg
    }

    private startFullscreenExitEscHold() {
        if (!this.fullscreenExitCircle || this.fullscreenExitEscActive || !this.isFullscreen()) return

        this.fullscreenExitEscActive = true
        this.fullscreenExitCircle.style.display = "block"

        const arc = this.fullscreenExitCircleArc
        const logo = this.fullscreenExitCircleLogo
        const circumference = this.fullscreenExitCircleCircumference
        const duration = 750
        const start = performance.now()

        let flickerVisible = true
        const flickerInterval = window.setInterval(() => {
            if (!this.fullscreenExitEscActive) {
                window.clearInterval(flickerInterval)
                if (logo) logo.style.opacity = "1"
                return
            }
            flickerVisible = !flickerVisible
            if (logo) logo.style.opacity = flickerVisible ? "1" : "0.15"
        }, 200)

        const animate = (now: number) => {
            if (!this.fullscreenExitEscActive || !this.isFullscreen()) {
                window.clearInterval(flickerInterval)
                this.fullscreenExitCircle!.style.display = "none"
                arc?.setAttribute("stroke-dashoffset", `${circumference}`)
                if (logo) logo.style.opacity = "1"
                return
            }
            const t = Math.min(1, (now - start) / duration)
            arc?.setAttribute("stroke-dashoffset", `${circumference * (1 - t)}`)

            if (t < 1) {
                this.fullscreenExitEscAnimationFrame = window.requestAnimationFrame(animate)
            } else {
                window.clearInterval(flickerInterval)
                this.fullscreenExitEscAnimationFrame = null
                this.fullscreenExitEscActive = false
                this.fullscreenExitCircle!.style.display = "none"
                arc?.setAttribute("stroke-dashoffset", `${circumference}`)
                if (logo) logo.style.opacity = "1"
                void this.exitPointerLock()
                void this.exitFullscreen()
            }
        }
        this.fullscreenExitEscAnimationFrame = window.requestAnimationFrame(animate)
    }

    private cancelFullscreenExitEscHold() {
        if (!this.fullscreenExitCircle) return

        this.fullscreenExitEscActive = false
        if (this.fullscreenExitEscAnimationFrame != null) {
            window.cancelAnimationFrame(this.fullscreenExitEscAnimationFrame)
            this.fullscreenExitEscAnimationFrame = null
        }
        this.fullscreenExitCircle.style.display = "none"
        this.fullscreenExitCircleArc?.setAttribute(
            "stroke-dashoffset",
            `${this.fullscreenExitCircleCircumference}`
        )
        if (this.fullscreenExitCircleLogo) this.fullscreenExitCircleLogo.style.opacity = "1"
    }

    private createFileTransferProgressCircle() {
        const body = document.body
        if (!body) return

        const SIZE = 56
        const RADIUS = 21
        const CIRCUMFERENCE = 2 * Math.PI * RADIUS
        const CXY = 28

        const wrapper = document.createElement("div")
        wrapper.style.position = "fixed"
        wrapper.style.top = "12px"
        wrapper.style.left = "12px"
        wrapper.style.width = `${SIZE}px`
        wrapper.style.height = `${SIZE}px`
        wrapper.style.zIndex = "10000"
        wrapper.style.display = "none"
        wrapper.style.pointerEvents = "none"
        wrapper.style.borderRadius = "50%"
        wrapper.style.backdropFilter = "blur(8px)"
        wrapper.style.setProperty("-webkit-backdrop-filter", "blur(8px)")
        wrapper.style.background = "rgba(20, 20, 22, 0.75)"
        wrapper.style.boxShadow = "0 2px 12px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.08)"

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
        svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`)
        svg.setAttribute("width", `${SIZE}`)
        svg.setAttribute("height", `${SIZE}`)
        svg.style.position = "absolute"
        svg.style.top = "0"
        svg.style.left = "0"

        const borderCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
        borderCircle.setAttribute("cx", `${CXY}`)
        borderCircle.setAttribute("cy", `${CXY}`)
        borderCircle.setAttribute("r", `${RADIUS}`)
        borderCircle.setAttribute("fill", "none")
        borderCircle.setAttribute("stroke", "rgba(255,255,255,0.08)")
        borderCircle.setAttribute("stroke-width", "3")

        const arc = document.createElementNS("http://www.w3.org/2000/svg", "circle")
        arc.setAttribute("cx", `${CXY}`)
        arc.setAttribute("cy", `${CXY}`)
        arc.setAttribute("r", `${RADIUS}`)
        arc.setAttribute("fill", "none")
        arc.setAttribute("stroke", "rgba(255,255,255,0.85)")
        arc.setAttribute("stroke-width", "3")
        arc.setAttribute("stroke-dasharray", `${CIRCUMFERENCE}`)
        arc.setAttribute("stroke-dashoffset", `${CIRCUMFERENCE}`)
        arc.setAttribute("stroke-linecap", "round")
        arc.setAttribute("transform", `rotate(-90 ${CXY} ${CXY})`)

        svg.appendChild(borderCircle)
        svg.appendChild(arc)

        const label = document.createElement("span")
        label.textContent = "0%"
        label.style.position = "absolute"
        label.style.top = "50%"
        label.style.left = "50%"
        label.style.transform = "translate(-50%, -50%)"
        label.style.font = "600 7px system-ui, sans-serif"
        label.style.color = "rgba(255,255,255,0.9)"
        label.style.pointerEvents = "none"
        label.style.lineHeight = "1.05"
        label.style.letterSpacing = "-0.02em"
        label.style.whiteSpace = "pre-line"
        label.style.textAlign = "center"
        label.style.maxWidth = `${SIZE - 6}px`
        label.style.userSelect = "none"

        wrapper.addEventListener("mousedown", (e) => {
            if (wrapper.style.display === "block") e.stopPropagation()
        })
        wrapper.addEventListener("mouseup", (e) => {
            if (wrapper.style.display === "block") e.stopPropagation()
        })
        wrapper.addEventListener("click", (e) => {
            if (wrapper.style.display !== "block" || !this.fileTransferLastStatus) return
            e.stopPropagation()
            void navigator.clipboard.writeText(this.fileTransferLastStatus).catch((e) => {
                console.warn("[Stream]: could not copy transfer status", e)
            })
            ;(document.getElementById("input") as HTMLElement | null)?.focus()
        })

        wrapper.appendChild(svg)
        wrapper.appendChild(label)
        body.appendChild(wrapper)

        this.fileTransferProgressCircle = wrapper
        this.fileTransferProgressArc = arc
        this.fileTransferProgressCircumference = CIRCUMFERENCE
        this.fileTransferProgressLabel = label
    }

    private isFileTransferProgressVisible(): boolean {
        return this.fileTransferProgressCircle != null && this.fileTransferProgressCircle.style.display === "block"
    }

    private updateFileTransferProgressCircle(
        percent: number,
        loaded?: number,
        total?: number,
        source?: "file" | "clipboard"
    ) {
        if (!this.fileTransferProgressCircle || !this.fileTransferProgressArc || !this.fileTransferProgressLabel) return

        if (this.fileTransferProgressHideTimer != null) {
            clearTimeout(this.fileTransferProgressHideTimer)
            this.fileTransferProgressHideTimer = null
        }

        const clamped = Math.max(0, Math.min(100, Math.round(percent)))
        const c = this.fileTransferProgressCircumference
        const isClipboard = source === "clipboard"
        const kindPrefix = isClipboard ? "Clipboard: " : ""
        const kindName = isClipboard ? "Clipboard sync" : "File transfer"
        this.fileTransferProgressCircle.style.display = "block"
        this.fileTransferProgressCircle.style.pointerEvents = "auto"
        this.fileTransferProgressCircle.style.cursor = "pointer"
        this.fileTransferProgressLabel.style.userSelect = "text"
        this.fileTransferProgressLabel.style.cursor = "text"
        this.fileTransferProgressLabel.style.pointerEvents = "auto"

        const copyHint = " · Click or Ctrl+Shift+C to copy status"
        if (loaded !== undefined && total !== undefined && total > 0) {
            const body = `${clamped}%\n${formatTransferBytes(loaded)}/${formatTransferBytes(total)}`
            this.fileTransferProgressLabel.textContent = isClipboard ? `Clipboard\n${body}` : body
            const detail = `${kindPrefix}${formatTransferBytes(loaded)} / ${formatTransferBytes(total)} (${clamped}%)`
            this.fileTransferProgressCircle.title = detail + copyHint
            this.fileTransferLastStatus = `${kindName}: ${clamped}% (${formatTransferBytes(loaded)} / ${formatTransferBytes(total)})`
        } else {
            this.fileTransferProgressLabel.textContent = isClipboard ? `Clipboard\n${clamped}%` : `${clamped}%`
            this.fileTransferProgressCircle.title =
                (isClipboard ? "Clipboard" : "File transfer") + ` ${clamped}%` + copyHint
            this.fileTransferLastStatus = `${kindName}: ${clamped}%`
        }
        this.fileTransferProgressArc.setAttribute("stroke-dashoffset", `${c * (1 - clamped / 100)}`)

        if (clamped >= 100) {
            this.fileTransferProgressHideTimer = setTimeout(() => {
                this.fileTransferProgressHideTimer = null
                this.hideFileTransferProgressCircleImmediate()
            }, 500)
        }
    }

    private hideFileTransferProgressCircleImmediate() {
        if (this.fileTransferProgressHideTimer != null) {
            clearTimeout(this.fileTransferProgressHideTimer)
            this.fileTransferProgressHideTimer = null
        }
        if (!this.fileTransferProgressCircle || !this.fileTransferProgressArc || !this.fileTransferProgressLabel) return

        this.fileTransferProgressCircle.style.display = "none"
        this.fileTransferProgressCircle.style.pointerEvents = "none"
        this.fileTransferProgressCircle.style.cursor = ""
        this.fileTransferProgressCircle.title = ""
        this.fileTransferLastStatus = ""
        this.fileTransferProgressLabel.textContent = "0%"
        this.fileTransferProgressLabel.style.userSelect = "none"
        this.fileTransferProgressLabel.style.pointerEvents = "none"
        this.fileTransferProgressLabel.style.cursor = ""
        this.fileTransferProgressArc.setAttribute(
            "stroke-dashoffset",
            `${this.fileTransferProgressCircumference}`
        )
    }

    async requestFullscreen() {
        try {
            this.focusInput()
            await document.documentElement.requestFullscreen()
            if ("keyboard" in navigator && navigator.keyboard && "lock" in navigator.keyboard) {
                await navigator.keyboard.lock()
            }
        } catch (e) {
            this.adaptiveLog(`requestFullscreen failed: ${String(e)}`)
        }
    }
    async exitFullscreen() {
        if ("keyboard" in navigator && navigator.keyboard && "unlock" in navigator.keyboard) {
            await navigator.keyboard.unlock()
        }

        if ("exitFullscreen" in document && typeof document.exitFullscreen == "function") {
            await document.exitFullscreen()
        }
    }
    isFullscreen(): boolean {
        return "fullscreenElement" in document && !!document.fullscreenElement
    }
    private async onFullscreenChange() {
        this.checkFullyImmersed()
        this.syncSettingsQuickButtonVisibility()
        this.syncFullscreenToggleButtonLabel()
        this.syncFullscreenToggleButtonPosition()
        if (!this.isFullscreen()) {
            this.cancelFullscreenExitEscHold()
            this.releaseAllKeys("fullscreen exited")
        } else {
            this.releaseAllKeys("fullscreen entered")
        }
    }

    // Pointer Lock
    async requestPointerLock(errorIfNotFound: boolean = false) {
        this.previousMouseMode = this.inputConfig.mouseMode

        const inputElement = document.getElementById("input") as HTMLDivElement

        if (inputElement && "requestPointerLock" in inputElement && typeof inputElement.requestPointerLock == "function") {
            this.focusInput()

            this.inputConfig.mouseMode = "relative"
            this.setInputConfig(this.inputConfig)

            setSidebarExtended(false)

            const onLockError = () => {
                document.removeEventListener("pointerlockerror", onLockError)

                // Fallback: try to request pointer lock without options
                inputElement.requestPointerLock()
            }

            document.addEventListener("pointerlockerror", onLockError, { once: true })

            try {
                let promise = inputElement.requestPointerLock({
                    unadjustedMovement: true
                })

                if (promise) {
                    await promise
                } else {
                    inputElement.requestPointerLock()
                }
            } catch (error) {
                // Some platforms do not support unadjusted movement. If you
                // would like PointerLock anyway, request again.
                if (error instanceof Error && error.name == "NotSupportedError") {
                    inputElement.requestPointerLock()
                } else {
                    throw error
                }
            } finally {
                document.removeEventListener("pointerlockerror", onLockError)
            }

        } else if (errorIfNotFound) {
            await showMessage(streamT("pointerLock.unsupported"))
        }
    }
    async exitPointerLock() {
        if ("exitPointerLock" in document && typeof document.exitPointerLock == "function") {
            document.exitPointerLock()
        }
    }
    private onPointerLockChange() {
        this.adaptiveLog(
            `pointerlockchange: locked=${!!document.pointerLockElement} pendingEscRelockPrompt=${this.pendingEscRelockPrompt} latestHostCursorHidden=${this.latestHostCursorHidden} mouseMode=${this.getInputConfig().mouseMode}`
        )
        this.checkFullyImmersed()
        this.releaseAllKeys(document.pointerLockElement ? "pointer lock entered" : "pointer lock exited")

        if (!document.pointerLockElement) {
            // Some browsers/platforms can exit pointer lock on ESC without reliably
            // delivering the key event to our handlers. If host cursor is still hidden,
            // treat this as an ESC-like relock prompt trigger.
            if (!this.pendingEscRelockPrompt && this.latestHostCursorHidden) {
                this.pendingEscRelockPrompt = true
                this.adaptiveLog("pointer lock exited while host cursor hidden -> fallback arm esc relock prompt")
            }
            this.inputConfig.mouseMode = this.previousMouseMode
            this.setInputConfig(this.inputConfig)
            this.adaptivePointerLockActive = false
            if (this.adaptivePointerLockReleaseTimer != null) {
                clearTimeout(this.adaptivePointerLockReleaseTimer)
                this.adaptivePointerLockReleaseTimer = null
                this.adaptiveLog("cleared debounced pointer lock release timer (pointer lock exited)")
            }
            if (
                this.pendingEscRelockPrompt &&
                this.latestHostCursorHidden &&
                this.getInputConfig().mouseMode !== "relative" &&
                this.getInputConfig().mouseMode !== "pointAndDrag"
            ) {
                this.adaptivePointerLockArmed = true
                this.showAdaptivePointerRelockOverlay()
                this.showPointerRelockNotice()
                this.adaptiveLog("pointer lock exited while host cursor hidden -> rearm and prompt relock")
            } else {
                this.pendingEscRelockPrompt = false
                this.hideAdaptivePointerRelockOverlay()
                this.hidePointerRelockNotice()
            }
            this.adaptiveLog(`pointer lock exited -> restored mouseMode=${this.inputConfig.mouseMode}`)
        } else {
            this.pendingEscRelockPrompt = false
            this.hideAdaptivePointerRelockOverlay()
            this.hidePointerRelockNotice()
            this.adaptiveLog("pointer lock entered")
        }
    }

    // -- Fully immersed Fullscreen -> Fullscreen API + Pointer Lock
    private checkFullyImmersed() {
        // Keep the sidebar opener available even in immersive mode so users
        // can always access settings/controls without reloading.
        setSidebar(this.sidebar)
        this.updateSidebarAnchorToStreamRect()
    }

    mount(parent: HTMLElement): void {
        parent.appendChild(this.div)
    }
    unmount(parent: HTMLElement): void {
        window.removeEventListener("resize", this.windowResizeForQuickDock)
        getSidebarRoot()?.removeEventListener("transitionend", this.sidebarBackgroundTransitionDock)
        if (this.quickDockPostTransitionTimer != null) {
            clearTimeout(this.quickDockPostTransitionTimer)
            this.quickDockPostTransitionTimer = null
        }
        if (this.settingsQuickButton?.parentElement) {
            this.settingsQuickButton.parentElement.removeChild(this.settingsQuickButton)
        }
        if (this.keyboardFallbackButton?.parentElement) {
            this.keyboardFallbackButton.parentElement.removeChild(this.keyboardFallbackButton)
        }
        if (this.controllerFallbackButton?.parentElement) {
            this.controllerFallbackButton.parentElement.removeChild(this.controllerFallbackButton)
        }
        this.virtualControllerOverlay.hide()
        if (this.hudTrayDragPointerId !== null) {
            document.removeEventListener("pointermove", this.onHudTrayDragPointerMove)
            document.removeEventListener("pointerup", this.onHudTrayDragPointerEnd)
            document.removeEventListener("pointercancel", this.onHudTrayDragPointerEnd)
            this.hudTrayDragPointerId = null
            this.hudTrayDragCaptureEl = null
            this.fullscreenToggleButtonDragging = false
        }
        this.clearBitrateApplyDismissTimer()
        if (this.overlayHudCluster?.parentElement) {
            this.overlayHudCluster.parentElement.removeChild(this.overlayHudCluster)
        } else if (this.overlayHudTray?.parentElement) {
            this.overlayHudTray.parentElement.removeChild(this.overlayHudTray)
        } else if (this.fullscreenToggleButton?.parentElement) {
            this.fullscreenToggleButton.parentElement.removeChild(this.fullscreenToggleButton)
        }
        if (this.statsControlsGroup?.parentElement) {
            this.statsControlsGroup.parentElement.removeChild(this.statsControlsGroup)
        }
        if (this.bitrateToastStack?.parentElement) {
            this.bitrateToastStack.parentElement.removeChild(this.bitrateToastStack)
        }
        this.settingsQuickButton = null
        this.keyboardFallbackButton = null
        this.controllerFallbackButton = null
        this.fullscreenToggleButton = null
        this.overlayHudTray = null
        this.overlayHudCluster = null
        this.overlayBitrateApplyBtn = null
        this.overlayHudToolbar = null
        this.overlayHudStatsSlot = null
        this.hudTrayQualityRestoreBtn = null
        this.hudTrayStatsRestoreBtn = null
        this.overlayHudDragHandle = null
        this.overlayBitrateRange = null
        this.realtimeBitrateHud = null
        this.statsControlsGroup = null
        this.bitrateToastStack = null
        this.fullscreenToggleButtonManualPosition = false
        this.fullscreenToggleButtonDragging = false
        if (this.keyWatchdogInterval != null) {
            clearInterval(this.keyWatchdogInterval)
            this.keyWatchdogInterval = null
        }
        if (this.statsUpdateInterval != null) {
            clearInterval(this.statsUpdateInterval)
            this.statsUpdateInterval = null
        }
        this.cleanupStartupOverlaysOnAbortOrUnmount()
        this.adaptivePointerLockArmed = false
        this.adaptivePointerLockActive = false
        this.latestHostCursorHidden = false
        this.pendingEscRelockPrompt = false
        this.hideAdaptivePointerRelockOverlay()
        this.hidePointerRelockNotice()
        if (this.adaptivePointerLockReleaseTimer != null) {
            clearTimeout(this.adaptivePointerLockReleaseTimer)
            this.adaptivePointerLockReleaseTimer = null
        }
        this.adaptiveLog("reset adaptive mouse state (viewer app unmount)")
        this.releaseAllKeys("viewer app unmount")
        parent.removeChild(this.div)
    }

    private metric(value: number | null | undefined, digits = 0): string {
        if (value == null || !Number.isFinite(value)) {
            return "N/A"
        }
        return value.toFixed(digits)
    }
    private formatWithUnit(value: number | null | undefined, unit: string, digits = 0): string {
        if (value == null || !Number.isFinite(value)) {
            return "N/A"
        }
        return `${value.toFixed(digits)} ${unit}`
    }
    private safeText(value: unknown): string {
        if (value == null) {
            return "N/A"
        }
        const text = String(value).trim()
        if (!text || text.toLowerCase() === "null" || text.toLowerCase() === "nan" || text.toLowerCase() === "undefined") {
            return "N/A"
        }
        return text
    }
    private getConnectionLatencyMs(statsData: StreamStatsData): number | null {
        const webrtcRttMs = typeof statsData.transport.iceCurrentRoundTripTimeMs === "number"
            ? statsData.transport.iceCurrentRoundTripTimeMs
            : null
        if (webrtcRttMs != null && Number.isFinite(webrtcRttMs) && webrtcRttMs > 0) {
            return webrtcRttMs
        }
        return statsData.streamerRttMs ?? statsData.browserRtt
    }
    private iceCandidatePairType(statsData: StreamStatsData): string | null {
        const localType = this.safeText(statsData.transport.iceLocalCandidateType).toLowerCase()
        const remoteType = this.safeText(statsData.transport.iceRemoteCandidateType).toLowerCase()
        const hasLocal = localType !== "n/a" && localType !== "unknown"
        const hasRemote = remoteType !== "n/a" && remoteType !== "unknown"
        if (!hasLocal && !hasRemote) {
            return null
        }
        if (hasLocal && hasRemote) {
            return `${localType}-${remoteType}`
        }
        return hasLocal ? localType : remoteType
    }
    private unavailableText(value: unknown): string {
        const text = this.safeText(value)
        return text === "N/A" || text.toLowerCase() === "unknown" ? "Unavailable" : text
    }
    private computeBitrateMbps(statsData: StreamStatsData): number | null {
        const bytesReceivedRaw = statsData.transport.iceBytesReceived
        const bytesReceived = typeof bytesReceivedRaw === "number" && Number.isFinite(bytesReceivedRaw) ? bytesReceivedRaw : null
        if (bytesReceived == null) {
            return this.lastBitrateMbps
        }
        const now = Date.now()
        if (this.lastIceBytesReceived == null || this.lastIceBytesTsMs == null) {
            this.lastIceBytesReceived = bytesReceived
            this.lastIceBytesTsMs = now
            return this.lastBitrateMbps
        }
        const deltaBytes = bytesReceived - this.lastIceBytesReceived
        const deltaMs = now - this.lastIceBytesTsMs
        this.lastIceBytesReceived = bytesReceived
        this.lastIceBytesTsMs = now
        if (deltaBytes <= 0 || deltaMs <= 0) {
            return this.lastBitrateMbps
        }
        const mbps = (deltaBytes * 8) / (deltaMs / 1000) / 1000000
        this.lastBitrateMbps = Number.isFinite(mbps) ? mbps : this.lastBitrateMbps
        return this.lastBitrateMbps
    }
    private endpoint(address: string, port: string): string {
        if (address === "N/A") {
            return "N/A"
        }
        if (port === "N/A") {
            return address
        }
        return `${address}:${port}`
    }
    private readonly onStatsTopBarPointerDownForTrayDrag = (event: PointerEvent): void => {
        const target = event.target as HTMLElement | null
        if (target && target.closest(".video-stats-action-btn")) {
            return
        }
        if (this.statsClosed) return
        event.preventDefault()
        event.stopPropagation()
        this.statsDiv.classList.add("video-stats-dragging")
        this.startHudTrayDrag(event, this.statsTopBar)
    }
    toggleStatsWidgetVisibility() {
        const stats = this.getStream()?.getStats()
        if (!stats) return
        if (this.statsClosed) {
            this.reopenStreamStatsFromTray()
            return
        }
        stats.toggle()
        this.syncHudTrayToolbarButtons()
        this.syncFullscreenToggleButtonPosition()
    }
    private connectionStatusLabel(statsData: StreamStatsData): string {
        const latency = this.getConnectionLatencyMs(statsData)
        const packetLoss = typeof statsData.transport.webrtcPacketsLost === "number"
            ? statsData.transport.webrtcPacketsLost
            : null
        const packetsReceived = typeof statsData.transport.webrtcPacketsReceived === "number"
            ? statsData.transport.webrtcPacketsReceived
            : null
        const lossPercent = packetLoss != null && packetsReceived != null && (packetLoss + packetsReceived) > 0
            ? (packetLoss * 100) / (packetLoss + packetsReceived)
            : null
        const jitter = typeof statsData.transport.webrtcJitterMs === "number"
            ? statsData.transport.webrtcJitterMs
            : null
        const fps = typeof statsData.transport.webrtcFps === "number"
            ? statsData.transport.webrtcFps
            : statsData.videoFps

        if ((latency != null && latency >= 120) || (lossPercent != null && lossPercent >= 8) || (jitter != null && jitter >= 20) || (fps != null && fps < 20)) {
            return streamT("stats.quality.veryBad")
        }
        if ((latency != null && latency >= 80) || (lossPercent != null && lossPercent >= 4) || (jitter != null && jitter >= 12) || (fps != null && fps < 35)) {
            return streamT("stats.quality.bad")
        }
        if ((latency != null && latency >= 55) || (lossPercent != null && lossPercent >= 2) || (jitter != null && jitter >= 8) || (fps != null && fps < 50)) {
            return streamT("stats.quality.normal")
        }
        if ((latency != null && latency >= 35) || (lossPercent != null && lossPercent >= 0.6) || (jitter != null && jitter >= 4) || (fps != null && fps < 58)) {
            return streamT("stats.quality.good")
        }
        return streamT("stats.quality.veryGood")
    }

    private showBitrateToast(text: string, variant: "sent" | "applied" | "rejected") {
        let stack = this.bitrateToastStack
        if (!stack || !stack.parentElement) {
            stack = document.createElement("div")
            stack.className = "ml-bitrate-toast-stack"
            stack.setAttribute("aria-live", "polite")
            document.body.appendChild(stack)
            this.bitrateToastStack = stack
        }
        const toast = document.createElement("div")
        const variantClass =
            variant === "applied"
                ? "ml-bitrate-toast--applied"
                : variant === "rejected"
                  ? "ml-bitrate-toast--rejected"
                  : "ml-bitrate-toast--sent"
        toast.className = `ml-bitrate-toast ${variantClass}`
        toast.textContent = text
        stack.appendChild(toast)
        const dismissMs = variant === "sent" ? 2800 : 3200
        window.setTimeout(() => {
            toast.remove()
            if (stack && stack.childElementCount === 0 && stack.parentElement) {
                stack.parentElement.removeChild(stack)
                if (this.bitrateToastStack === stack) {
                    this.bitrateToastStack = null
                }
            }
        }, dismissMs)
    }

    private showBitrateSentMiniToast(mbps: number, source: "overlaySlider" | "preset") {
        const viaKey = source === "preset" ? "toast.via.preset" : "toast.via.slider"
        this.showBitrateToast(
            streamT("toast.bitrate.sent", {
                mbps: formatStreamBitrateMbpsDisplay(mbps),
                via: streamT(viaKey),
            }),
            "sent",
        )
    }

    private showBitrateHostAppliedMiniToast(mbps: number) {
        this.showBitrateToast(
            streamT("toast.bitrate.applied", { mbps: formatStreamBitrateMbpsDisplay(mbps) }),
            "applied",
        )
    }

    private showBitrateHostRejectedMiniToast(mbps: number, reason: string) {
        const shortReason = reason.length > 48 ? `${reason.slice(0, 45)}…` : reason
        this.showBitrateToast(
            streamT("toast.bitrate.rejected", {
                mbps: formatStreamBitrateMbpsDisplay(mbps),
                reason: shortReason,
            }),
            "rejected",
        )
    }

    private renderStatsOverlay(statsData: StreamStatsData) {
        const latency = this.getConnectionLatencyMs(statsData)
        const fps = typeof statsData.transport.webrtcFps === "number" ? statsData.transport.webrtcFps : statsData.videoFps
        const packetLoss = typeof statsData.transport.webrtcPacketsLost === "number" ? statsData.transport.webrtcPacketsLost : null
        const packetsReceived = typeof statsData.transport.webrtcPacketsReceived === "number" ? statsData.transport.webrtcPacketsReceived : null
        const packetLossPercent = packetLoss != null && packetsReceived != null && (packetLoss + packetsReceived) > 0
            ? (packetLoss * 100) / (packetLoss + packetsReceived)
            : null
        const jitter = typeof statsData.transport.webrtcJitterMs === "number" ? statsData.transport.webrtcJitterMs : null
        const rawIceState = this.safeText(statsData.transport.icePairState)
        const icePairState = rawIceState === "N/A" ? this.latestConnectionState : rawIceState
        const iceCandidatePair = this.iceCandidatePairType(statsData)
        const connectionStateLabel = iceCandidatePair ? `${icePairState} (${iceCandidatePair})` : icePairState
        const connectionStatusLabel = this.connectionStatusLabel(statsData)
        const na = streamT("stats.na")
        const resolution = statsData.videoWidth != null && statsData.videoHeight != null
            ? `${statsData.videoWidth}x${statsData.videoHeight}`
            : na
        const codec = this.safeText(statsData.videoCodec)
        const bitrate = this.computeBitrateMbps(statsData)
        const formattedBitrate = this.formatWithUnit(bitrate, "Mbps", 2)
        const rawTargetMbps =
            this.stream?.getRequestedVideoBitrateMbps() ?? getSettingsForApp(this.getAppId())?.bitrate
        const targetBitrateRow =
            rawTargetMbps != null && Number.isFinite(rawTargetMbps)
                ? `<span class="video-stats-row"><span class="video-stats-label">${streamT("stats.targetBitrate")}</span><span>${formatStreamBitrateMbpsDisplay(
                      rawTargetMbps,
                  )}</span></span>`
                : `<span class="video-stats-row"><span class="video-stats-label">${streamT("stats.targetBitrate")}</span><span>${na}</span></span>`
        this.statsMinimizeButton.textContent = this.statsMinimized ? "▢" : "—"
        this.statsTopBar.classList.toggle("video-stats-topbar-mini", this.statsMinimized)
        this.statsDetailsDiv.classList.remove("video-stats-mini", "video-stats-details-visible")
        this.statsDetailsDiv.innerHTML = ""

        if (this.statsMinimized) {
            this.statsTitleDiv.innerHTML = `
                <span class="video-stats-chip"><span class="video-stats-label">${streamT("stats.fps")}</span>${this.formatWithUnit(fps, "fps", 0)}</span>
                <span class="video-stats-chip"><span class="video-stats-label">${streamT("stats.latency")}</span>${this.formatWithUnit(latency, "ms", 0)}</span>
                <span class="video-stats-chip"><span class="video-stats-label">${streamT("stats.status")}</span>${connectionStatusLabel}</span>
                <span class="video-stats-chip"><span class="video-stats-label">${streamT("stats.bitrate")}</span>${formattedBitrate}</span>
            `
            this.statsSummaryDiv.hidden = true
            this.statsSummaryDiv.innerHTML = ""
            return
        }

        this.statsTitleDiv.textContent = streamT("stats.title")
        this.statsSummaryDiv.hidden = false
        this.statsSummaryDiv.innerHTML = `
            <span class="video-stats-row"><span class="video-stats-label">${streamT("stats.connectionState")}</span><span>${connectionStateLabel}</span></span>
            <span class="video-stats-row"><span class="video-stats-label">${streamT("stats.status")}</span><span>${connectionStatusLabel}</span></span>
            <span class="video-stats-row"><span class="video-stats-label">${streamT("stats.fps")}</span><span>${this.formatWithUnit(fps, "fps", 0)}</span></span>
            <span class="video-stats-row"><span class="video-stats-label">${streamT("stats.latency")}</span><span>${this.formatWithUnit(latency, "ms", 0)}</span></span>
            <span class="video-stats-row"><span class="video-stats-label">${streamT("stats.videoCodec")}</span><span>${codec}</span></span>
            <span class="video-stats-row"><span class="video-stats-label">${streamT("stats.resolution")}</span><span>${resolution}</span></span>
            <span class="video-stats-row"><span class="video-stats-label">${streamT("stats.jitter")}</span><span>${this.formatWithUnit(jitter, "ms", 2)}</span></span>
            <span class="video-stats-row"><span class="video-stats-label">${streamT("stats.loss")}</span><span>${packetLossPercent != null ? `${packetLossPercent.toFixed(2)}%` : na}</span></span>
            ${targetBitrateRow}
            <span class="video-stats-row"><span class="video-stats-label">${streamT("stats.bitrate")}</span><span>${formattedBitrate}</span></span>
        `
        this.statsDetailsDiv.classList.remove("video-stats-details-visible")
    }

    getStreamRect(): DOMRect {
        // The bounding rect of the videoElement or canvasElement can be bigger than the actual video
        // -> We need to correct for this when sending positions, else positions are wrong
        return this.stream?.getVideoRenderer()?.getStreamRect() ?? new DOMRect()
    }

    private updateSidebarAnchorToStreamRect() {
        const sidebarRoot = getSidebarRoot()
        if (!sidebarRoot) {
            return
        }

        if (this.settingsQuickButton) {
            this.anchorSidebarToSettingsButton()
            this.lastSidebarAnchorKey = "quick-button-anchor"
            return
        }

        this.moveSidebarRootIntoStreamLayer()

        const streamRect = this.getStreamRect()
        const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0)
        const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
        const hasValidRect = streamRect.width > 0 && streamRect.height > 0
        if (!hasValidRect) {
            if (this.lastSidebarAnchorKey !== "viewport") {
                sidebarRoot.style.left = ""
                sidebarRoot.style.right = ""
                sidebarRoot.style.top = ""
                sidebarRoot.style.bottom = ""
                this.lastSidebarAnchorKey = "viewport"
            }
            return
        }

        const edge = sidebarRoot.classList.contains("sidebar-edge-right")
            ? "right"
            : sidebarRoot.classList.contains("sidebar-edge-up")
                ? "up"
                : sidebarRoot.classList.contains("sidebar-edge-down")
                    ? "down"
                    : "left"
        const streamLeft = Math.max(0, Math.min(viewportWidth, streamRect.left))
        const streamRightInset = Math.max(0, Math.min(viewportWidth, viewportWidth - streamRect.right))
        const streamTop = Math.max(0, Math.min(viewportHeight, streamRect.top))
        const streamBottom = Math.max(0, Math.min(viewportHeight, streamRect.bottom))
        const streamBottomInset = Math.max(0, Math.min(viewportHeight, viewportHeight - streamRect.bottom))
        const streamCenterX = Math.max(0, Math.min(viewportWidth, streamRect.left + (streamRect.width / 2)))
        const streamCenterY = Math.max(0, Math.min(viewportHeight, streamRect.top + (streamRect.height / 2)))
        const dragOffsetY = getSidebarDragOffsetY()
        const sidebarBackground = sidebarRoot.querySelector(".sidebar-background")
        const sidebarBackgroundRect = sidebarBackground?.getBoundingClientRect()
        const sidebarHalfHeight = Math.max(24, ((sidebarBackgroundRect?.height) || 48) / 2)

        const anchorKey = `${edge}:${Math.round(streamLeft)}:${Math.round(streamRightInset)}:${Math.round(streamTop)}:${Math.round(streamBottomInset)}:${Math.round(streamCenterX)}:${Math.round(streamCenterY)}:${Math.round(sidebarHalfHeight)}:${Math.round(dragOffsetY)}`
        if (anchorKey === this.lastSidebarAnchorKey) {
            return
        }

        sidebarRoot.style.left = ""
        sidebarRoot.style.right = ""
        sidebarRoot.style.top = ""
        sidebarRoot.style.bottom = ""

        const minTop = streamTop + sidebarHalfHeight
        const maxTop = streamBottom - sidebarHalfHeight
        const fallbackTop = Math.max(streamTop, Math.min(streamBottom, streamCenterY))
        const clampSidebarTop = (desiredTop: number) => {
            if (minTop > maxTop) {
                return fallbackTop
            }
            return Math.max(minTop, Math.min(maxTop, desiredTop))
        }

        if (edge === "right") {
            sidebarRoot.style.right = `${streamRightInset}px`
            const desiredTop = streamCenterY + dragOffsetY
            const clampedTop = clampSidebarTop(desiredTop)
            sidebarRoot.style.top = `${clampedTop}px`
        } else if (edge === "up") {
            sidebarRoot.style.left = `${streamCenterX}px`
            sidebarRoot.style.top = `${streamTop}px`
        } else if (edge === "down") {
            sidebarRoot.style.left = `${streamCenterX}px`
            sidebarRoot.style.bottom = `${streamBottomInset}px`
        } else {
            sidebarRoot.style.left = `${streamLeft}px`
            const desiredTop = streamCenterY + dragOffsetY
            const clampedTop = clampSidebarTop(desiredTop)
            sidebarRoot.style.top = `${clampedTop}px`
        }

        this.lastSidebarAnchorKey = anchorKey
    }

    private moveSidebarRootIntoStreamLayer() {
        const sidebarRoot = getSidebarRoot()
        if (!sidebarRoot) {
            return
        }
        // Keep sidebar on body so it never gets hidden by stream-layer stacking contexts.
        if (sidebarRoot.parentElement !== document.body) {
            document.body.appendChild(sidebarRoot)
        }
        sidebarRoot.style.zIndex = "100002"
    }
    getStream(): Stream | null {
        return this.stream
    }

    /** Keep floating bitrate HUD in sync with persisted settings (e.g. settings modal). */
    refreshStreamOverlayBitrate(): void {
        this.syncOverlayBitrateRangeFromSettings()
        this.syncHudTrayToolbarButtons()
        this.syncFullscreenToggleButtonPosition()
    }

    getVirtualControllerOverlay(): VirtualControllerOverlay {
        return this.virtualControllerOverlay
    }
}

/**
 * Mirrors ConnectionInfoModal's console logging (`debugLog` / `onInfo`) for stream-info events.
 * No modal UI, no showModal / showErrorPopup — ViewerApp.onInfo still handles UX for errors.
 */
class StreamConnectionInfoConsoleLogger {
    private lastFileTransferPercentLogged = -1
    private lastFileTransferLoadedLogged = -1
    private lastFileTransferLogTime = 0

    onInfo(event: InfoEvent) {
        const data = event.detail

        if (data.type == "connectionComplete") {
            console.info("[Stream]: Connection Complete")
        } else if (data.type == "addDebugLine") {
            const message = data.line.trim()
            if (message) {
                console.info(`[Stream]: ${message}`)
            }
        } else if (data.type == "serverMessage") {
            console.info(`[Stream]: Server: ${data.message}`)
        } else if (data.type == "app") {
            console.info(`[Stream]: App: ${data.app.title}`)
        } else if (data.type == "connectionStatus") {
            console.info(`[Stream]: Connection status: ${data.status}`)
        } else if (data.type == "fileTransferProgress") {
            const p = data.percent
            const loaded = data.loaded
            const total = data.total
            const tag = data.source === "clipboard" ? "clipboardSync" : "fileTransfer"
            const prev = this.lastFileTransferPercentLogged
            const now = Date.now()
            const hasBytes = loaded !== undefined && total !== undefined && total > 0
            const byteStep = 512 * 1024
            const movedBytes =
                hasBytes &&
                loaded! - this.lastFileTransferLoadedLogged >= byteStep
            const stalledHeartbeat =
                hasBytes &&
                loaded! > this.lastFileTransferLoadedLogged &&
                now - this.lastFileTransferLogTime >= 2500
            if (
                p === 0 ||
                p === 100 ||
                prev < 0 ||
                p >= prev + 10 ||
                (p > 0 && prev === 0) ||
                movedBytes ||
                stalledHeartbeat
            ) {
                this.lastFileTransferPercentLogged = p
                if (hasBytes) {
                    this.lastFileTransferLoadedLogged = loaded!
                    this.lastFileTransferLogTime = now
                    console.info(
                        `[Stream]: ${tag} ${p}% (${formatTransferBytes(loaded!)}/${formatTransferBytes(total!)})`
                    )
                } else {
                    console.info(`[Stream]: ${tag} ${p}%`)
                }
            }
        } else if (data.type == "fileTransferProgressEnd") {
            const tag = data.source === "clipboard" ? "clipboardSync" : "fileTransfer"
            this.lastFileTransferPercentLogged = -1
            this.lastFileTransferLoadedLogged = -1
            this.lastFileTransferLogTime = 0
            console.info(`[Stream]: ${tag} end (complete, error, or cancelled)`)
        }
    }
}

class ConnectionInfoModal implements Modal<void> {

    private eventTarget = new EventTarget()

    private root = document.createElement("div")

    private textTy: LogMessageType | null = null
    private text = document.createElement("p")

    private options = document.createElement("div")
    private debugDetailButton = document.createElement("button")
    private closeButton = document.createElement("button")

    private debugDetail = "" // We store this seperate because line breaks don't work when the element is not mounted on the dom
    private debugDetailDisplay = document.createElement("div")

    constructor() {
        this.root.classList.add("modal-video-connect")

        this.text.innerText = streamT("modal.connecting")
        this.root.appendChild(this.text)

        this.root.appendChild(this.options)
        this.options.classList.add("modal-video-connect-options")

        this.debugDetailButton.innerText = streamT("modal.viewLogs")
        this.debugDetailButton.addEventListener("click", this.onDebugDetailClick.bind(this))
        this.options.appendChild(this.debugDetailButton)

        this.closeButton.innerText = streamT("modal.close")
        this.closeButton.addEventListener("click", this.onClose.bind(this))
        this.options.appendChild(this.closeButton)

        this.debugDetailDisplay.classList.add("textlike")
        this.debugDetailDisplay.classList.add("modal-video-connect-debug")
    }

    private onDebugDetailClick() {
        let debugDetailCurrentlyShown = this.root.contains(this.debugDetailDisplay)

        if (debugDetailCurrentlyShown) {
            this.debugDetailButton.innerText = streamT("modal.viewLogs")
            this.root.removeChild(this.debugDetailDisplay)
        } else {
            this.debugDetailButton.innerText = streamT("modal.hideLogs")
            this.root.appendChild(this.debugDetailDisplay)
            this.debugDetailDisplay.innerText = this.debugDetail
        }
    }

    private debugLog(line: string) {
        this.debugDetail += `${line}\n`
        this.debugDetailDisplay.innerText = this.debugDetail
        console.info(`[Stream]: ${line}`)
    }

    onInfo(event: InfoEvent) {
        const data = event.detail

        if (data.type == "connectionComplete") {
            const text = streamT("modal.connectionComplete")
            this.text.innerText = text
            this.debugLog(text)

            this.eventTarget.dispatchEvent(new Event("ml-connected"))
        } else if (data.type == "addDebugLine") {
            const message = data.line.trim()
            if (message) {
                this.debugLog(message)

                if (!this.textTy) {
                    this.text.innerText = message
                    this.textTy = data.additional?.type ?? null
                } else if (data.additional?.type == "fatalDescription" || data.additional?.type == "ifErrorDescription") {
                    if (this.text.innerText) {
                        this.text.innerText += "\n" + message
                    } else {
                        this.text.innerText = message
                    }
                    this.textTy = data.additional.type
                }
            }

            if (data.additional?.type == "fatal" || data.additional?.type == "fatalDescription") {
                showModal(this)
            } else if (data.additional?.type == "recover") {
                showModal(null)
            } else if (data.additional?.type == "informError") {
                showErrorPopup(data.line)
            }
        } else if (data.type == "serverMessage") {
            const text = streamT("modal.serverPrefix", { message: data.message })
            this.text.innerText = text
            this.debugLog(text)
        }
    }

    onClose() {
        showModal(null)
    }

    onFinish(abort: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            this.eventTarget.addEventListener("ml-connected", () => resolve(), { once: true, signal: abort })
        })
    }

    mount(parent: HTMLElement): void {
        parent.appendChild(this.root)
    }
    unmount(parent: HTMLElement): void {
        parent.removeChild(this.root)
    }
}

/** Modal that shows the Moonlight streaming settings panel (bitrate, fps, video size, etc.). */
const SETTINGS_NAV_LABELS = [
    "Video",
    "Audio",
    "Controls",
    "Other",
] as const
class SettingsPanelModal implements Component, Modal<null> {
    private wrapper = document.createElement("div")
    private content = document.createElement("div")
    private settingsComponent: StreamSettingsComponent
    private app: ViewerApp
    private panels: HTMLDivElement[]

    constructor(app: ViewerApp) {
        this.app = app
        this.wrapper.classList.add("modal-settings-panel")
        const header = document.createElement("div")
        header.classList.add("modal-settings-panel-header")
        const title = document.createElement("h2")
        title.innerText = "Moonlight Settings"
        const applyButton = document.createElement("button")
        applyButton.innerText = "Apply"
        applyButton.addEventListener("click", () => this.onApply())
        const closeButton = document.createElement("button")
        closeButton.innerText = "Close"
        closeButton.addEventListener("click", () => this.resolve(null))
        header.appendChild(title)
        const headerActions = document.createElement("div")
        headerActions.classList.add("modal-settings-panel-header-actions")
        headerActions.appendChild(applyButton)
        headerActions.appendChild(closeButton)
        header.appendChild(headerActions)
        this.wrapper.appendChild(header)

        // Stream settings UI (per-app)
        this.settingsComponent = new StreamSettingsComponent(getSettingsForApp(this.app.getAppId()) ?? undefined)
        let prevBitrateForRealtime: number | undefined
        this.settingsComponent.addChangeListener(() => {
            const s = this.settingsComponent.getStreamSettings()
            setSettingsForApp(this.app.getAppId(), s)
            setPageStyle(s.pageStyle)
            this.app.refreshStreamOverlayBitrate()
            if (prevBitrateForRealtime !== s.bitrate) {
                prevBitrateForRealtime = s.bitrate
                this.app.getStream()?.requestVideoBitrateMbps(s.bitrate, "settings")
            }
        })

        // Body: sidebar + content area with 4 panels (Video includes speed test)
        const body = document.createElement("div")
        body.classList.add("settings-body")
        const sidebar = document.createElement("nav")
        sidebar.classList.add("settings-sidebar")

        this.panels = []
        for (let i = 0; i < SETTINGS_NAV_LABELS.length; i++) {
            const panel = document.createElement("div")
            panel.classList.add("settings-panel")
            panel.setAttribute("data-panel", String(i))
            if (i !== 0) panel.classList.add("settings-panel-hidden")
            this.panels.push(panel)

            const navItem = document.createElement("button")
            navItem.type = "button"
            navItem.classList.add("settings-nav-item")
            if (i === 0) navItem.classList.add("settings-nav-item-video")
            if (i === 1) navItem.classList.add("settings-nav-item-audio")
            if (i === 2) navItem.classList.add("settings-nav-item-controls")
            if (i === 3) navItem.classList.add("settings-nav-item-other")
            navItem.setAttribute("data-panel", String(i))
            navItem.innerText = SETTINGS_NAV_LABELS[i]
            if (i === 0) navItem.classList.add("active")
            navItem.addEventListener("click", () => this.showPanel(i))
            sidebar.appendChild(navItem)
        }

        this.content.classList.add("modal-settings-panel-content", "settings-content")

        // Speed test (integrated into Video panel)
        const speedtestContainer = document.createElement("div")
        speedtestContainer.classList.add("settings-panel-inner")

        const speedtestTitle = document.createElement("h3")
        speedtestTitle.classList.add("settings-section-title")
        speedtestTitle.innerText = "Connection Speed Test"
        speedtestContainer.appendChild(speedtestTitle)

        const speedtestButton = document.createElement("button")
        speedtestButton.innerText = "Run Speed Test"
        speedtestContainer.appendChild(speedtestButton)

        const speedtestResult = document.createElement("div")
        speedtestResult.innerText = "Speed test not run yet."
        speedtestResult.classList.add("settings-speedtest-result")
        speedtestContainer.appendChild(speedtestResult)

        speedtestButton.addEventListener("click", async () => {
            speedtestButton.disabled = true
            speedtestResult.innerText = "Running speed test… This may take some time."

            try {
                // Clear old resource timings so getEntriesByName() can find speed-test entries (avoids transferSize undefined)
                if (typeof performance !== "undefined" && performance.clearResourceTimings) {
                    performance.clearResourceTimings()
                }
                const module = await import("@cloudflare/speedtest")
                const SpeedTestCtor = (module as any).default ?? module
                // Omit packetLoss step to avoid CORS: turn-creds only allows speed.cloudflare.com
                const measurementsNoPacketLoss = [
                    { type: "latency", numPackets: 1 },
                    { type: "download", bytes: 1e5, count: 1, bypassMinDuration: true },
                    { type: "latency", numPackets: 20 },
                    { type: "download", bytes: 1e5, count: 9 },
                    { type: "download", bytes: 1e6, count: 8 },
                    { type: "upload", bytes: 1e5, count: 8 },
                    { type: "upload", bytes: 1e6, count: 6 },
                    { type: "download", bytes: 1e7, count: 6 },
                    { type: "upload", bytes: 1e7, count: 4 },
                    { type: "download", bytes: 2.5e7, count: 4 },
                    { type: "upload", bytes: 2.5e7, count: 4 },
                    { type: "download", bytes: 1e8, count: 3 },
                    { type: "upload", bytes: 5e7, count: 3 },
                    { type: "download", bytes: 2.5e8, count: 2 },
                ]
                const test = new (SpeedTestCtor as any)({ autoStart: false, measurements: measurementsNoPacketLoss })

                ;(test as any).onFinish = (results: any) => {
                    try {
                        const down = results.getDownloadBandwidth && results.getDownloadBandwidth()
                        const up = results.getUploadBandwidth && results.getUploadBandwidth()
                        const latency = results.getUnloadedLatency && results.getUnloadedLatency()

                        const lines: string[] = []
                        if (down != null) {
                            lines.push(`Download: ${(down / 1e6).toFixed(2)} Mbps`)
                        }
                        if (up != null) {
                            lines.push(`Upload: ${(up / 1e6).toFixed(2)} Mbps`)
                        }
                        if (latency != null) {
                            lines.push(`Latency: ${latency.toFixed(1)} ms`)
                        }

                        // Calculate a recommended Moonlight bitrate and video preset from download+latency.
                        if (down != null) {
                            const downloadMbps = down / 1e6
                            let usable = downloadMbps * 0.35

                            if (latency != null && latency > 80) {
                                usable *= 0.7
                            }

                            // Clamp to [10, 70] Mbps and snap to nearest 10 Mbps tier
                            usable = Math.max(10, Math.min(usable, 70))
                            const tierMbps = Math.round(usable / 10) * 10
                            let presetText: string

                            if (tierMbps < 20) {
                                presetText = "1280 x 720 | HD | 60 FPS"
                            } else if (tierMbps < 40) {
                                presetText = "1920 x 1080 | FHD | 30 FPS"
                            } else {
                                presetText = "1920 x 1080 | FHD | 60 FPS"
                            }

                            lines.push(`Recommended video: ${presetText} | ${tierMbps.toFixed(0)} Mbps`)
                            ;(window as any).mlLastSpeedtestTierMbps = tierMbps
                        }

                        if (lines.length === 0) {
                            lines.push("Speed test finished, but no metrics were available.")
                        }

                        speedtestResult.innerText = lines.join("\n")
                    } catch (e) {
                        speedtestResult.innerText = "Speed test finished, but results could not be read."
                    } finally {
                        speedtestButton.disabled = false
                    }
                }

                ;(test as any).onError = (error: any) => {
                    const message = typeof error === "string"
                        ? error
                        : (error && error.message) || "Unknown error"
                    const isTransferSize = /transferSize/i.test(String(message))
                    const hint = isTransferSize
                        ? " Try refreshing the page and run the test again, or run a full test at speed.cloudflare.com."
                        : ""
                    speedtestResult.innerText = "Speed test failed: " + message + hint
                    speedtestButton.disabled = false
                }

                ;(test as any).play()
            } catch (e: any) {
                speedtestResult.innerText = "Failed to start speed test: " + (e?.message ?? String(e))
                speedtestButton.disabled = false
            }
        })

        // Panel 0: Video (speed test + video settings)
        const sectionDivs = this.settingsComponent.divElement.querySelectorAll<HTMLDivElement>(".settings-section")
        this.panels[0].appendChild(speedtestContainer)
        this.panels[0].appendChild(sectionDivs[1])

        // Panels 1–3: audio, controls (mouse+controller), other
        this.panels[1].appendChild(sectionDivs[2])
        this.panels[2].appendChild(sectionDivs[3])
        this.panels[2].appendChild(sectionDivs[4])
        this.panels[3].appendChild(sectionDivs[5])

        // Per-app settings export/import (dist)
        const fileSection = document.createElement("div")
        fileSection.classList.add("settings-panel-inner")
        const fileTitle = document.createElement("h3")
        fileTitle.classList.add("settings-section-title")
        fileTitle.innerText = "Per-app settings file"
        fileSection.appendChild(fileTitle)
        const exportBtn = document.createElement("button")
        exportBtn.innerText = "Export app_settings.json"
        exportBtn.style.marginRight = "0.5rem"
        exportBtn.addEventListener("click", () => exportAppSettingsToFile())
        fileSection.appendChild(exportBtn)
        const importBtn = document.createElement("button")
        importBtn.innerText = "Import from file"
        const importInput = document.createElement("input")
        importInput.type = "file"
        importInput.accept = "application/json,.json"
        importInput.style.display = "none"
        importInput.addEventListener("change", () => {
            const file = importInput.files?.[0]
            if (file) {
                const reader = new FileReader()
                reader.onload = () => {
                    const text = reader.result as string
                    if (text) importAppSettingsFromJson(text)
                    importInput.value = ""
                }
                reader.readAsText(file)
            }
        })
        importBtn.addEventListener("click", () => importInput.click())
        fileSection.appendChild(importBtn)
        fileSection.appendChild(importInput)
        this.panels[3].appendChild(fileSection)

        for (let i = 0; i < SETTINGS_NAV_LABELS.length; i++)
            this.content.appendChild(this.panels[i])
        body.appendChild(sidebar)
        body.appendChild(this.content)
        this.wrapper.appendChild(body)

        // Event target must stay in DOM (hidden) for component events
        this.settingsComponent.divElement.classList.add("settings-event-target")
        this.settingsComponent.divElement.setAttribute("aria-hidden", "true")
        this.wrapper.appendChild(this.settingsComponent.divElement)
    }

    private showPanel(index: number) {
        this.panels.forEach((panel, i) => {
            panel.classList.toggle("settings-panel-hidden", i !== index)
        })
        this.wrapper.querySelectorAll<HTMLButtonElement>(".settings-nav-item").forEach((item, i) => {
            item.classList.toggle("active", i === index)
        })
    }

    private async onApply(): Promise<void> {
        const settings = this.settingsComponent.getStreamSettings()
        setSettingsForApp(this.app.getAppId(), settings)
        setPageStyle(settings.pageStyle)
        this.app.refreshStreamOverlayBitrate()
        this.resolve(null)
        await this.app.restartStreamWithNewSettings(settings)
    }

    private resolve: (value: null) => void = () => {}

    mount(parent: Element): void {
        parent.appendChild(this.wrapper)
    }

    unmount(parent: Element): void {
        parent.removeChild(this.wrapper)
    }

    onFinish(signal: AbortSignal): Promise<null> {
        return new Promise<null>((resolve) => {
            this.resolve = resolve
            signal.addEventListener("abort", () => resolve(null))
        })
    }
}

/** Inline SVG icon: cursor hidden (circle + slash) */
function getIconHideCursor(): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("width", "20")
    svg.setAttribute("height", "20")
    svg.setAttribute("fill", "none")
    svg.setAttribute("stroke", "rgba(255,255,255,0.85)")
    svg.setAttribute("stroke-width", "1.8")
    svg.setAttribute("stroke-linecap", "round")
    svg.setAttribute("class", "settings-control-row__icon-svg")
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
    circle.setAttribute("cx", "12")
    circle.setAttribute("cy", "12")
    circle.setAttribute("r", "5")
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line")
    line.setAttribute("x1", "5")
    line.setAttribute("y1", "19")
    line.setAttribute("x2", "19")
    line.setAttribute("y2", "5")
    svg.appendChild(circle)
    svg.appendChild(line)
    return svg
}

/** Inline SVG icon: lock */
function getIconLock(): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    svg.setAttribute("viewBox", "0 0 24 24")
    svg.setAttribute("width", "20")
    svg.setAttribute("height", "20")
    svg.setAttribute("fill", "none")
    svg.setAttribute("stroke", "rgba(255,255,255,0.85)")
    svg.setAttribute("stroke-width", "1.8")
    svg.setAttribute("stroke-linecap", "round")
    svg.setAttribute("class", "settings-control-row__icon-svg")
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
    rect.setAttribute("x", "3")
    rect.setAttribute("y", "11")
    rect.setAttribute("width", "18")
    rect.setAttribute("height", "11")
    rect.setAttribute("rx", "2")
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("d", "M7 11V7a5 5 0 0110 0v4")
    svg.appendChild(rect)
    svg.appendChild(path)
    return svg
}

/** Premium toggle: wraps checkbox in label + track with glossy knob */
function createPremiumToggle(checkboxInput: HTMLInputElement): HTMLLabelElement {
    const label = document.createElement("label")
    label.className = "settings-toggle-wrap"
    checkboxInput.classList.add("settings-toggle-input")
    const track = document.createElement("span")
    track.className = "settings-toggle__track"
    label.appendChild(checkboxInput)
    label.appendChild(track)
    return label
}

/** Reusable settings row: left = icon + label, divider, right = control */
function createSettingsControlRow(opts: { iconSvg: SVGSVGElement, labelText: string, controlEl: HTMLElement }): HTMLDivElement {
    const { iconSvg, labelText, controlEl } = opts
    const row = document.createElement("div")
    row.className = "settings-control-row"
    const labelSection = document.createElement("div")
    labelSection.className = "settings-control-row__label"
    const iconWrap = document.createElement("span")
    iconWrap.className = "settings-control-row__icon"
    iconWrap.appendChild(iconSvg)
    const text = document.createElement("span")
    text.className = "settings-control-row__text"
    text.textContent = labelText
    labelSection.appendChild(iconWrap)
    labelSection.appendChild(text)
    const divider = document.createElement("span")
    divider.className = "settings-control-row__divider"
    divider.setAttribute("aria-hidden", "true")
    const controlSection = document.createElement("div")
    controlSection.className = "settings-control-row__control"
    controlSection.appendChild(controlEl)
    row.appendChild(labelSection)
    row.appendChild(divider)
    row.appendChild(controlSection)
    return row
}

class ViewerSidebar implements Component, Sidebar {
    private app: ViewerApp
    private selectedMode: null | "pc" | "phone"
    private uploadDoneAnnouncementHideTimer: ReturnType<typeof setTimeout> | null
    private div: HTMLDivElement
    private screenKeyboard: ScreenKeyboard
    private uploadDoneAnnouncementButton: HTMLButtonElement
    private uploadDoneAnnouncementTitle: HTMLSpanElement
    private uploadDoneAnnouncementMessage: HTMLSpanElement
    private modeSelectView: HTMLDivElement
    private phonePanelView: HTMLDivElement
    private pcPanelView: HTMLDivElement
    private commonSection: HTMLDivElement
    private sendKeycodeButton: HTMLButtonElement
    private keyboardButton: HTMLButtonElement
    private controllerButton: HTMLButtonElement
    private fullscreenButton: HTMLButtonElement
    private statsButton: HTMLButtonElement
    private exitStreamButton: HTMLButtonElement
    private uploadFileButton: HTMLButtonElement
    private hideCursorCheckbox: HTMLInputElement
    private lockMouseCheckbox: HTMLInputElement
    private mouseMode: SelectComponent
    private touchMode: SelectComponent

    constructor(app: ViewerApp) {
        this.app = app
        this.selectedMode = null // null | "pc" | "phone"
        this.uploadDoneAnnouncementHideTimer = null
        this.div = document.createElement("div")

        this.div.classList.add("sidebar-stream")
        this.screenKeyboard = new ScreenKeyboard({
            onVisibilityChange: (visible: boolean) => {
                this.app.getVirtualControllerOverlay().releaseAllTouchInteraction(
                    visible ? "screenKeyboard:show" : "screenKeyboard:hide"
                )
            },
        })

        this.screenKeyboard.addKeyDownListener(this.onKeyDown.bind(this))
        this.screenKeyboard.addKeyUpListener(this.onKeyUp.bind(this))
        this.screenKeyboard.addTextListener(this.onText.bind(this))
        document.body.appendChild(this.screenKeyboard.getHiddenElement())

        this.uploadDoneAnnouncementButton = document.createElement("button")
        this.uploadDoneAnnouncementButton.classList.add("upload-done-announcement")
        this.uploadDoneAnnouncementButton.type = "button"
        this.uploadDoneAnnouncementTitle = document.createElement("span")
        this.uploadDoneAnnouncementTitle.classList.add("upload-done-announcement-title")
        this.uploadDoneAnnouncementTitle.textContent = streamT("upload.title")
        this.uploadDoneAnnouncementMessage = document.createElement("span")
        this.uploadDoneAnnouncementMessage.classList.add("upload-done-announcement-message")
        this.uploadDoneAnnouncementButton.appendChild(this.uploadDoneAnnouncementTitle)
        this.uploadDoneAnnouncementButton.appendChild(this.uploadDoneAnnouncementMessage)
        this.uploadDoneAnnouncementButton.style.display = "none"
        this.uploadDoneAnnouncementButton.addEventListener("click", () => {
            if (this.uploadDoneAnnouncementHideTimer != null) {
                clearTimeout(this.uploadDoneAnnouncementHideTimer)
                this.uploadDoneAnnouncementHideTimer = null
            }
            this.uploadDoneAnnouncementButton.style.display = "none"
        })
        document.body.appendChild(this.uploadDoneAnnouncementButton)

        const openSettings = () => {
            setSidebarExtended(false)
            const sidebarRoot = getSidebarRoot()
            sidebarRoot?.classList.add("sidebar-settings-hidden")
            ;(showModal(new SettingsPanelModal(this.app)) as any)
                .finally(() => {
                    sidebarRoot?.classList.remove("sidebar-settings-hidden")
                })
        }

        // ---- Mode selection view (tier 1) ----
        this.modeSelectView = document.createElement("div")
        this.modeSelectView.setAttribute("data-sidebar-view", "mode-select")
        this.modeSelectView.classList.add("sidebar-mode-select")

        const pcModeBtn = document.createElement("button")
        pcModeBtn.className = "sidebar-stream-cta"
        const pcModeIcon = document.createElement("img")
        pcModeIcon.src = "resources/desktop_windows-48px.svg"
        pcModeIcon.alt = ""
        pcModeIcon.className = "sidebar-stream-cta-icon"
        pcModeBtn.appendChild(pcModeIcon)
        pcModeBtn.appendChild(document.createTextNode("PC Mode"))
        pcModeBtn.addEventListener("click", () => this.setSelectedMode("pc"))

        const phoneModeBtn = document.createElement("button")
        phoneModeBtn.className = "sidebar-stream-cta"
        const phoneModeIcon = document.createElement("img")
        phoneModeIcon.src = "resources/smartphone.svg"
        phoneModeIcon.alt = ""
        phoneModeIcon.className = "sidebar-stream-cta-icon"
        phoneModeBtn.appendChild(phoneModeIcon)
        phoneModeBtn.appendChild(document.createTextNode("Phone Mode"))
        phoneModeBtn.addEventListener("click", () => this.setSelectedMode("phone"))

        this.modeSelectView.appendChild(pcModeBtn)
        this.modeSelectView.appendChild(phoneModeBtn)
        this.div.appendChild(this.modeSelectView)

        // ---- Phone panel ----
        this.phonePanelView = document.createElement("div")
        this.phonePanelView.setAttribute("data-sidebar-view", "phone")

        const phonePanelHeader = document.createElement("div")
        phonePanelHeader.classList.add("sidebar-panel-header")
        const backBtnPhone = document.createElement("button")
        backBtnPhone.className = "sidebar-back-btn"
        backBtnPhone.innerText = "← Back"
        backBtnPhone.addEventListener("click", () => this.setSelectedMode(null))
        phonePanelHeader.appendChild(backBtnPhone)

        const statsHeaderPhone = document.createElement("button")
        statsHeaderPhone.classList.add("sidebar-panel-stats-btn")
        const statsIconPhone = document.createElement("img")
        statsIconPhone.src = "resources/route.svg"
        statsIconPhone.alt = ""
        statsIconPhone.className = "sidebar-btn-icon"
        statsHeaderPhone.appendChild(statsIconPhone)
        statsHeaderPhone.appendChild(document.createTextNode("Stats"))
        statsHeaderPhone.addEventListener("click", () => {
            this.app.toggleStatsWidgetVisibility()
        })
        phonePanelHeader.appendChild(statsHeaderPhone)
        this.phonePanelView.appendChild(phonePanelHeader)

        const phonePanelContent = document.createElement("div")
        phonePanelContent.classList.add("sidebar-panel-content", "sidebar-stream-buttons")

        this.sendKeycodeButton = document.createElement("button")
        this.sendKeycodeButton.classList.add("sidebar-btn-with-icon")
        const sendKeycodeIcon = document.createElement("img")
        sendKeycodeIcon.src = "resources/send.svg"
        sendKeycodeIcon.alt = ""
        sendKeycodeIcon.className = "sidebar-btn-icon"
        this.sendKeycodeButton.appendChild(sendKeycodeIcon)
        this.sendKeycodeButton.appendChild(document.createTextNode("Send Keycode"))
        this.sendKeycodeButton.addEventListener("click", async () => {
            const key = await showModal(new SendKeycodeModal())
            if (key == null) return
            this.app.getStream()?.getInput().sendKey(true, key, 0)
            this.app.getStream()?.getInput().sendKey(false, key, 0)
        })

        const settingsButtonPhone = document.createElement("button")
        settingsButtonPhone.classList.add("sidebar-btn-with-icon")
        const settingsIconPhone = document.createElement("img")
        settingsIconPhone.src = "resources/settings-gear.svg"
        settingsIconPhone.alt = ""
        settingsIconPhone.className = "sidebar-btn-icon"
        settingsButtonPhone.appendChild(settingsIconPhone)
        settingsButtonPhone.appendChild(document.createTextNode("Settings"))
        settingsButtonPhone.addEventListener("click", openSettings)

        this.touchMode = new SelectComponent("touchMode", [
            { value: "touch", name: "Touch" },
            { value: "mouseRelative", name: "Relative" },
            { value: "pointAndDrag", name: "Point and Drag" }
        ], {
            displayName: "",
            preSelectedOption: this.app.getInputConfig().touchMode,
            embeddedLabel: "Touch Mode",
            forcePolyfill: true,
            listClass: "sidebar-stream-select-list"
        })
        this.touchMode.addChangeListener(this.onTouchModeChange.bind(this))

        const touchModeContainer = document.createElement("div")
        touchModeContainer.classList.add("sidebar-mouse-mode-btn")

        const settingsTouchModeRow = document.createElement("div")
        settingsTouchModeRow.classList.add("sidebar-settings-hide-cursor-row")
        settingsTouchModeRow.appendChild(settingsButtonPhone)
        settingsTouchModeRow.appendChild(this.sendKeycodeButton)

        this.keyboardButton = document.createElement("button")
        this.keyboardButton.classList.add("sidebar-btn-with-icon")
        const keyboardIcon = document.createElement("img")
        keyboardIcon.src = "resources/keyboard.svg"
        keyboardIcon.alt = ""
        keyboardIcon.className = "sidebar-btn-icon"
        this.keyboardButton.appendChild(keyboardIcon)
        this.keyboardButton.appendChild(document.createTextNode("Keyboard"))
        this.keyboardButton.addEventListener("click", async () => {
            setSidebarExtended(false)
            this.screenKeyboard.show()
        })

        this.controllerButton = document.createElement("button")
        this.controllerButton.classList.add("sidebar-btn-with-icon")
        const controllerIcon = document.createElement("img")
        controllerIcon.src = "resources/game-controller.svg"
        controllerIcon.alt = ""
        controllerIcon.className = "sidebar-btn-icon"
        this.controllerButton.appendChild(controllerIcon)
        this.controllerButton.appendChild(document.createTextNode("Controller"))
        this.controllerButton.addEventListener("click", () => {
            setSidebarExtended(false)
            this.app.getVirtualControllerOverlay().show()
        })

        const sendKeycodeKeyboardRow = document.createElement("div")
        sendKeycodeKeyboardRow.classList.add("sidebar-touch-mode-row", "sidebar-stream-buttons-row-triple")
        sendKeycodeKeyboardRow.appendChild(touchModeContainer)
        sendKeycodeKeyboardRow.appendChild(this.keyboardButton)
        sendKeycodeKeyboardRow.appendChild(this.controllerButton)

        phonePanelContent.appendChild(settingsTouchModeRow)
        phonePanelContent.appendChild(sendKeycodeKeyboardRow)
        this.phonePanelView.appendChild(phonePanelContent)
        this.touchMode.mount(touchModeContainer)
        this.div.appendChild(this.phonePanelView)

        // ---- PC panel ----
        this.pcPanelView = document.createElement("div")
        this.pcPanelView.setAttribute("data-sidebar-view", "pc")

        const pcPanelHeader = document.createElement("div")
        pcPanelHeader.classList.add("sidebar-panel-header")
        const backBtnPc = document.createElement("button")
        backBtnPc.className = "sidebar-back-btn"
        backBtnPc.innerText = "← Back"
        backBtnPc.addEventListener("click", () => this.setSelectedMode(null))
        pcPanelHeader.appendChild(backBtnPc)

        const statsHeaderPc = document.createElement("button")
        statsHeaderPc.classList.add("sidebar-panel-stats-btn")
        const statsIconPc = document.createElement("img")
        statsIconPc.src = "resources/route.svg"
        statsIconPc.alt = ""
        statsIconPc.className = "sidebar-btn-icon"
        statsHeaderPc.appendChild(statsIconPc)
        statsHeaderPc.appendChild(document.createTextNode("Stats"))
        statsHeaderPc.addEventListener("click", () => {
            this.app.toggleStatsWidgetVisibility()
        })
        pcPanelHeader.appendChild(statsHeaderPc)
        this.pcPanelView.appendChild(pcPanelHeader)

        const pcPanelContent = document.createElement("div")
        pcPanelContent.classList.add("sidebar-panel-content", "sidebar-stream-buttons")

        const settingsButtonPc = document.createElement("button")
        settingsButtonPc.classList.add("sidebar-btn-with-icon")
        const settingsIconPc = document.createElement("img")
        settingsIconPc.src = "resources/settings-gear.svg"
        settingsIconPc.alt = ""
        settingsIconPc.className = "sidebar-btn-icon"
        settingsButtonPc.appendChild(settingsIconPc)
        settingsButtonPc.appendChild(document.createTextNode("Settings"))
        settingsButtonPc.addEventListener("click", openSettings)

        this.hideCursorCheckbox = document.createElement("input")
        this.hideCursorCheckbox.type = "checkbox"
        this.hideCursorCheckbox.addEventListener("change", () => {
            const input = this.app.getStream()?.getInput()
            if (input) {
                input.sendKey(true, StreamKeys.VK_LCONTROL, 0)
                input.sendKey(true, StreamKeys.VK_LMENU, 0)
                input.sendKey(true, StreamKeys.VK_LSHIFT, 0)
                input.sendKey(true, StreamKeys.VK_KEY_N, 0)
                input.sendKey(false, StreamKeys.VK_KEY_N, 0)
                input.sendKey(false, StreamKeys.VK_LSHIFT, 0)
                input.sendKey(false, StreamKeys.VK_LMENU, 0)
                input.sendKey(false, StreamKeys.VK_LCONTROL, 0)
            }
        })

        const hideCursorToggleWrap = createPremiumToggle(this.hideCursorCheckbox)
        const hideCursorRow = createSettingsControlRow({
            iconSvg: getIconHideCursor(),
            labelText: "Hide Host Cursor",
            controlEl: hideCursorToggleWrap
        })
        const hideCursorTextSpan = hideCursorRow.querySelector<HTMLSpanElement>(".settings-control-row__text")
        if (hideCursorTextSpan) hideCursorTextSpan.innerHTML = "Hide<br>Host Cursor"

        const settingsHideCursorRow = document.createElement("div")
        settingsHideCursorRow.classList.add("sidebar-settings-hide-cursor-row", "sidebar-pc-settings-row")
        settingsHideCursorRow.appendChild(settingsButtonPc)
        settingsHideCursorRow.appendChild(hideCursorRow)

        this.lockMouseCheckbox = document.createElement("input")
        this.lockMouseCheckbox.type = "checkbox"
        this.lockMouseCheckbox.addEventListener("change", async () => {
            if (this.lockMouseCheckbox.checked) await this.app.requestPointerLock(true)
            else await this.app.exitPointerLock()
        })
        document.addEventListener("pointerlockchange", () => {
            this.lockMouseCheckbox.checked = !!document.pointerLockElement
        })

        const lockMouseToggleWrap = createPremiumToggle(this.lockMouseCheckbox)
        const lockMouseRow = createSettingsControlRow({
            iconSvg: getIconLock(),
            labelText: "Lock Mouse",
            controlEl: lockMouseToggleWrap
        })

        this.mouseMode = new SelectComponent("mouseMode", [
            { value: "relative", name: "Relative" },
            { value: "follow", name: "Follow" },
            { value: "pointAndDrag", name: "Point and Drag" }
        ], {
            displayName: "",
            preSelectedOption: this.app.getInputConfig().mouseMode,
            embeddedLabel: "Mouse Mode",
            forcePolyfill: true,
            listClass: "sidebar-stream-select-list"
        })
        this.mouseMode.addChangeListener(this.onMouseModeChange.bind(this))

        const mouseModeContainer = document.createElement("div")
        mouseModeContainer.classList.add("sidebar-mouse-lock-cell", "sidebar-mouse-mode-btn")
        const mouseModeLockMouseRow = document.createElement("div")
        mouseModeLockMouseRow.classList.add("sidebar-mouse-mode-lock-row")
        mouseModeLockMouseRow.appendChild(mouseModeContainer)
        mouseModeLockMouseRow.appendChild(lockMouseRow)

        pcPanelContent.appendChild(settingsHideCursorRow)
        pcPanelContent.appendChild(mouseModeLockMouseRow)
        this.mouseMode.mount(mouseModeContainer)
        this.pcPanelView.appendChild(pcPanelContent)
        this.div.appendChild(this.pcPanelView)

        // ---- Common section (Upload, Fullscreen, Exit) ----
        this.commonSection = document.createElement("div")
        this.commonSection.classList.add("sidebar-common", "sidebar-stream-buttons")

        this.uploadFileButton = document.createElement("button")
        this.uploadFileButton.classList.add("sidebar-upload-btn")
        this.uploadFileButton.appendChild(document.createTextNode("UP FILE"))

        const uploadFileInput = document.createElement("input")
        uploadFileInput.type = "file"
        uploadFileInput.style.display = "none"
        uploadFileInput.addEventListener("change", async () => {
            const selectedFile = uploadFileInput.files?.[0]
            if (!selectedFile) {
                return
            }
            try {
                this.uploadFileButton.disabled = true
                const stream = this.app.getStream()
                if (!stream) {
                    return
                }
                await (stream as any).uploadFileToHost(selectedFile)
                this.showUploadDoneAnnouncement(selectedFile.name)
            } catch (e) {
                console.warn("[Stream]: upload from sidebar failed", e)
            } finally {
                this.uploadFileButton.disabled = false
                uploadFileInput.value = ""
            }
        })
        this.uploadFileButton.addEventListener("click", () => uploadFileInput.click())

        this.fullscreenButton = document.createElement("button")
        this.fullscreenButton.classList.add("sidebar-btn-with-icon", "sidebar-fullscreen-btn")
        const fullscreenIcon = document.createElement("img")
        fullscreenIcon.src = "resources/expand.svg"
        fullscreenIcon.alt = ""
        fullscreenIcon.className = "sidebar-btn-icon"
        this.fullscreenButton.appendChild(fullscreenIcon)
        const fullscreenLabel = document.createElement("span")
        fullscreenLabel.className = "sidebar-btn-label"
        fullscreenLabel.textContent = "Fullscreen"
        this.fullscreenButton.appendChild(fullscreenLabel)
        this.fullscreenButton.addEventListener("click", async () => {
            if (this.app.isFullscreen()) await this.app.exitFullscreen()
            else await this.app.requestFullscreen()
        })

        this.statsButton = document.createElement("button")
        this.statsButton.classList.add("sidebar-btn-with-icon")
        const statsIcon = document.createElement("img")
        statsIcon.src = "resources/route.svg"
        statsIcon.alt = ""
        statsIcon.className = "sidebar-btn-icon"
        this.statsButton.appendChild(statsIcon)
        this.statsButton.appendChild(document.createTextNode("Stats"))
        this.statsButton.addEventListener("click", () => {
            this.app.toggleStatsWidgetVisibility()
        })

        this.exitStreamButton = document.createElement("button")
        this.exitStreamButton.className = "sidebar-exit-btn sidebar-btn-with-icon"
        const exitIcon = document.createElement("img")
        exitIcon.src = "resources/square-arrow-right-exit.svg"
        exitIcon.alt = ""
        exitIcon.className = "sidebar-btn-icon"
        this.exitStreamButton.appendChild(exitIcon)
        const exitLabel = document.createElement("span")
        exitLabel.className = "sidebar-btn-label"
        exitLabel.textContent = "Exit"
        this.exitStreamButton.appendChild(exitLabel)
        this.exitStreamButton.addEventListener("click", async () => {
            await this.app.exitToLibrary()
        })

        this.commonSection.appendChild(this.uploadFileButton)
        this.commonSection.appendChild(uploadFileInput)
        this.commonSection.appendChild(this.fullscreenButton)
        this.commonSection.appendChild(this.exitStreamButton)
        this.div.appendChild(this.commonSection)

        this.setSelectedMode(null)
    }

    setSelectedMode(mode: null | "pc" | "phone") {
        this.selectedMode = mode
        this.modeSelectView.classList.toggle("sidebar-view-visible", mode === null)
        this.phonePanelView.classList.toggle("sidebar-view-visible", mode === "phone")
        this.pcPanelView.classList.toggle("sidebar-view-visible", mode === "pc")
        this.commonSection.classList.toggle("sidebar-view-visible", mode !== null)
    }

    onCapabilitiesChange(capabilities: StreamCapabilities) {
        this.touchMode.setOptionEnabled("touch", capabilities.touch)
        if (!capabilities.touch) {
            const config = this.app.getInputConfig()
            if (config.touchMode === "touch") {
                config.touchMode = "mouseRelative"
                this.app.setInputConfig(config)
            }
            if (this.touchMode.getValue() === "touch") {
                this.touchMode.setValue("mouseRelative", { silent: true })
            }
        }
    }

    showUploadDoneAnnouncement(fileName: string) {
        const safeFileName = (fileName || "").trim() || "file"
        this.uploadDoneAnnouncementMessage.textContent = streamT("upload.done", { file: safeFileName })
        this.uploadDoneAnnouncementButton.style.display = "inline-flex"
        if (this.uploadDoneAnnouncementHideTimer != null) {
            clearTimeout(this.uploadDoneAnnouncementHideTimer)
        }
        this.uploadDoneAnnouncementHideTimer = setTimeout(() => {
            this.uploadDoneAnnouncementButton.style.display = "none"
            this.uploadDoneAnnouncementHideTimer = null
        }, 5000)
    }

    getScreenKeyboard(): ScreenKeyboard {
        return this.screenKeyboard
    }

    // -- Keyboard
    private onText(event: TextEvent) {
        this.app.getStream()?.getInput().sendText(event.detail.text)
    }
    private onKeyDown(event: KeyboardEvent) {
        this.app.getStream()?.getInput().onKeyDown(event)
    }
    private onKeyUp(event: KeyboardEvent) {
        this.app.getStream()?.getInput().onKeyUp(event)
    }

    // -- Mouse Mode
    private onMouseModeChange() {
        const config = this.app.getInputConfig()
        config.mouseMode = this.mouseMode.getValue() as any
        this.app.setInputConfig(config)
    }

    // -- Touch Mode
    private onTouchModeChange() {
        const config = this.app.getInputConfig()
        config.touchMode = this.touchMode.getValue() as any
        this.app.setInputConfig(config)
    }

    extended(): void {

    }
    unextend(): void {

    }

    mount(parent: HTMLElement): void {
        parent.appendChild(this.div)
    }
    unmount(parent: HTMLElement): void {
        parent.removeChild(this.div)
        const keyboardRoot = this.screenKeyboard.getHiddenElement()
        if (keyboardRoot.parentElement) {
            keyboardRoot.parentElement.removeChild(keyboardRoot)
        }
    }
}

class SendKeycodeModal extends FormModal<number> {

    private dropdownSearch: SelectComponent
    private modalParent: HTMLElement | null = null

    constructor() {
        super()

        const keyList = []
        for (const keyNameRaw in StreamKeys) {
            const keyName = keyNameRaw as keyof typeof StreamKeys
            const keyValue = StreamKeys[keyName]

            const PREFIX = "VK_"

            let name: string = keyName
            if (name.startsWith(PREFIX)) {
                name = name.slice(PREFIX.length)
            }

            keyList.push({
                value: keyValue.toString(),
                name
            })
        }

        this.dropdownSearch = new SelectComponent("winKeycode", keyList, {
            hasSearch: true,
            displayName: "Select Keycode"
        })
    }

    mount(parent: Element): void {
        super.mount(parent)
        this.modalParent = document.getElementById("modal-parent")
        this.modalParent?.classList.add("modal-content-compact")
    }

    unmount(parent: Element): void {
        this.modalParent?.classList.remove("modal-content-compact")
        this.modalParent = null
        super.unmount(parent)
    }

    mountForm(form: HTMLFormElement): void {
        this.dropdownSearch.mount(form)
    }


    reset(): void {
        this.dropdownSearch.reset()
    }

    submit(): number | null {
        const keyString = this.dropdownSearch.getValue()
        if (keyString == null) {
            return null
        }

        return parseInt(keyString)
    }
}

// Stop propagation so the stream doesn't get it
function stopPropagationOn(element: HTMLElement) {
    element.addEventListener("keydown", onStopPropagation)
    element.addEventListener("keyup", onStopPropagation)
    element.addEventListener("keypress", onStopPropagation)
    element.addEventListener("click", onStopPropagation)
    element.addEventListener("mousedown", onStopPropagation)
    element.addEventListener("mouseup", onStopPropagation)
    element.addEventListener("mousemove", onStopPropagation)
    element.addEventListener("wheel", onStopPropagation)
    element.addEventListener("contextmenu", onStopPropagation)
    element.addEventListener("touchstart", onStopPropagation)
    element.addEventListener("touchmove", onStopPropagation)
    element.addEventListener("touchend", onStopPropagation)
    element.addEventListener("touchcancel", onStopPropagation)
}
function onStopPropagation(event: Event) {
    event.stopPropagation()
}