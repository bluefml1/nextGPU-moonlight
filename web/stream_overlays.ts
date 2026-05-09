/** Full-screen loading UI while the stream connection is established. */
export const MoonlightLoadingScreen = (() => {
    const CSS = `
        @keyframes ml-spin-fwd {
            to { stroke-dashoffset: 0; }
        }
        @keyframes ml-spin-rev {
            from { stroke-dashoffset: 0; }
            to { stroke-dashoffset: 339; }
        }
        @keyframes ml-pulse {
            0%,100% { opacity:.75; transform:translate(-50%,-50%) scale(1); }
            50%      { opacity:1;   transform:translate(-50%,-50%) scale(1.07); }
        }
        @keyframes ml-glow {
            0%,100% { opacity:.6; }
            50%      { opacity:1; }
        }
        @keyframes ml-fadein {
            from { opacity:0; transform:translateY(5px); }
            to   { opacity:1; transform:translateY(0); }
        }
        @keyframes ml-dot {
            0%,80%,100% { opacity:.2; transform:scale(.8); }
            40%          { opacity:1;  transform:scale(1); }
        }
        @keyframes ml-bar {
            0%   { left:-45%; width:40%; }
            50%  { left:25%;  width:60%; }
            100% { left:105%; width:40%; }
        }
        @keyframes ml-screenfade {
            from { opacity:0; }
            to   { opacity:1; }
        }

        #ml-loading-screen {
            position: fixed;
            inset: 0;
            z-index: 100000;
            background: #0c0c10;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            animation: ml-screenfade .35s ease both;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            overflow: hidden;
        }

        #ml-loading-screen::before {
            content: "";
            position: absolute;
            inset: 0;
            background-image:
                linear-gradient(rgba(255,255,255,.015) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,.015) 1px, transparent 1px);
            background-size: 40px 40px;
            pointer-events: none;
        }

        #ml-glow {
            position: absolute;
            width: 320px;
            height: 320px;
            border-radius: 50%;
            background: radial-gradient(circle,
                rgba(58,91,255,.22) 0%,
                rgba(0,200,255,.10) 45%,
                transparent 70%
            );
            top: 50%;
            left: 50%;
            transform: translate(-50%, -62%);
            animation: ml-glow 3s ease-in-out infinite;
            pointer-events: none;
        }

        #ml-ring-wrap {
            position: relative;
            width: 130px;
            height: 130px;
            margin-bottom: 30px;
        }

        #ml-ring-wrap svg {
            position: absolute;
            top: 0; left: 0;
        }

        #ml-ring-outer {
            transform-origin: 65px 65px;
            animation: ml-spin-fwd 3s linear infinite;
        }

        #ml-ring-inner {
            transform-origin: 65px 65px;
            animation: ml-spin-rev 1.8s linear infinite;
        }

        #ml-logo {
            position: absolute;
            top: 50%; left: 50%;
            width: 66px; height: 66px;
            transform: translate(-50%, -50%);
            animation: ml-pulse 2.4s ease-in-out infinite;
            pointer-events: none;
            user-select: none;
        }

        #ml-title {
            color: rgba(255,255,255,.92);
            font-size: 17px;
            font-weight: 500;
            letter-spacing: .03em;
            margin-bottom: 6px;
            animation: ml-fadein .6s ease both;
        }

        #ml-subtitle {
            color: rgba(255,255,255,.32);
            font-size: 11px;
            letter-spacing: .12em;
            text-transform: uppercase;
            margin-bottom: 22px;
            animation: ml-fadein .8s ease .1s both;
        }

        #ml-dots {
            display: flex;
            gap: 7px;
            animation: ml-fadein 1s ease .2s both;
        }

        .ml-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: linear-gradient(135deg, #4a6fff, #00c8ff);
            animation: ml-dot 1.4s ease-in-out infinite;
        }
        .ml-dot:nth-child(2) { animation-delay: .2s; }
        .ml-dot:nth-child(3) { animation-delay: .4s; }

        #ml-bar-wrap {
            position: absolute;
            bottom: 0; left: 0; right: 0;
            height: 2px;
            background: rgba(255,255,255,.05);
            overflow: hidden;
        }

        #ml-bar-fill {
            position: absolute;
            height: 100%;
            background: linear-gradient(90deg,
                transparent,
                #4a6fff,
                #00c8ff,
                transparent
            );
            animation: ml-bar 2s ease-in-out infinite;
        }
    `

    const LOGO_SRC = "./resources/sidebar-button-icon.png"

    let el: HTMLDivElement | null = null

    function injectStyles() {
        if (document.getElementById("ml-loading-styles")) return
        const style = document.createElement("style")
        style.id = "ml-loading-styles"
        style.textContent = CSS
        document.head.appendChild(style)
    }

    function build(title = "Connecting to NextGPU", subtitle = "Establishing stream") {
        const root = document.createElement("div")
        root.id = "ml-loading-screen"

        const glow = document.createElement("div")
        glow.id = "ml-glow"
        root.appendChild(glow)

        const ringWrap = document.createElement("div")
        ringWrap.id = "ml-ring-wrap"

        const OUTER_R = 58
        const INNER_R = 45
        const OUTER_CIRC = +(2 * Math.PI * OUTER_R).toFixed(2)
        const INNER_CIRC = +(2 * Math.PI * INNER_R).toFixed(2)

        const svgNS = "http://www.w3.org/2000/svg"
        const svg = document.createElementNS(svgNS, "svg")
        svg.setAttribute("width", "130")
        svg.setAttribute("height", "130")
        svg.setAttribute("viewBox", "0 0 130 130")

        const defs = document.createElementNS(svgNS, "defs")

        const grad1 = document.createElementNS(svgNS, "linearGradient")
        grad1.id = "ml-grad1"
        grad1.setAttribute("x1", "0%")
        grad1.setAttribute("y1", "0%")
        grad1.setAttribute("x2", "100%")
        grad1.setAttribute("y2", "0%")
        const s1a = document.createElementNS(svgNS, "stop")
        s1a.setAttribute("offset", "0%")
        s1a.setAttribute("stop-color", "#3a5bff")
        const s1b = document.createElementNS(svgNS, "stop")
        s1b.setAttribute("offset", "100%")
        s1b.setAttribute("stop-color", "#00c8ff")
        grad1.appendChild(s1a)
        grad1.appendChild(s1b)

        const grad2 = document.createElementNS(svgNS, "linearGradient")
        grad2.id = "ml-grad2"
        grad2.setAttribute("x1", "0%")
        grad2.setAttribute("y1", "0%")
        grad2.setAttribute("x2", "100%")
        grad2.setAttribute("y2", "0%")
        const s2a = document.createElementNS(svgNS, "stop")
        s2a.setAttribute("offset", "0%")
        s2a.setAttribute("stop-color", "#00c8ff")
        const s2b = document.createElementNS(svgNS, "stop")
        s2b.setAttribute("offset", "100%")
        s2b.setAttribute("stop-color", "#3a5bff")
        grad2.appendChild(s2a)
        grad2.appendChild(s2b)

        defs.appendChild(grad1)
        defs.appendChild(grad2)
        svg.appendChild(defs)

        const trackOuter = document.createElementNS(svgNS, "circle")
        trackOuter.setAttribute("cx", "65")
        trackOuter.setAttribute("cy", "65")
        trackOuter.setAttribute("r", String(OUTER_R))
        trackOuter.setAttribute("fill", "none")
        trackOuter.setAttribute("stroke", "rgba(255,255,255,0.05)")
        trackOuter.setAttribute("stroke-width", "3")

        const trackInner = document.createElementNS(svgNS, "circle")
        trackInner.setAttribute("cx", "65")
        trackInner.setAttribute("cy", "65")
        trackInner.setAttribute("r", String(INNER_R))
        trackInner.setAttribute("fill", "none")
        trackInner.setAttribute("stroke", "rgba(255,255,255,0.04)")
        trackInner.setAttribute("stroke-width", "2")

        const arcOuter = document.createElementNS(svgNS, "circle")
        arcOuter.id = "ml-ring-outer"
        arcOuter.setAttribute("cx", "65")
        arcOuter.setAttribute("cy", "65")
        arcOuter.setAttribute("r", String(OUTER_R))
        arcOuter.setAttribute("fill", "none")
        arcOuter.setAttribute("stroke", "url(#ml-grad1)")
        arcOuter.setAttribute("stroke-width", "3")
        arcOuter.setAttribute("stroke-linecap", "round")
        arcOuter.setAttribute("stroke-dasharray", String(OUTER_CIRC))
        arcOuter.setAttribute("stroke-dashoffset", String(OUTER_CIRC * 0.72))
        arcOuter.setAttribute("transform", "rotate(-90 65 65)")

        const arcInner = document.createElementNS(svgNS, "circle")
        arcInner.id = "ml-ring-inner"
        arcInner.setAttribute("cx", "65")
        arcInner.setAttribute("cy", "65")
        arcInner.setAttribute("r", String(INNER_R))
        arcInner.setAttribute("fill", "none")
        arcInner.setAttribute("stroke", "url(#ml-grad2)")
        arcInner.setAttribute("stroke-width", "2")
        arcInner.setAttribute("stroke-linecap", "round")
        arcInner.setAttribute("stroke-dasharray", String(INNER_CIRC))
        arcInner.setAttribute("stroke-dashoffset", String(INNER_CIRC * 0.65))
        arcInner.setAttribute("transform", "rotate(-90 65 65)")

        svg.appendChild(trackOuter)
        svg.appendChild(trackInner)
        svg.appendChild(arcOuter)
        svg.appendChild(arcInner)

        const logo = document.createElement("img")
        logo.id = "ml-logo"
        logo.src = LOGO_SRC
        logo.alt = "Moonlight"

        ringWrap.appendChild(svg)
        ringWrap.appendChild(logo)
        root.appendChild(ringWrap)

        const titleEl = document.createElement("div")
        titleEl.id = "ml-title"
        titleEl.textContent = title

        const subtitleEl = document.createElement("div")
        subtitleEl.id = "ml-subtitle"
        subtitleEl.textContent = subtitle

        const dotsEl = document.createElement("div")
        dotsEl.id = "ml-dots"
        for (let i = 0; i < 3; i++) {
            const d = document.createElement("div")
            d.className = "ml-dot"
            dotsEl.appendChild(d)
        }

        root.appendChild(titleEl)
        root.appendChild(subtitleEl)
        root.appendChild(dotsEl)

        const barWrap = document.createElement("div")
        barWrap.id = "ml-bar-wrap"
        const barFill = document.createElement("div")
        barFill.id = "ml-bar-fill"
        barWrap.appendChild(barFill)
        root.appendChild(barWrap)

        return root
    }

    return {
        show(title?: string, subtitle?: string) {
            if (el) return
            console.info("[Overlay:Loading] show", { title, subtitle })
            injectStyles()
            el = build(title, subtitle)
            document.body.appendChild(el)
        },
        hide(fadeMs = 300) {
            if (!el) return
            console.info("[Overlay:Loading] hide", { fadeMs })
            el.style.transition = `opacity ${fadeMs}ms ease`
            el.style.opacity = "0"
            setTimeout(() => {
                if (el?.parentNode) {
                    el.parentNode.removeChild(el)
                }
                el = null
            }, fadeMs)
        },
        setTitle(text: string) {
            const t = document.getElementById("ml-title")
            if (t) t.textContent = text
        },
        setSubtitle(text: string) {
            const s = document.getElementById("ml-subtitle")
            if (s) s.textContent = text
        },
    }
})()

