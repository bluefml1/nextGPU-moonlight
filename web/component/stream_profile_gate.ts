import {
    persistStreamProfileChoice,
    readProfileFromQuery,
    type StreamProfileId,
} from "../stream_profile_presets.js"
import {
    detectStreamLocale,
    fetchRecommendedProfile,
    gateProfileTitle,
    getStreamLocale,
    setStreamLocale,
    streamT,
    type StreamLocale,
} from "../stream_locale.js"
import { getStreamMachineLabel } from "../stream_label.js"

const GATE_STYLE_ID = "ml-profile-gate-styles"

const GATE_CSS = `
#ml-profile-gate {
    position: fixed;
    inset: 0;
    z-index: 100002;
    background: #0c0c10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 16px 32px;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: rgba(255,255,255,.92);
    overflow: auto;
}
#ml-profile-gate-lang {
    position: absolute;
    top: 16px;
    left: 16px;
    z-index: 2;
    display: flex;
    gap: 4px;
    padding: 3px;
    border-radius: 10px;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.1);
}
#ml-profile-gate-lang button {
    border: none;
    border-radius: 8px;
    padding: 6px 12px;
    font-size: .75rem;
    font-weight: 650;
    letter-spacing: .06em;
    cursor: pointer;
    color: rgba(255,255,255,.55);
    background: transparent;
    font-family: inherit;
}
#ml-profile-gate-lang button[aria-pressed="true"] {
    color: rgba(255,255,255,.95);
    background: rgba(90,130,255,.35);
}
#ml-profile-gate-lang button:focus-visible {
    outline: 2px solid rgba(100,180,255,.85);
    outline-offset: 2px;
}
#ml-profile-gate::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
        linear-gradient(rgba(255,255,255,.012) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.012) 1px, transparent 1px);
    background-size: 40px 40px;
    pointer-events: none;
}
#ml-profile-gate-glow {
    position: absolute;
    width: min(420px, 90vw);
    height: min(420px, 50vh);
    border-radius: 50%;
    background: radial-gradient(circle,
        rgba(58,91,255,.18) 0%,
        rgba(0,200,255,.08) 45%,
        transparent 70%
    );
    top: 28%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
}
#ml-profile-gate-logo {
    position: relative;
    z-index: 1;
    display: block;
    width: auto;
    max-height: clamp(40px, 10vh, 72px);
    margin: 0 auto 12px;
    object-fit: contain;
}
@media (max-height: 680px) {
    #ml-profile-gate-logo { display: none; }
}
#ml-profile-gate h1 {
    position: relative;
    z-index: 1;
    margin: 0 0 8px;
    font-size: clamp(1.25rem, 2.5vw, 1.75rem);
    font-weight: 650;
    letter-spacing: .02em;
    text-align: center;
}
#ml-profile-gate .ml-profile-gate-sub {
    position: relative;
    z-index: 1;
    margin: 0 0 28px;
    font-size: .95rem;
    color: rgba(255,255,255,.5);
    text-align: center;
    max-width: 36rem;
}
#ml-profile-gate .ml-profile-gate-sub strong {
    color: rgba(220,230,255,.92);
    font-weight: 650;
}
#ml-profile-gate-cards {
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    justify-content: center;
    align-items: stretch;
    width: 100%;
    max-width: 1100px;
}
.ml-profile-card {
    flex: 1 1 240px;
    max-width: 340px;
    min-width: min(100%, 240px);
    padding: 20px 18px 18px;
    border-radius: 14px;
    border: 1px solid rgba(255,255,255,.12);
    background: rgba(18,18,24,.85);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
    box-sizing: border-box;
    transition: border-color .15s ease, box-shadow .15s ease, transform .12s ease;
}
.ml-profile-card:hover {
    border-color: rgba(120,140,255,.45);
    box-shadow: 0 8px 32px rgba(0,0,0,.45);
}
.ml-profile-card:focus {
    outline: none;
    border-color: rgba(100,180,255,.85);
    box-shadow: 0 0 0 3px rgba(100,180,255,.25);
}
.ml-profile-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 8px;
}
.ml-profile-card-title {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0;
    letter-spacing: .03em;
    text-transform: uppercase;
    color: rgba(255,255,255,.95);
}
.ml-profile-card-badge {
    flex-shrink: 0;
    font-size: .65rem;
    font-weight: 700;
    letter-spacing: .08em;
    text-transform: uppercase;
    padding: 4px 8px;
    border-radius: 6px;
    background: linear-gradient(135deg, rgba(90,140,255,.35), rgba(0,200,180,.22));
    border: 1px solid rgba(140,180,255,.45);
    color: rgba(230,240,255,.95);
}
.ml-profile-card--recommended {
    border-color: rgba(120,160,255,.4);
    box-shadow: 0 0 0 1px rgba(100,160,255,.12) inset;
}
.ml-profile-card-desc {
    margin: 0 0 10px;
    font-size: .86rem;
    line-height: 1.4;
    color: rgba(255,255,255,.58);
}
.ml-profile-card-tagline {
    font-size: .78rem;
    line-height: 1.45;
    color: rgba(200,210,255,.72);
    font-variant-numeric: tabular-nums;
}
.ml-profile-card-kbd {
    display: inline-block;
    margin-top: 12px;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(255,255,255,.08);
    font-size: .72rem;
    letter-spacing: .06em;
    color: rgba(255,255,255,.45);
}
`

