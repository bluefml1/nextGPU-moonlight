/** Stream overlay bitrate HUD — profile-scoped range, preview slider, Apply restarts stream. */

import {
    RT_BITRATE_STEP,
    snapBitrateMbpsForTier,
    type StreamProfileBitrateTier,
} from "../stream_profile_presets.js"
import { streamT } from "../stream_locale.js"

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
    labelKey: string
    fullLabelKey: string
    hintKey: string
}

const TIER_DEFS: TierDef[] = [
    { id: "warning", labelKey: "bitrateHud.tier.warning.label", fullLabelKey: "bitrateHud.tier.warning.fullLabel", hintKey: "bitrateHud.tier.warning.hint" },
    { id: "info", labelKey: "bitrateHud.tier.info.label", fullLabelKey: "bitrateHud.tier.info.fullLabel", hintKey: "bitrateHud.tier.info.hint" },
    { id: "success", labelKey: "bitrateHud.tier.success.label", fullLabelKey: "bitrateHud.tier.success.fullLabel", hintKey: "bitrateHud.tier.success.hint" },
    { id: "accent", labelKey: "bitrateHud.tier.accent.label", fullLabelKey: "bitrateHud.tier.accent.fullLabel", hintKey: "bitrateHud.tier.accent.hint" },
]

function tierText(def: TierDef): { label: string; fullLabel: string; hint: string } {
    return {
        label: streamT(def.labelKey),
        fullLabel: streamT(def.fullLabelKey),
        hint: streamT(def.hintKey),
    }
}

function tierIndexForValue(mbps: number, minMbps: number, maxMbps: number): 0 | 1 | 2 | 3 {
    const span = maxMbps - minMbps
    if (span <= 0) return 0
    const t = (mbps - minMbps) / span
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
    setCommitted: (mbps: number) => void
    setBounds: (tier: StreamProfileBitrateTier) => void
    setApplyBusy: (busy: boolean) => void
    getPendingMbps: () => number
    getCommittedMbps: () => number
    revertToCommitted: () => void
}

export type CreateRealtimeBitrateHudOptions = {
    minMbps: number
    maxMbps: number
    defaultMbps: number
    committedMbps: number
    onPendingChange?: (mbps: number) => void
    onDirtyChange?: (dirty: boolean) => void
    onCloseRequested?: () => void
}

