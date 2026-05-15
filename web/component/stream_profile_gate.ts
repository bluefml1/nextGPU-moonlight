import {
    persistStreamProfileChoice,
    readProfileFromQuery,
    type StreamProfileId,
} from "../stream_profile_presets.js"

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

const CARDS: {
    id: StreamProfileId
    title: string
    desc: string
    tagline: string
    kbd: string
    recommended?: boolean
}[] = [
    {
        id: "performance",
        title: "Performance",
        desc: "Prioritizes low input latency and responsiveness.",
        tagline: "4K · 20 Mbps · 280 fps",
        kbd: "Press 1",
    },
    {
        id: "balance",
        title: "Balance",
        desc: "Recommended default for most sessions: balanced clarity and responsiveness.",
        tagline: "4K · 40 Mbps · 280 fps",
        kbd: "Press 2",
        recommended: true,
    },
    {
        id: "quality",
        title: "Quality",
        desc: "Highest visual fidelity for high-end network and hardware conditions.",
        tagline: "4K · 80 Mbps · 280 fps",
        kbd: "Press 3",
    },
]

function ensureGateStyles() {
    if (document.getElementById(GATE_STYLE_ID)) return
    const style = document.createElement("style")
    style.id = GATE_STYLE_ID
    style.textContent = GATE_CSS
    document.head.appendChild(style)
}

function showProfilePickerUi(): Promise<StreamProfileId> {
    ensureGateStyles()

    const shell = document.createElement("div")
    shell.id = "ml-profile-gate"
    shell.setAttribute("role", "dialog")
    shell.setAttribute("aria-modal", "true")
    shell.setAttribute("aria-labelledby", "ml-profile-gate-title")

    const glow = document.createElement("div")
    glow.id = "ml-profile-gate-glow"
    shell.appendChild(glow)

    const h1 = document.createElement("h1")
    h1.id = "ml-profile-gate-title"
    h1.textContent = "Select Stream Profile"
    shell.appendChild(h1)

    const sub = document.createElement("p")
    sub.className = "ml-profile-gate-sub"
    sub.textContent =
        "Balance is recommended for most users. You can fine-tune stream settings after connection."
    shell.appendChild(sub)

    const row = document.createElement("div")
    row.id = "ml-profile-gate-cards"
    shell.appendChild(row)

    const buttons: HTMLButtonElement[] = []
    for (const c of CARDS) {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "ml-profile-card" + (c.recommended ? " ml-profile-card--recommended" : "")
        btn.dataset.profile = c.id
        const badge = c.recommended
            ? `<span class="ml-profile-card-badge" aria-label="Recommended default">Recommended</span>`
            : ""
        btn.innerHTML =
            `<div class="ml-profile-card-header">` +
            `<span class="ml-profile-card-title">${escapeHtml(c.title)}</span>${badge}` +
            `</div>` +
            `<p class="ml-profile-card-desc">${escapeHtml(c.desc)}</p>` +
            `<div class="ml-profile-card-tagline">${escapeHtml(c.tagline)}</div>` +
            `<span class="ml-profile-card-kbd">${escapeHtml(c.kbd)}</span>`
        row.appendChild(btn)
        buttons.push(btn)
    }

    const prevBodyOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.body.appendChild(shell)

    return new Promise((resolve) => {
        const cleanup = (id: StreamProfileId) => {
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
        const balanceBtn = buttons.find((b) => b.dataset.profile === "balance")
        queueMicrotask(() => (balanceBtn ?? buttons[0])?.focus())
    })
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}

/**
 * If ?profile= is set in the URL, apply and skip UI. Otherwise show the fullscreen gate, then persist choice.
 * Does not use any “remember me” storage to skip the gate on later visits.
 */
export async function runStreamProfileGate(queryParams: URLSearchParams): Promise<void> {
    const fromQuery = readProfileFromQuery(queryParams)
    if (fromQuery) {
        persistStreamProfileChoice(fromQuery)
        return
    }
    const id = await showProfilePickerUi()
    persistStreamProfileChoice(id)
}