const PROFILE_IDS: StreamProfileId[] = ["performance", "balance", "quality"]
const PROFILE_KBD: Record<StreamProfileId, number> = {
    performance: 1,
    balance: 2,
    quality: 3,
}

function ensureGateStyles() {
    if (document.getElementById(GATE_STYLE_ID)) return
    const style = document.createElement("style")
    style.id = GATE_STYLE_ID
    style.textContent = GATE_CSS
    document.head.appendChild(style)
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}

function renderCardInner(
    id: StreamProfileId,
    locale: StreamLocale,
    recommendedId: StreamProfileId,
): string {
    const badge =
        id === recommendedId
            ? `<span class="ml-profile-card-badge" aria-label="${escapeHtml(streamT("gate.badge.aria", undefined, locale))}">${escapeHtml(streamT("gate.badge.recommended", undefined, locale))}</span>`
            : ""
    return (
        `<div class="ml-profile-card-header">` +
        `<span class="ml-profile-card-title">${escapeHtml(streamT(`gate.profile.${id}.title`, undefined, locale))}</span>${badge}` +
        `</div>` +
        `<p class="ml-profile-card-desc">${escapeHtml(streamT(`gate.profile.${id}.desc`, undefined, locale))}</p>` +
        `<div class="ml-profile-card-tagline">${escapeHtml(streamT(`gate.profile.${id}.tagline`, undefined, locale))}</div>` +
        `<span class="ml-profile-card-kbd">${escapeHtml(streamT("gate.kbd", { n: PROFILE_KBD[id] }, locale))}</span>`
    )
}