export function createRealtimeBitrateHud(options: CreateRealtimeBitrateHudOptions): RealtimeBitrateHud {
    const { onPendingChange, onDirtyChange, onCloseRequested } = options

    let tier: StreamProfileBitrateTier = {
        minMbps: options.minMbps,
        maxMbps: options.maxMbps,
        defaultMbps: options.defaultMbps,
    }

    function snap(mbps: number): number {
        return snapBitrateMbpsForTier(mbps, tier)
    }

    let committedMbps = snap(options.committedMbps)
    let pendingMbps = committedMbps
    let expanded = false
    let editingValue = false
    let editSnapshot = pendingMbps
    let applyBusy = false

    const root = document.createElement("div")
    root.className = "ml-rt-bitrate"
    root.setAttribute("role", "group")
    root.setAttribute("aria-label", streamT("bitrateHud.aria.group"))

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
    range.min = String(tier.minMbps)
    range.max = String(tier.maxMbps)
    range.step = String(RT_BITRATE_STEP)
    range.title = streamT("bitrateHud.aria.range")
    range.setAttribute("aria-label", streamT("bitrateHud.aria.range"))
    range.disabled = true

    trackWrap.appendChild(track)
    trackWrap.appendChild(range)
    range.addEventListener("pointerdown", (e) => e.stopPropagation())

    const valueSlot = document.createElement("div")
    valueSlot.className = "ml-rt-bitrate__value-slot"
    const valueInput = document.createElement("input")
    valueInput.type = "number"
    valueInput.className = "ml-rt-bitrate__value-input"
    valueInput.min = String(tier.minMbps)
    valueInput.max = String(tier.maxMbps)
    valueInput.step = String(RT_BITRATE_STEP)
    valueInput.setAttribute("inputmode", "decimal")
    valueInput.setAttribute("autocomplete", "off")
    valueInput.setAttribute("aria-label", streamT("bitrateHud.aria.bitrateMbps"))
    valueInput.readOnly = true
    const valueUnit = document.createElement("span")
    valueUnit.className = "ml-rt-bitrate__value-unit"
    valueUnit.textContent = streamT("bitrateHud.unit.mbps")
    valueUnit.setAttribute("aria-hidden", "true")
    valueSlot.appendChild(valueInput)
    valueSlot.appendChild(valueUnit)

    const chevron = document.createElement("button")
    chevron.type = "button"
    chevron.className = "ml-rt-bitrate__chevron"
    chevron.setAttribute("aria-expanded", "false")
    chevron.setAttribute("aria-label", streamT("bitrateHud.aria.toggleDetail"))
    chevron.title = streamT("bitrateHud.aria.toggleDetail")
    chevron.innerHTML =
        '<svg class="ml-rt-bitrate__chevron-icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="M2 4l4 4 4-4H2z"/></svg>'

    const closeBtn = document.createElement("button")
    closeBtn.type = "button"
    closeBtn.className = "ml-rt-bitrate__close"
    closeBtn.setAttribute("aria-label", streamT("bitrateHud.aria.hide"))
    closeBtn.title = streamT("bitrateHud.aria.hide")
    closeBtn.textContent = "×"

    let draggingRange = false

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
    introTitle.textContent = streamT("bitrateHud.title")
    const introBody = document.createElement("p")
    introBody.className = "ml-rt-bitrate__intro-body"
    introBody.textContent = streamT("bitrateHud.intro")
    intro.appendChild(introTitle)
    intro.appendChild(introBody)

    const detailTop = document.createElement("div")
    detailTop.className = "ml-rt-bitrate__detail-top"
    const bigNum = document.createElement("span")
    bigNum.className = "ml-rt-bitrate__big-num"
    const bigUnit = document.createElement("span")
    bigUnit.className = "ml-rt-bitrate__big-unit"
    bigUnit.textContent = streamT("bitrateHud.unit.mbps")
    const pill = document.createElement("span")
    pill.className = "ml-rt-bitrate__pill"
    detailTop.appendChild(bigNum)
    detailTop.appendChild(bigUnit)
    detailTop.appendChild(pill)

    const presetsRow = document.createElement("div")
    presetsRow.className = "ml-rt-bitrate__presets"
    const presetButtons: HTMLButtonElement[] = []
    function rebuildPresetButtons() {
        presetsRow.replaceChildren()
        presetButtons.length = 0
        const defs = [
            { mbps: tier.minMbps, label: String(tier.minMbps), sub: streamT("bitrateHud.preset.min") },
            { mbps: tier.defaultMbps, label: String(tier.defaultMbps), sub: streamT("bitrateHud.preset.default") },
            { mbps: tier.maxMbps, label: String(tier.maxMbps), sub: streamT("bitrateHud.preset.max") },
        ]
        for (const def of defs) {
            const b = document.createElement("button")
            b.type = "button"
            b.className = "ml-rt-bitrate__preset"
            b.dataset.mbps = String(def.mbps)
            b.innerHTML = `<span class="ml-rt-bitrate__preset-k">${def.label}</span><span class="ml-rt-bitrate__preset-n">${def.sub}</span>`
            b.title = `${def.label} Mbps — ${def.sub}`
            b.addEventListener("click", () => {
                if (range.disabled || applyBusy) return
                setPendingFromUser(def.mbps)
            })
            presetButtons.push(b)
            presetsRow.appendChild(b)
        }
    }
    rebuildPresetButtons()

    const hint = document.createElement("p")
    hint.className = "ml-rt-bitrate__hint"

    detailInner.appendChild(intro)
    detailInner.appendChild(detailTop)
    detailInner.appendChild(presetsRow)
    detailInner.appendChild(hint)
    detail.appendChild(detailInner)

    root.appendChild(strip)
    root.appendChild(detail)

    function setTierClass(tierId: TierId) {
        root.classList.remove(
            "ml-rt-bitrate--tier-warning",
            "ml-rt-bitrate--tier-info",
            "ml-rt-bitrate--tier-success",
            "ml-rt-bitrate--tier-accent",
        )
        root.classList.add(`ml-rt-bitrate--tier-${tierId}`)
    }

    function syncDirtyState() {
        const dirty = pendingMbps !== committedMbps
        root.classList.toggle("ml-rt-bitrate--pending", dirty)
        onDirtyChange?.(dirty)
    }

    function syncRangeAttrs() {
        range.min = String(tier.minMbps)
        range.max = String(tier.maxMbps)
        valueInput.min = String(tier.minMbps)
        valueInput.max = String(tier.maxMbps)
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
        pendingMbps = mbps
        range.value = String(mbps)
        const span = tier.maxMbps - tier.minMbps
        const pct = span > 0 ? ((mbps - tier.minMbps) / span) * 100 : 0
        fill.style.width = `${Math.min(100, Math.max(0, pct))}%`
        const idx = tierIndexForValue(mbps, tier.minMbps, tier.maxMbps)
        const def = TIER_DEFS[idx]
        const text = tierText(def)
        setTierClass(def.id)
        if (!draggingRange) {
            tierLabel.textContent = text.label
        }
        pill.textContent = text.fullLabel
        hint.textContent = text.hint
        bigNum.textContent = formatStreamBitrateMbpsNumber(mbps)
        root.setAttribute("aria-valuetext", `${formatStreamBitrateMbpsDisplay(mbps)}, ${text.label}`)
        if (!editingValue) {
            valueInput.value = mbpsToInputFieldString(mbps)
        }
        for (let i = 0; i < presetButtons.length; i++) {
            const presetMbps = snap(Number.parseFloat(presetButtons[i].dataset.mbps ?? ""))
            presetButtons[i].classList.toggle("is-active", mbps === presetMbps)
        }
        syncDirtyState()
    }

    function update(mbps: number) {
        applyVisuals(snap(mbps))
        if (!editingValue) {
            valueInput.value = mbpsToInputFieldString(pendingMbps)
        }
    }

    function setPendingFromUser(mbps: number) {
        const snapped = snap(mbps)
        applyVisuals(snapped)
        valueInput.value = mbpsToInputFieldString(snapped)
        onPendingChange?.(snapped)
    }

    function closeEditor(commit: boolean) {
        if (!editingValue) return
        editingValue = false
        valueInput.readOnly = true
        root.classList.remove("ml-rt-bitrate--editing")
        if (commit) {
            const rawMbps = Number.parseFloat(valueInput.value)
            if (!Number.isFinite(rawMbps)) {
                applyVisuals(pendingMbps)
                valueInput.value = mbpsToInputFieldString(pendingMbps)
                return
            }
            setPendingFromUser(rawMbps)
        } else {
            applyVisuals(editSnapshot)
            valueInput.value = mbpsToInputFieldString(pendingMbps)
        }
    }

    function openEditor() {
        if (range.disabled || applyBusy) return
        editingValue = true
        editSnapshot = pendingMbps
        valueInput.readOnly = false
        root.classList.add("ml-rt-bitrate--editing")
        valueInput.value = mbpsToInputFieldString(pendingMbps)
        requestAnimationFrame(() => {
            valueInput.focus()
            valueInput.select()
        })
    }

    function endRangeDrag() {
        if (!draggingRange) return
        draggingRange = false
        root.classList.remove("ml-rt-bitrate--dragging")
        applyVisuals(pendingMbps)
    }

    range.addEventListener("pointerdown", () => {
        if (range.disabled) return
        draggingRange = true
        root.classList.add("ml-rt-bitrate--dragging")
    })
    range.addEventListener("pointerup", () => endRangeDrag())
    range.addEventListener("pointercancel", () => endRangeDrag())

    range.addEventListener("input", () => {
        const v = Number.parseFloat(range.value)
        if (!Number.isFinite(v)) return
        setPendingFromUser(v)
        range.value = String(pendingMbps)
    })

    valueInput.addEventListener("pointerdown", (e) => {
        e.stopPropagation()
        if (range.disabled) return
        if (!valueInput.readOnly) return
        e.preventDefault()
        openEditor()
    })
    valueInput.addEventListener("focus", () => {
        if (range.disabled || applyBusy) return
        if (!valueInput.readOnly) return
        openEditor()
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
    valueInput.addEventListener("focusout", () => {
        if (!editingValue) return
        closeEditor(true)
    })

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

    function setApplyBusy(busy: boolean) {
        applyBusy = busy
        root.classList.toggle("ml-rt-bitrate--apply-busy", busy)
    }

    function revertToCommitted() {
        if (editingValue) {
            closeEditor(false)
        }
        setCommitted(committedMbps)
    }

    function setCommitted(mbps: number) {
        committedMbps = snap(mbps)
        pendingMbps = committedMbps
        applyVisuals(committedMbps)
        if (!editingValue) {
            valueInput.value = mbpsToInputFieldString(committedMbps)
        }
    }

    function setBounds(nextTier: StreamProfileBitrateTier) {
        tier = { ...nextTier }
        syncRangeAttrs()
        rebuildPresetButtons()
        committedMbps = snap(committedMbps)
        pendingMbps = snap(pendingMbps)
        applyVisuals(pendingMbps)
    }

    syncRangeAttrs()
    applyVisuals(committedMbps)

    return {
        root,
        range,
        update,
        setDisabled,
        setCommitted,
        setBounds,
        setApplyBusy,
        getPendingMbps: () => pendingMbps,
        getCommittedMbps: () => committedMbps,
        revertToCommitted,
    }
}
