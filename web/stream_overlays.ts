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
            z-index: 99999;
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

    function build(title = "Connecting to Moonlight", subtitle = "Establishing stream") {
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
            injectStyles()
            el = build(title, subtitle)
            document.body.appendChild(el)
        },
        hide(fadeMs = 300) {
            if (!el) return
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

/** Overlay that asks for a user gesture before entering fullscreen. */
const MoonlightFullscreenOverlayImpl = (() => {
    const CSS = `
        @keyframes mlfso-pulse {
            0%,100% { opacity: .55; transform: scale(1); }
            50%      { opacity: 1;   transform: scale(1.1); }
        }
        @keyframes mlfso-fadein {
            from { opacity: 0; }
            to   { opacity: 1; }
        }

        #mlfso-overlay {
            position: fixed;
            inset: 0;
            z-index: 99998;
            background: rgba(18, 18, 20, 0.82);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 14px;
            cursor: pointer;
            user-select: none;
            animation: mlfso-fadein .3s ease both;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        #mlfso-icon {
            animation: mlfso-pulse 2.8s ease-in-out infinite;
        }

        #mlfso-title {
            color: #ffffff;
            font-size: 17px;
            font-weight: 600;
            letter-spacing: .01em;
        }

        #mlfso-sub {
            color: rgba(255, 255, 255, .45);
            font-size: 12px;
            font-weight: 500;
            letter-spacing: .05em;
            text-transform: uppercase;
        }

        #mlfso-hint {
            margin-top: 28px;
            color: rgba(255, 255, 255, .35);
            font-size: 12px;
            letter-spacing: 0.03em;
        }

        #mlfso-kbd {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: 18px;
            padding: 0 7px;
            margin: 0 2px;
            border-radius: 5px;
            background: rgba(255, 255, 255, 0.08);
            border: 0.5px solid rgba(255, 255, 255, 0.2);
            color: rgba(255, 255, 255, 0.6);
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }
    `

    let overlayEl: HTMLDivElement | null = null
    let keyHandler: (() => void) | null = null

    function injectStyles() {
        if (document.getElementById("mlfso-styles")) return
        const s = document.createElement("style")
        s.id = "mlfso-styles"
        s.textContent = CSS
        document.head.appendChild(s)
    }

    function expandIcon() {
        const ns = "http://www.w3.org/2000/svg"
        const svg = document.createElementNS(ns, "svg")
        svg.id = "mlfso-icon"
        svg.setAttribute("width", "44")
        svg.setAttribute("height", "44")
        svg.setAttribute("viewBox", "0 0 24 24")
        svg.setAttribute("fill", "none")
        svg.setAttribute("stroke", "white")
        svg.setAttribute("stroke-width", "1.6")
        svg.setAttribute("stroke-linecap", "round")
        const path = document.createElementNS(ns, "path")
        path.setAttribute("d", "M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M8 21H5a2 2 0 01-2-2v-3M16 21h3a2 2 0 002-2v-3")
        svg.appendChild(path)
        return svg
    }

    function buildOverlay() {
        const root = document.createElement("div")
        root.id = "mlfso-overlay"

        const title = document.createElement("div")
        title.id = "mlfso-title"
        title.textContent = "Tap to enter fullscreen"

        const sub = document.createElement("div")
        sub.id = "mlfso-sub"
        sub.textContent = "Click anywhere to continue"

        root.appendChild(expandIcon())
        root.appendChild(title)
        root.appendChild(sub)

        const hint = document.createElement("div")
        hint.id = "mlfso-hint"
        hint.innerHTML = `Press <span id="mlfso-kbd">ESC</span> to exit fullscreen`
        root.appendChild(hint)

        return root
    }

    const api = {
        show(onFullscreen?: () => void) {
            if (overlayEl) return
            injectStyles()
            overlayEl = buildOverlay()
            const go = () => {
                api.hide()
                onFullscreen?.()
            }
            overlayEl.addEventListener("click", go, { once: true })
            keyHandler = go
            document.addEventListener("keydown", keyHandler, { once: true })
            document.body.appendChild(overlayEl)
        },
        hide(fadeMs = 280) {
            if (!overlayEl) return
            if (keyHandler) {
                document.removeEventListener("keydown", keyHandler)
                keyHandler = null
            }
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

export const MoonlightFullscreenOverlay = MoonlightFullscreenOverlayImpl