function showProfilePickerUi(): Promise<StreamProfileId> {
    ensureGateStyles()

    let locale: StreamLocale = getStreamLocale()
    let recommendedId: StreamProfileId = "balance"
    let userPicked = false
    let subtitleMode: "loading" | "withSpeed" | "noSpeed" | "fallback" = "loading"
    let speedMbps: number | null = null

    const shell = document.createElement("div")
    shell.id = "ml-profile-gate"
    shell.setAttribute("role", "dialog")
    shell.setAttribute("aria-modal", "true")
    shell.setAttribute("aria-labelledby", "ml-profile-gate-title")

    const langBar = document.createElement("div")
    langBar.id = "ml-profile-gate-lang"
    langBar.setAttribute("role", "group")
    langBar.setAttribute("aria-label", streamT("gate.lang.aria", undefined, locale))

    const btnVi = document.createElement("button")
    btnVi.type = "button"
    btnVi.textContent = streamT("gate.lang.vn", undefined, locale)
    const btnEn = document.createElement("button")
    btnEn.type = "button"
    btnEn.textContent = streamT("gate.lang.en", undefined, locale)
    langBar.appendChild(btnVi)
    langBar.appendChild(btnEn)
    shell.appendChild(langBar)

    const glow = document.createElement("div")
    glow.id = "ml-profile-gate-glow"
    shell.appendChild(glow)

    const logo = document.createElement("img")
    logo.id = "ml-profile-gate-logo"
    logo.src = "resources/sidebar-button-icon.png"
    logo.alt = getStreamMachineLabel() ?? "Stream"
    shell.appendChild(logo)

    const h1 = document.createElement("h1")
    h1.id = "ml-profile-gate-title"
    shell.appendChild(h1)

    const sub = document.createElement("p")
    sub.className = "ml-profile-gate-sub"
    shell.appendChild(sub)

    const row = document.createElement("div")
    row.id = "ml-profile-gate-cards"
    shell.appendChild(row)

    const buttons: HTMLButtonElement[] = []
    for (const id of PROFILE_IDS) {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "ml-profile-card"
        btn.dataset.profile = id
        row.appendChild(btn)
        buttons.push(btn)
    }

    const updateSubtitle = () => {
        const name = gateProfileTitle(recommendedId, locale)
        if (subtitleMode === "loading") {
            sub.textContent = streamT("gate.subtitle.loading", undefined, locale)
            return
        }
        if (subtitleMode === "withSpeed" && speedMbps != null) {
            const prefix = streamT("gate.subtitle.withSpeed", { mbps: speedMbps.toFixed(2) }, locale)
            sub.innerHTML = `${escapeHtml(prefix)} <strong>${escapeHtml(name)}</strong>`
            return
        }
        if (subtitleMode === "noSpeed") {
            const prefix = streamT("gate.subtitle.noSpeed", undefined, locale)
            sub.innerHTML = `${escapeHtml(prefix)} <strong>${escapeHtml(name)}</strong>`
            return
        }
        sub.innerHTML =
            `${escapeHtml(streamT("gate.subtitle.prefix", undefined, locale))} <strong>${escapeHtml(name)}</strong>`
    }

    const applyRecommendedStyles = () => {
        for (const btn of buttons) {
            const id = btn.dataset.profile as StreamProfileId
            btn.classList.toggle("ml-profile-card--recommended", id === recommendedId)
            btn.innerHTML = renderCardInner(id, locale, recommendedId)
        }
        updateSubtitle()
        if (!userPicked) {
            const focusBtn = buttons.find((b) => b.dataset.profile === recommendedId)
            focusBtn?.focus()
        }
    }

    const applyLocale = (next: StreamLocale) => {
        locale = next
        setStreamLocale(next)
        h1.textContent = streamT("gate.title", undefined, locale)
        langBar.setAttribute("aria-label", streamT("gate.lang.aria", undefined, locale))
        btnVi.setAttribute("aria-pressed", locale === "vi" ? "true" : "false")
        btnEn.setAttribute("aria-pressed", locale === "en" ? "true" : "false")
        applyRecommendedStyles()
    }

    btnVi.addEventListener("click", () => applyLocale("vi"))
    btnEn.addEventListener("click", () => applyLocale("en"))

    applyLocale(locale)

    void fetchRecommendedProfile().then((rec) => {
        if (userPicked) return
        recommendedId = rec.profileId
        speedMbps = rec.speedMbps ?? null
        if (rec.speedMbps != null && Number.isFinite(rec.speedMbps)) {
            subtitleMode = "withSpeed"
        } else if (rec.source === "api") {
            subtitleMode = "noSpeed"
        } else {
            subtitleMode = "fallback"
        }
        applyRecommendedStyles()
    })

    const prevBodyOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.body.appendChild(shell)

    return new Promise((resolve) => {
        const cleanup = (id: StreamProfileId) => {
            userPicked = true
            setStreamLocale(locale)
            document.removeEventListener("keydown", onKey)
            shell.removeEventListener("keydown", onTabTrap)
            document.body.style.overflow = prevBodyOverflow
            shell.remove()
            resolve(id)
        }

        const onKey = (ev: KeyboardEvent) => {
            if (ev.key === "1") {
                ev.preventDefault()
                cleanup("performance")
            } else if (ev.key === "2") {
                ev.preventDefault()
                cleanup("balance")
            } else if (ev.key === "3") {
                ev.preventDefault()
                cleanup("quality")
            }
        }

        const onTabTrap = (ev: KeyboardEvent) => {
            if (ev.key !== "Tab" || !shell.contains(ev.target as Node)) {
                return
            }
            const list = buttons
            if (list.length === 0) {
                return
            }
            const ix = list.indexOf(document.activeElement as HTMLButtonElement)
            if (ev.shiftKey) {
                if (ix <= 0) {
                    ev.preventDefault()
                    list[list.length - 1].focus()
                }
            } else if (ix === list.length - 1 || ix === -1) {
                ev.preventDefault()
                list[0].focus()
            }
        }

        for (const btn of buttons) {
            btn.addEventListener("click", () => {
                cleanup(btn.dataset.profile as StreamProfileId)
            })
        }

        document.addEventListener("keydown", onKey)
        shell.addEventListener("keydown", onTabTrap)
    })
}

/**
 * If ?profile= is set in the URL, apply and skip UI. Otherwise show the fullscreen gate, then persist choice.
 * Does not use any “remember me” storage to skip the gate on later visits.
 */
export async function runStreamProfileGate(queryParams: URLSearchParams): Promise<void> {
    const fromQuery = readProfileFromQuery(queryParams)
    if (fromQuery) {
        try {
            if (!localStorage.getItem("mlStreamLocale")) {
                setStreamLocale(detectStreamLocale())
            }
        } catch {
            setStreamLocale(detectStreamLocale())
        }
        persistStreamProfileChoice(fromQuery)
        return
    }
    const id = await showProfilePickerUi()
    persistStreamProfileChoice(id)
}
