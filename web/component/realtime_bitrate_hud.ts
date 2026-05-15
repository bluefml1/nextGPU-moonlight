/** Realtime stream overlay bitrate control (HUD). Quartile tiers, presets, single native range. Values are Mbps end-to-end; transport converts to kbps. */

/** Slider lower bound (Mbps). Upper bound is `RT_BITRATE_MAX`. */
export const RT_BITRATE_MIN = 15
export const RT_BITRATE_MAX = 300
export const RT_BITRATE_STEP = 0.5

const PRESET_MBPS = [20, 40, 80, RT_BITRATE_MAX] as const
/** Two-line preset: Mbps label + profile name (matches stream profile bitrates). */
const PRESET_LINES: { mbpsLabel: string; name: string }[] = [
    { mbpsLabel: "20", name: "Performance" },
    { mbpsLabel: "40", name: "Balance" },
    { mbpsLabel: "80", name: "Quality" },
    { mbpsLabel: "300", name: "Max" },
]

const KBPS_PER_STEP = 500

/** Whole Mbps when the equivalent kbps is a multiple of 1000; otherwise up to 2 fraction digits. */
export function formatStreamBitrateMbpsNumber(mbps: number): string {
    const k = Math.round(mbps * 1000)
    const m = k / 1000
    if (k % 1000 === 0) {
        return m.toLocaleString(undefined, { maximumFractionDigits: 0 })
    }
    return m.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function formatStreamBitrateMbpsDisplay(mbps: number): string {
    return `${formatStreamBitrateMbpsNumber(mbps)} Mbps`
}

type TierId = "warning" | "info" | "success" | "accent"

type TierDef = {
    id: TierId
    label: string
    fullLabel: string
    hint: string
}

const TIER_DEFS: TierDef[] = [
    {
        id: "warning",
        label: "Performance",
        fullLabel: "Performance-oriented",
        hint: "Lower bandwidth; best when uplink is limited. Step up if the image looks blocky.",
    },
    {
        id: "info",
        label: "Balanced",
        fullLabel: "Balanced quality",
        hint: "Good default for many networks. Nudge toward Quality if artifacts remain.",
    },
    {
        id: "success",
        label: "Quality",
        fullLabel: "High quality",
        hint: "Strong detail; needs steady throughput. Prefer wired or strong Wi‑Fi.",
    },
    {
        id: "accent",
        label: "Peak",
        fullLabel: "Peak quality",
        hint: "Maximum bitrate in this control; use only when the path to the host is very stable.",
    },
]

export function snapBitrateMbps(v: number): number {
    const c = Math.min(RT_BITRATE_MAX, Math.max(RT_BITRATE_MIN, v))
    const steps = Math.round((c - RT_BITRATE_MIN) / RT_BITRATE_STEP)
    return RT_BITRATE_MIN + steps * RT_BITRATE_STEP
}

function tierIndexForValue(mbps: number): 0 | 1 | 2 | 3 {
    const t = (mbps - RT_BITRATE_MIN) / (RT_BITRATE_MAX - RT_BITRATE_MIN)
    if (t < 0.25) return 0
    if (t < 0.5) return 1
    if (t < 0.75) return 2
    return 3
}

export type RealtimeBitrateHud = {
    root: HTMLElement
    range: HTMLInputElement
    update: (mbps: number) => void
    setDisabled: (disabled: boolean) => void
}

export type CreateRealtimeBitrateHudOptions = {
    onBitrateChange: (mbps: number, source: "overlaySlider" | "preset") => void
    /** Persist-hide HUD (e.g. uncheck stream setting). */
    onCloseRequested?: () => void
    initialMbps?: number
}

export function createRealtimeBitrateHud(options: CreateRealtimeBitrateHudOptions): RealtimeBitrateHud {
    const { onBitrateChange, onCloseRequested } = options
    let lastValue = snapBitrateMbps(
        options.initialMbps != null && Number.isFinite(options.initialMbps) ? options.initialMbps : RT_BITRATE_MIN,
    )
    let expanded = false
    let editingValue = false
    let editSnapshot = lastValue

    const root = document.createElement("div")
    root.className = "ml-rt-bitrate"
    root.setAttribute("role", "group")
    root.setAttribute("aria-label", "Stream bitrate")

    const strip = document.createElement("div")
    strip.className = "ml-rt-bitrate__strip"

    const tierCol = document.createElement("div")
    tierCol.className = "ml-rt-bitrate__tier"
    const dot = document.createElement("span")
    dot.className = "ml-rt-bitrate__dot"
    dot.setAttribute("aria-hidden", "true")
    const tierLabel = document.createElement("span")
    tierLabel.className = "ml-rt-bitrate__tier-label"
    tierCol.appendChild(dot)
    tierCol.appendChild(tierLabel)

    const trackWrap = document.createElement("div")
    trackWrap.className = "ml-rt-bitrate__track-wrap"
    const track = document.createElement("div")
    track.className = "ml-rt-bitrate__track"
    const fill = document.createElement("div")
    fill.className = "ml-rt-bitrate__fill"
    track.appendChild(fill)

    const range = document.createElement("input")
    range.type = "range"
    range.className = "ml-rt-bitrate__range video-overlay-bitrate-range"
    range.min = String(RT_BITRATE_MIN)
    range.max = String(RT_BITRATE_MAX)
    range.step = String(RT_BITRATE_STEP)
    range.title = "Stream bitrate (Mbps)"
    range.setAttribute("aria-label", "Stream bitrate while streaming")
    range.disabled = true

    trackWrap.appendChild(track)
    trackWrap.appendChild(range)
    range.addEventListener("pointerdown", (e) => e.stopPropagation())

    const valueSlot = document.createElement("div")
    valueSlot.className = "ml-rt-bitrate__value-slot"
    const valueDisplay = document.createElement("button")
    valueDisplay.type = "button"
    valueDisplay.className = "ml-rt-bitrate__value-display"
    valueDisplay.setAttribute("aria-label", "Edit bitrate value")
    const valueInput = document.createElement("input")
    valueInput.type = "number"
    valueInput.className = "ml-rt-bitrate__value-input"
    valueInput.min = String(RT_BITRATE_MIN)
    valueInput.max = String(RT_BITRATE_MAX)
    valueInput.step = String(RT_BITRATE_STEP)
    valueInput.setAttribute("inputmode", "decimal")
    valueInput.setAttribute("autocomplete", "off")
    valueInput.setAttribute("aria-label", "Bitrate Mbps")
    valueSlot.appendChild(valueDisplay)
    valueSlot.appendChild(valueInput)

    const chevron = document.createElement("button")
    chevron.type = "button"
    chevron.className = "ml-rt-bitrate__chevron"
    chevron.setAttribute("aria-expanded", "false")
    chevron.setAttribute("aria-label", "Toggle bitrate details")
    chevron.innerHTML =
        '<svg class="ml-rt-bitrate__chevron-icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M2 4l4 4 4-4H2z"/></svg>'

    const closeBtn = document.createElement("button")
    closeBtn.type = "button"
    closeBtn.className = "ml-rt-bitrate__close"
    closeBtn.setAttribute("aria-label", "Hide realtime bitrate control")
    closeBtn.title = "Hide bitrate control (re-enable in stream settings)"
    closeBtn.textContent = "×"

    strip.appendChild(tierCol)
    strip.appendChild(trackWrap)
    strip.appendChild(valueSlot)
    strip.appendChild(chevron)
    strip.appendChild(closeBtn)

    const detail = document.createElement("div")
    detail.className = "ml-rt-bitrate__detail"
    const detailInner = document.createElement("div")
    detailInner.className = "ml-rt-bitrate__detail-inner"

    const intro = document.createElement("div")
    intro.className = "ml-rt-bitrate__intro"
    const introTitle = document.createElement("p")
    introTitle.className = "ml-rt-bitrate__intro-title"
    introTitle.textContent = "Realtime stream bitrate"
    const introBody = document.createElement("p")
    introBody.className = "ml-rt-bitrate__intro-body"
    introBody.textContent =
        "This tells the host what target video bitrate (Mbps) to use while you stream so the encoder can scale picture quality. It does not change in-game settings—only how much data the stream uses. " +
        "Recommendation: start from the presets (Performance 20, Balance 40, Quality 80 Mbps). Increase gradually if the picture still looks blocky; decrease if you see stutter, hitching, or disconnects. Prefer wired Ethernet or a very stable link before pushing toward the top of the range."
    intro.appendChild(introTitle)
    intro.appendChild(introBody)

    const detailTop = document.createElement("div")
    detailTop.className = "ml-rt-bitrate__detail-top"
    const bigNum = document.createElement("span")
    bigNum.className = "ml-rt-bitrate__big-num"
    const bigUnit = document.createElement("span")
    bigUnit.className = "ml-rt-bitrate__big-unit"
    bigUnit.textContent = "Mbps"
    const pill = document.createElement("span")
    pill.className = "ml-rt-bitrate__pill"
    detailTop.appendChild(bigNum)
    detailTop.appendChild(bigUnit)
    detailTop.appendChild(pill)

    const presetsRow = document.createElement("div")
    presetsRow.className = "ml-rt-bitrate__presets"
    const presetButtons: HTMLButtonElement[] = []
    for (let i = 0; i < PRESET_MBPS.length; i++) {
        const b = document.createElement("button")
        b.type = "button"
        b.className = "ml-rt-bitrate__preset"
        b.dataset.mbps = String(PRESET_MBPS[i])
        const lines = PRESET_LINES[i]
        b.innerHTML = `<span class="ml-rt-bitrate__preset-k">${lines.mbpsLabel}</span><span class="ml-rt-bitrate__preset-n">${lines.name}</span>`
        b.title = `${lines.mbpsLabel} Mbps — ${lines.name}`
        presetButtons.push(b)
        presetsRow.appendChild(b)
    }

    const hint = document.createElement("p")
    hint.className = "ml-rt-bitrate__hint"

    detailInner.appendChild(intro)
    detailInner.appendChild(detailTop)
    detailInner.appendChild(presetsRow)
    detailInner.appendChild(hint)
    detail.appendChild(detailInner)

    root.appendChild(strip)
    root.appendChild(detail)

    function setTierClass(tier: TierId) {
        root.classList.remove(
            "ml-rt-bitrate--tier-warning",
            "ml-rt-bitrate--tier-info",
            "ml-rt-bitrate--tier-success",
            "ml-rt-bitrate--tier-accent",
        )
        root.classList.add(`ml-rt-bitrate--tier-${tier}`)
    }

    function mbpsToInputFieldString(mbps: number): string {
        const k = Math.round(mbps * 1000)
        if (k % KBPS_PER_STEP === 0) {
            return String(k / 1000)
        }
        const rounded = Math.round(mbps * 1000) / 1000
        return String(rounded)
    }

    function applyVisuals(mbps: number) {
        lastValue = mbps
        range.value = String(mbps)
        const pct = ((mbps - RT_BITRATE_MIN) / (RT_BITRATE_MAX - RT_BITRATE_MIN)) * 100
        fill.style.width = `${Math.min(100, Math.max(0, pct))}%`
        const idx = tierIndexForValue(mbps)
        const def = TIER_DEFS[idx]
        setTierClass(def.id)
        tierLabel.textContent = def.label
        pill.textContent = def.fullLabel
        hint.textContent = def.hint
        bigNum.textContent = formatStreamBitrateMbpsNumber(mbps)
        root.setAttribute("aria-valuetext", `${formatStreamBitrateMbpsDisplay(mbps)}, ${def.label}`)
        valueDisplay.innerHTML = `${formatStreamBitrateMbpsNumber(mbps)}<span class="ml-rt-bitrate__value-unit">Mbps</span>`
        const snappedPresets = PRESET_MBPS.map((p) => snapBitrateMbps(p))
        for (let i = 0; i < presetButtons.length; i++) {
            const match = mbps === snappedPresets[i]
            presetButtons[i].classList.toggle("is-active", match)
        }
    }

    function update(mbps: number) {
        applyVisuals(snapBitrateMbps(mbps))
        if (!editingValue) {
            valueInput.value = mbpsToInputFieldString(lastValue)
        }
    }

    function applyFromUser(mbps: number, source: "overlaySlider" | "preset") {
        const snapped = snapBitrateMbps(mbps)
        applyVisuals(snapped)
        valueInput.value = mbpsToInputFieldString(snapped)
        onBitrateChange(snapped, source)
    }

    function closeEditor(commit: boolean) {
        if (!editingValue) return
        editingValue = false
        root.classList.remove("ml-rt-bitrate--editing")
        valueDisplay.setAttribute("aria-hidden", "false")
        valueInput.setAttribute("aria-hidden", "true")
        if (commit) {
            const rawMbps = Number.parseFloat(valueInput.value)
            if (!Number.isFinite(rawMbps)) {
                applyVisuals(lastValue)
                valueInput.value = mbpsToInputFieldString(lastValue)
                return
            }
            applyFromUser(rawMbps, "overlaySlider")
        } else {
            applyVisuals(editSnapshot)
            valueInput.value = mbpsToInputFieldString(lastValue)
        }
    }

    function openEditor() {
        if (range.disabled) return
        editingValue = true
        editSnapshot = lastValue
        root.classList.add("ml-rt-bitrate--editing")
        valueDisplay.setAttribute("aria-hidden", "true")
        valueInput.setAttribute("aria-hidden", "false")
        valueInput.value = mbpsToInputFieldString(lastValue)
        requestAnimationFrame(() => {
            valueInput.focus()
            valueInput.select()
        })
    }

    range.addEventListener("input", () => {
        const v = Number.parseFloat(range.value)
        if (!Number.isFinite(v)) return
        const snapped = snapBitrateMbps(v)
        range.value = String(snapped)
        applyVisuals(snapped)
        valueInput.value = mbpsToInputFieldString(snapped)
        onBitrateChange(snapped, "overlaySlider")
    })

    valueDisplay.addEventListener("pointerdown", (e) => {
        e.stopPropagation()
        if (range.disabled) return
        e.preventDefault()
        openEditor()
    })
    valueDisplay.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            openEditor()
        }
    })

    valueInput.addEventListener("keydown", (e) => {
        e.stopPropagation()
        if (e.key === "Enter") {
            e.preventDefault()
            closeEditor(true)
        } else if (e.key === "Escape") {
            e.preventDefault()
            closeEditor(false)
        }
    })
    valueSlot.addEventListener("focusout", (e) => {
        if (!editingValue) return
        const next = e.relatedTarget
        if (next instanceof Node && valueSlot.contains(next)) return
        closeEditor(true)
    })
    valueInput.addEventListener("pointerdown", (e) => e.stopPropagation())

    chevron.addEventListener("click", () => {
        if (range.disabled) return
        expanded = !expanded
        root.classList.toggle("ml-rt-bitrate--expanded", expanded)
        chevron.setAttribute("aria-expanded", expanded ? "true" : "false")
    })

    closeBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        onCloseRequested?.()
    })

    for (const b of presetButtons) {
        b.addEventListener("click", () => {
            if (range.disabled) return
            const v = Number.parseFloat(b.dataset.mbps ?? "")
            if (!Number.isFinite(v)) return
            applyFromUser(v, "preset")
        })
    }

    function setDisabled(disabled: boolean) {
        range.disabled = disabled
        root.classList.toggle("ml-rt-bitrate--disabled", disabled)
        root.toggleAttribute("aria-disabled", disabled)
        if (disabled) {
            expanded = false
            root.classList.remove("ml-rt-bitrate--expanded", "ml-rt-bitrate--editing")
            chevron.setAttribute("aria-expanded", "false")
            closeEditor(false)
        }
    }

    valueInput.setAttribute("aria-hidden", "true")
    applyVisuals(lastValue)

    return { root, range, update, setDisabled }
}