/** Deprecated runtime no-op: fullscreen is user-driven via sidebar controls only. */
const MoonlightFullscreenOverlayImpl = (() => {
    return {
        show(_onFullscreen?: () => void) {
            // Intentionally no-op.
        },
        hide(_fadeMs = 280) {
            // Intentionally no-op.
        },
        isVisible() {
            return false
        },
    }
})()

export const MoonlightFullscreenOverlay = MoonlightFullscreenOverlayImpl

/** Passive chip prompting pointer-lock re-acquire without intercepting stream input. */
const MoonlightPointerLockOverlayImpl = (() => {
    const CSS = `
        @keyframes mlplo-fadein {
            from { opacity: 0; }
            to   { opacity: 1; }
        }

        #mlplo-overlay {
            position: fixed;
            right: 12px;
            bottom: 12px;
            z-index: 100;
            background: transparent;
            display: flex;
            align-items: flex-end;
            justify-content: flex-end;
            user-select: none;
            animation: mlplo-fadein .24s ease both;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            pointer-events: none;
        }

        #mlplo-chip {
            padding: 7px 10px;
            border-radius: 8px;
            background: rgba(10, 10, 12, 0.84);
            border: 1px solid rgba(255, 255, 255, 0.10);
            color: rgba(255, 255, 255, 0.92);
            font-size: 11px;
            font-weight: 500;
            letter-spacing: 0.01em;
            cursor: pointer;
            pointer-events: auto;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
            backdrop-filter: blur(3px);
            box-shadow:
                0 2px 8px rgba(0, 0, 0, 0.35),
                inset 0 0 0 1px rgba(255, 255, 255, 0.03);
            text-align: center;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            max-width: min(78vw, 340px);
        }

        #mlplo-action {
            border: 0;
            background: transparent;
            color: inherit;
            cursor: pointer;
            font: inherit;
            letter-spacing: inherit;
            padding: 0;
            opacity: 0.96;
        }

        #mlplo-action:hover {
            opacity: 1;
        }

        #mlplo-close {
            border: 0;
            border-radius: 6px;
            width: 16px;
            height: 16px;
            line-height: 16px;
            padding: 0;
            background: rgba(255, 255, 255, 0.10);
            color: rgba(255, 255, 255, 0.90);
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            opacity: 0.8;
        }

        #mlplo-close:hover {
            opacity: 1;
            background: rgba(255, 255, 255, 0.16);
        }

        @media (prefers-reduced-motion: reduce) {
            #mlplo-overlay {
                animation: none;
            }
        }
    `

    let overlayEl: HTMLDivElement | null = null
    let showId = 0

    function injectStyles() {
        if (document.getElementById("mlplo-styles")) return
        const s = document.createElement("style")
        s.id = "mlplo-styles"
        s.textContent = CSS
        document.head.appendChild(s)
    }

    function buildOverlay() {
        const root = document.createElement("div")
        root.id = "mlplo-overlay"
        const chip = document.createElement("div")
        chip.id = "mlplo-chip"
        chip.setAttribute("aria-live", "polite")
        const action = document.createElement("button")
        action.id = "mlplo-action"
        action.type = "button"
        action.textContent = "Click to relock mouse"
        const close = document.createElement("button")
        close.id = "mlplo-close"
        close.type = "button"
        close.setAttribute("aria-label", "Dismiss lock mouse hint")
        close.textContent = "x"
        chip.appendChild(action)
        chip.appendChild(close)
        root.appendChild(chip)
        return root
    }

    const api = {
        show(onRelock?: () => void, onDismiss?: () => void) {
            const thisShowId = ++showId
            if (overlayEl) api.hide(0)
            console.info("[Overlay:EscRelock] show")
            injectStyles()
            overlayEl = buildOverlay()
            const action = overlayEl.querySelector("#mlplo-action") as HTMLButtonElement | null
            const close = overlayEl.querySelector("#mlplo-close") as HTMLButtonElement | null

            const go = () => {
                if (!overlayEl || thisShowId !== showId) return
                console.info("[Overlay:EscRelock] user gesture -> relock")
                api.hide()
                onRelock?.()
            }
            const dismiss = () => {
                if (!overlayEl || thisShowId !== showId) return
                console.info("[Overlay:EscRelock] dismissed")
                api.hide()
                onDismiss?.()
            }

            action?.addEventListener("click", go)
            close?.addEventListener("click", (event) => {
                event.preventDefault()
                event.stopPropagation()
                dismiss()
            })

            document.body.appendChild(overlayEl)
        },
        hide(fadeMs = 220) {
            if (!overlayEl) return
            console.info("[Overlay:EscRelock] hide", { fadeMs })
            overlayEl.style.pointerEvents = "none"
            overlayEl.style.transition = `opacity ${fadeMs}ms ease`
            overlayEl.style.opacity = "0"
            const target = overlayEl
            overlayEl = null
            setTimeout(() => {
                if (target.parentNode) target.parentNode.removeChild(target)
            }, fadeMs)
        },
        isVisible() {
            return overlayEl !== null
        },
    }

    return api
})()

export const MoonlightPointerLockOverlay = MoonlightPointerLockOverlayImpl
