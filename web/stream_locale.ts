import type { StreamProfileId } from "./stream_profile_presets.js"

export type StreamLocale = "vi" | "en"

const STORAGE_KEY = "mlStreamLocale"

const CATALOG: Record<StreamLocale, Record<string, string>> = {
    en: {
        "gate.title": "Choose streaming mode",
        "gate.subtitle.prefix": "Based on your current network speed, NextGPU recommends:",
        "gate.subtitle.loading": "Checking your connection speed…",
        "gate.subtitle.withSpeed": "Based on your current network speed ({mbps} Mbps), NextGPU recommends:",
        "gate.subtitle.noSpeed": "No speed test data yet. NextGPU recommends:",
        "gate.badge.recommended": "Recommended",
        "gate.badge.aria": "Recommended mode",
        "gate.lang.vn": "VN",
        "gate.lang.en": "EN",
        "gate.lang.aria": "Language",
        "gate.kbd": "Key {n}",
        "gate.profile.performance.title": "Performance",
        "gate.profile.performance.desc":
            "Stream Full HD (1080p), light and smooth — suitable for weaker networks or mid-range devices. You can adjust bitrate from 10 to 50 Mbps.",
        "gate.profile.performance.tagline": "Full HD · 120 FPS · default 20 Mbps",
        "gate.profile.balance.title": "Balanced",
        "gate.profile.balance.desc":
            "Stream 2K (1440p) — balance sharpness and latency. Suitable for most users. Bitrate from 10 to 70 Mbps.",
        "gate.profile.balance.tagline": "2K · 120 FPS · default 40 Mbps",
        "gate.profile.quality.title": "Quality",
        "gate.profile.quality.desc":
            "Stream 4K, sharpest image — use when the network is stable (wired or strong Wi‑Fi). Bitrate from 10 to 120 Mbps.",
        "gate.profile.quality.tagline": "4K · 120 FPS · default 60 Mbps",

        "loading.title": "Connecting to {name}",
        "loading.title.generic": "Connecting…",
        "loading.subtitle": "Establishing stream",

        "bootstrap.initFailed": "Unable to initialize the interface.",
        "bootstrap.missingIds": "Missing host or application identifier.",
        "bootstrap.audioFailed": "Failed to find supported audio player — audio is missing.",

        "recovery.title": "Connection Interrupted",
        "recovery.bodyDefault": "The streaming session was interrupted.",
        "recovery.retry": "Retry Connection",
        "recovery.settings": "Open Stream Settings",
        "recovery.exit": "Close Page",
        "recovery.streamFailed":
            "The stream could not be established or was terminated. Retry to reconnect using the current configuration.",
        "recovery.connectionLost":
            "Connection was lost. Retry to reconnect, or open stream settings to adjust transport and quality.",
        "recovery.disconnected":
            "The session has been disconnected. Retry to reconnect or close this page.",

        "modal.connecting": "Connecting",
        "modal.connectionComplete": "Connection Complete",
        "modal.viewLogs": "View Logs",
        "modal.hideLogs": "Hide Logs",
        "modal.close": "Close",
        "modal.serverPrefix": "Server: {message}",

        "devLog.title": "Connection log",
        "devLog.showLogs": "Show logs",
        "devLog.hideLogs": "Hide logs",
        "devLog.hide": "Hide",
        "devLog.connectionComplete": "Connection complete",

        "pointerLock.unsupported": "Pointer Lock not supported",
        "pointerLock.relock":
            "Tap, click, scroll, or press a key to lock mouse",

        "upload.title": "Upload Status",
        "upload.done": "Upload \"{file}\" complete — check the file on the desktop",

        "toast.bitrate.sent": "Bitrate {mbps} — sent ({via})",
        "toast.bitrate.applied": "Bitrate {mbps} — applied",
        "toast.bitrate.rejected": "Bitrate {mbps} — not applied ({reason})",
        "toast.via.preset": "Preset",
        "toast.via.slider": "Slider",

        "hud.quality": "Quality",
        "hud.stats": "Stats",

        "bitrateHud.aria.group": "Stream bitrate",
        "bitrateHud.aria.range": "Stream bitrate while streaming",
        "bitrateHud.aria.edit": "Edit bitrate value",
        "bitrateHud.aria.bitrateMbps": "Bitrate Mbps",
        "bitrateHud.aria.toggleDetail": "Toggle bitrate details",
        "bitrateHud.aria.hide": "Hide realtime bitrate control",
        "bitrateHud.aria.apply": "Apply bitrate and restart stream",
        "bitrateHud.title": "Realtime stream bitrate",
        "bitrateHud.intro":
            "Adjust target video bitrate (Mbps) for this profile's allowed range. Changes take effect after you click Apply, which restarts the stream with the new bitrate (you will not be asked to pick a profile again). Use Min, Default, or Max presets, or drag the slider, then Apply. Decrease if you see stutter or disconnects.",
        "bitrateHud.apply": "Apply",
        "bitrateHud.unit.mbps": "Mbps",
        "bitrateHud.preset.min": "Min",
        "bitrateHud.preset.default": "Default",
        "bitrateHud.preset.max": "Max",
        "bitrateHud.tier.warning.label": "Low",
        "bitrateHud.tier.warning.fullLabel": "Lower bandwidth",
        "bitrateHud.tier.warning.hint":
            "Toward the minimum for this profile. Increase if the image looks blocky.",
        "bitrateHud.tier.info.label": "Mid-low",
        "bitrateHud.tier.info.fullLabel": "Below default",
        "bitrateHud.tier.info.hint":
            "Below the profile default. Good when the network is uneven.",
        "bitrateHud.tier.success.label": "Mid-high",
        "bitrateHud.tier.success.fullLabel": "Above default",
        "bitrateHud.tier.success.hint":
            "Above the profile default. Use when the picture still looks soft.",
        "bitrateHud.tier.accent.label": "High",
        "bitrateHud.tier.accent.fullLabel": "Near maximum",
        "bitrateHud.tier.accent.hint":
            "Near the top of this profile's range. Prefer a stable wired link.",

        "stats.title": "Stream Stats",
        "stats.connectionState": "Connection State",
        "stats.status": "Status",
        "stats.fps": "FPS",
        "stats.latency": "Latency",
        "stats.videoCodec": "Video Codec",
        "stats.resolution": "Resolution",
        "stats.jitter": "Jitter",
        "stats.loss": "Loss",
        "stats.targetBitrate": "Target bitrate",
        "stats.bitrate": "Bitrate",
        "stats.na": "N/A",
        "stats.quality.veryBad": "Very Bad",
        "stats.quality.bad": "Bad",
        "stats.quality.normal": "Normal",
        "stats.quality.good": "Good",
        "stats.quality.veryGood": "Very Good",

        "log.tryingWebrtc": "Trying WebRTC transport",
        "log.tryingWebsocket": "Trying Web Socket transport",
        "log.webrtcFailedFallback":
            "Failed to establish WebRTC connection. Falling back to Web Socket transport.",
        "log.allTransportsFailed":
            "Tried all configured transport options but no connection was possible",
        "log.noVideoPipelineCodec":
            "No video pipeline was found for the codec that was specified. If you're unsure which codecs are supported use H264.",
        "log.noVideoPipelineStart":
            "Failed to start stream because no video pipeline with support for the specified codec was found!",
        "log.noVideoFormat":
            "Couldn't find any supported video format. Change the codec option to H264 in the settings if you're unsure which codecs are supported.",
        "log.connectionTerminated": "ConnectionTerminated with code {code}",
        "log.wsOpen": "Web Socket Open",
        "log.wsClosed": "Web Socket Closed",
        "log.wsOrWebrtcError": "Web Socket or WebRtcPeer Error",
        "log.usingTransport": "Using transport: {transport}",
        "log.usingVideoPipeline": "Using video pipeline: {name}",
        "log.usingAudioPipeline": "Using audio pipeline: {name}",
        "log.hdrWaiting": "HDR requested by user, waiting for host confirmation...",
        "log.videoFormatNotFound": "Video Format {format} was not found! Couldn't start stream!",
        "log.failedSetupVideoNoTransport": "Failed to setup video without transport",
        "log.failedSetupAudioNoTransport": "Failed to setup audio without transport",
        "log.forceVideoElementWebrtcOnly":
            "The option Force Video Element Renderer is currently only supported with WebRTC",
        "log.mediaSourceLatency":
            "The stream may experience increased latency, as modern browser APIs are not currently supported.",
        "log.av1NotImplemented": "Av1 stream translator is not implemented currently!",
        "log.wsTransportNoVideo": "Cannot use Web Socket Transport: Found no supported video pipeline",
        "log.wsTransportNoAudio": "Cannot use Web Socket Transport: Found no supported audio pipeline",
        "log.peerState": "Changing Peer State to {state}",
        "log.connectionStatus": "Connection status: {status}",
    },
    vi: {
        "gate.title": "Chọn chế độ stream",
        "gate.subtitle.prefix": "Dựa trên tốc độ mạng hiện tại của bạn, NextGPU đề xuất:",
        "gate.subtitle.loading": "Đang kiểm tra tốc độ kết nối…",
        "gate.subtitle.withSpeed": "Dựa trên tốc độ mạng hiện tại của bạn ({mbps} Mbps), NextGPU đề xuất:",
        "gate.subtitle.noSpeed": "Chưa có dữ liệu speed test. NextGPU đề xuất:",
        "gate.badge.recommended": "Đề xuất",
        "gate.badge.aria": "Chế độ đề xuất",
        "gate.lang.vn": "VN",
        "gate.lang.en": "EN",
        "gate.lang.aria": "Ngôn ngữ",
        "gate.kbd": "Phím {n}",
        "gate.profile.performance.title": "Hiệu năng",
        "gate.profile.performance.desc":
            "Stream Full HD (1080p), nhẹ và mượt — phù hợp mạng yếu hoặc máy cấu hình vừa. Bạn có thể chỉnh bitrate từ 10 đến 50 Mbps.",
        "gate.profile.performance.tagline": "Full HD · 120 FPS · mặc định 20 Mbps",
        "gate.profile.balance.title": "Cân bằng",
        "gate.profile.balance.desc":
            "Stream 2K (1440p) — cân bằng độ nét và độ trễ. Phù hợp đa số người dùng. Bitrate từ 10 đến 70 Mbps.",
        "gate.profile.balance.tagline": "2K · 120 FPS · mặc định 40 Mbps",
        "gate.profile.quality.title": "Chất lượng",
        "gate.profile.quality.desc":
            "Stream 4K, hình ảnh nét nhất — nên dùng khi mạng ổn định (có dây hoặc Wi‑Fi mạnh). Bitrate từ 10 đến 120 Mbps.",
        "gate.profile.quality.tagline": "4K · 120 FPS · mặc định 60 Mbps",

        "loading.title": "Đang kết nối {name}",
        "loading.title.generic": "Đang kết nối…",
        "loading.subtitle": "Đang thiết lập stream",

        "bootstrap.initFailed": "Không thể khởi tạo giao diện.",
        "bootstrap.missingIds": "Thiếu mã máy chủ hoặc ứng dụng.",
        "bootstrap.audioFailed": "Không tìm thấy trình phát âm thanh được hỗ trợ — không có âm thanh.",

        "recovery.title": "Mất kết nối",
        "recovery.bodyDefault": "Phiên stream đã bị gián đoạn.",
        "recovery.retry": "Thử kết nối lại",
        "recovery.settings": "Mở cài đặt stream",
        "recovery.exit": "Đóng trang",
        "recovery.streamFailed":
            "Không thể thiết lập hoặc stream đã bị dừng. Hãy thử kết nối lại với cấu hình hiện tại.",
        "recovery.connectionLost":
            "Mất kết nối. Hãy thử lại hoặc mở cài đặt stream để điều chỉnh transport và chất lượng.",
        "recovery.disconnected":
            "Phiên đã ngắt kết nối. Hãy thử kết nối lại hoặc đóng trang này.",

        "modal.connecting": "Đang kết nối",
        "modal.connectionComplete": "Kết nối hoàn tất",
        "modal.viewLogs": "Xem nhật ký",
        "modal.hideLogs": "Ẩn nhật ký",
        "modal.close": "Đóng",
        "modal.serverPrefix": "Máy chủ: {message}",

        "devLog.title": "Nhật ký kết nối",
        "devLog.showLogs": "Hiện nhật ký",
        "devLog.hideLogs": "Ẩn nhật ký",
        "devLog.hide": "Ẩn",
        "devLog.connectionComplete": "Kết nối hoàn tất",

        "pointerLock.unsupported": "Trình duyệt không hỗ trợ Pointer Lock",
        "pointerLock.relock":
            "Chạm, nhấp, cuộn hoặc nhấn phím để khóa chuột",

        "upload.title": "Trạng thái tải lên",
        "upload.done": "Đã tải lên \"{file}\" — kiểm tra tệp trên màn hình Desktop",

        "toast.bitrate.sent": "Bitrate {mbps} — đã gửi ({via})",
        "toast.bitrate.applied": "Bitrate {mbps} — đã áp dụng",
        "toast.bitrate.rejected": "Bitrate {mbps} — chưa áp dụng ({reason})",
        "toast.via.preset": "Cài đặt sẵn",
        "toast.via.slider": "Thanh trượt",

        "hud.quality": "Chất lượng",
        "hud.stats": "Thống kê",

        "bitrateHud.aria.group": "Bitrate stream",
        "bitrateHud.aria.range": "Bitrate stream khi đang phát",
        "bitrateHud.aria.edit": "Chỉnh giá trị bitrate",
        "bitrateHud.aria.bitrateMbps": "Bitrate Mbps",
        "bitrateHud.aria.toggleDetail": "Mở/đóng chi tiết bitrate",
        "bitrateHud.aria.hide": "Ẩn điều khiển bitrate",
        "bitrateHud.aria.apply": "Áp dụng bitrate và khởi động lại stream",
        "bitrateHud.title": "Bitrate stream thời gian thực",
        "bitrateHud.intro":
            "Điều chỉnh bitrate video mục tiêu (Mbps) trong phạm vi của hồ sơ này. Thay đổi có hiệu lực sau khi bạn nhấn Áp dụng — stream sẽ khởi động lại với bitrate mới (bạn sẽ không phải chọn lại hồ sơ). Dùng Min, Mặc định hoặc Max, hoặc kéo thanh trượt rồi Áp dụng. Giảm nếu bị giật hoặc mất kết nối.",
        "bitrateHud.apply": "Áp dụng",
        "bitrateHud.unit.mbps": "Mbps",
        "bitrateHud.preset.min": "Min",
        "bitrateHud.preset.default": "Mặc định",
        "bitrateHud.preset.max": "Max",
        "bitrateHud.tier.warning.label": "Thấp",
        "bitrateHud.tier.warning.fullLabel": "Băng thông thấp",
        "bitrateHud.tier.warning.hint":
            "Gần mức tối thiểu của hồ sơ. Tăng nếu hình bị vỡ khối.",
        "bitrateHud.tier.info.label": "Trung thấp",
        "bitrateHud.tier.info.fullLabel": "Dưới mặc định",
        "bitrateHud.tier.info.hint":
            "Dưới mặc định của hồ sơ. Phù hợp khi mạng không ổn định.",
        "bitrateHud.tier.success.label": "Trung cao",
        "bitrateHud.tier.success.fullLabel": "Trên mặc định",
        "bitrateHud.tier.success.hint":
            "Trên mặc định của hồ sơ. Dùng khi hình vẫn còn mờ.",
        "bitrateHud.tier.accent.label": "Cao",
        "bitrateHud.tier.accent.fullLabel": "Gần tối đa",
        "bitrateHud.tier.accent.hint":
            "Gần mức tối đa của hồ sơ. Nên dùng kết nối có dây ổn định.",

        "stats.title": "Thống kê stream",
        "stats.connectionState": "Trạng thái kết nối",
        "stats.status": "Tình trạng",
        "stats.fps": "FPS",
        "stats.latency": "Độ trễ",
        "stats.videoCodec": "Codec video",
        "stats.resolution": "Độ phân giải",
        "stats.jitter": "Jitter",
        "stats.loss": "Mất gói",
        "stats.targetBitrate": "Bitrate mục tiêu",
        "stats.bitrate": "Bitrate",
        "stats.na": "N/A",
        "stats.quality.veryBad": "Rất kém",
        "stats.quality.bad": "Kém",
        "stats.quality.normal": "Bình thường",
        "stats.quality.good": "Tốt",
        "stats.quality.veryGood": "Rất tốt",

        "log.tryingWebrtc": "Đang thử transport WebRTC",
        "log.tryingWebsocket": "Đang thử transport Web Socket",
        "log.webrtcFailedFallback":
            "Không thể thiết lập WebRTC. Chuyển sang transport Web Socket.",
        "log.allTransportsFailed":
            "Đã thử mọi transport nhưng không thể kết nối",
        "log.noVideoPipelineCodec":
            "Không tìm thấy pipeline video cho codec đã chọn. Nếu không chắc, hãy dùng H264 trong cài đặt.",
        "log.noVideoPipelineStart":
            "Không thể bắt đầu stream vì không có pipeline video hỗ trợ codec đã chọn!",
        "log.noVideoFormat":
            "Không tìm thấy định dạng video được hỗ trợ. Hãy đổi codec sang H264 trong cài đặt nếu không chắc codec nào được hỗ trợ.",
        "log.connectionTerminated": "Kết nối bị ngắt với mã {code}",
        "log.wsOpen": "Web Socket đã mở",
        "log.wsClosed": "Web Socket đã đóng",
        "log.wsOrWebrtcError": "Lỗi Web Socket hoặc WebRtcPeer",
        "log.usingTransport": "Đang dùng transport: {transport}",
        "log.usingVideoPipeline": "Pipeline video: {name}",
        "log.usingAudioPipeline": "Pipeline âm thanh: {name}",
        "log.hdrWaiting": "Đã yêu cầu HDR, đang chờ xác nhận từ máy chủ...",
        "log.videoFormatNotFound": "Không tìm thấy định dạng video {format}! Không thể bắt đầu stream!",
        "log.failedSetupVideoNoTransport": "Không thể thiết lập video khi chưa có transport",
        "log.failedSetupAudioNoTransport": "Không thể thiết lập âm thanh khi chưa có transport",
        "log.forceVideoElementWebrtcOnly":
            "Tùy chọn Force Video Element Renderer hiện chỉ hỗ trợ với WebRTC",
        "log.mediaSourceLatency":
            "Stream có thể tăng độ trễ vì trình duyệt chưa hỗ trợ đầy đủ API hiện đại.",
        "log.av1NotImplemented": "Bộ dịch stream Av1 chưa được triển khai!",
        "log.wsTransportNoVideo": "Không dùng được Web Socket: không có pipeline video phù hợp",
        "log.wsTransportNoAudio": "Không dùng được Web Socket: không có pipeline âm thanh phù hợp",
        "log.peerState": "Trạng thái Peer đổi thành {state}",
        "log.connectionStatus": "Trạng thái kết nối: {status}",
    },
}

/** English log line → catalog key for auto-localization in Logger. */
const EN_LOG_TO_KEY: Record<string, string> = {
    "Trying WebRTC transport": "log.tryingWebrtc",
    "Trying Web Socket transport": "log.tryingWebsocket",
    "Failed to establish WebRTC connection. Falling back to Web Socket transport.":
        "log.webrtcFailedFallback",
    "Tried all configured transport options but no connection was possible":
        "log.allTransportsFailed",
    "No video pipeline was found for the codec that was specified. If you're unsure which codecs are supported use H264.":
        "log.noVideoPipelineCodec",
    "Failed to start stream because no video pipeline with support for the specified codec was found!":
        "log.noVideoPipelineStart",
    "Couldn't find any supported video format. Change the codec option to H264 in the settings if you're unsure which codecs are supported.":
        "log.noVideoFormat",
    "Web Socket Open": "log.wsOpen",
    "Web Socket Closed": "log.wsClosed",
    "Web Socket or WebRtcPeer Error": "log.wsOrWebrtcError",
    "HDR requested by user, waiting for host confirmation...": "log.hdrWaiting",
    "Failed to setup video without transport": "log.failedSetupVideoNoTransport",
    "Failed to setup audio without transport": "log.failedSetupAudioNoTransport",
    "The option Force Video Element Renderer is currently only supported with WebRTC":
        "log.forceVideoElementWebrtcOnly",
    "The stream may experience increased latency, as modern browser APIs are not currently supported.":
        "log.mediaSourceLatency",
    "Av1 stream translator is not implemented currently!": "log.av1NotImplemented",
    "Cannot use Web Socket Transport: Found no supported video pipeline":
        "log.wsTransportNoVideo",
    "Cannot use Web Socket Transport: Found no supported audio pipeline":
        "log.wsTransportNoAudio",
    "Failed to find supported audio player -> audio is missing.": "bootstrap.audioFailed",
}

const EN_LOG_PREFIX_KEYS: { prefix: string; key: string }[] = [
    { prefix: "Using transport: ", key: "log.usingTransport" },
    { prefix: "Using video pipeline: ", key: "log.usingVideoPipeline" },
    { prefix: "Using audio pipeline: ", key: "log.usingAudioPipeline" },
    { prefix: "ConnectionTerminated with code ", key: "log.connectionTerminated" },
    { prefix: "Video Format ", key: "log.videoFormatNotFound" },
    { prefix: "Changing Peer State to ", key: "log.peerState" },
    { prefix: "Connection status: ", key: "log.connectionStatus" },
]

function formatTemplate(
    template: string,
    params?: Record<string, string | number>,
): string {
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (_, name: string) => {
        const v = params[name]
        return v != null ? String(v) : `{${name}}`
    })
}

export function detectStreamLocale(): StreamLocale {
    const candidates = [navigator.language, ...(navigator.languages ?? [])]
    for (const raw of candidates) {
        const base = raw.toLowerCase().split("-")[0]
        if (base === "vi") return "vi"
        if (base === "en") return "en"
    }
    return "en"
}

export function getStreamLocale(): StreamLocale {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored === "vi" || stored === "en") return stored
    } catch {
        /* private mode */
    }
    return detectStreamLocale()
}

export function setStreamLocale(locale: StreamLocale): void {
    try {
        localStorage.setItem(STORAGE_KEY, locale)
    } catch {
        /* ignore */
    }
}

export function streamT(
    key: string,
    params?: Record<string, string | number>,
    locale?: StreamLocale,
): string {
    const loc = locale ?? getStreamLocale()
    const table = CATALOG[loc]
    const template = table[key] ?? CATALOG.en[key] ?? key
    return formatTemplate(template, params)
}

export function streamDebugLine(
    key: string,
    params?: Record<string, string | number>,
    locale?: StreamLocale,
): string {
    return streamT(key, params, locale)
}

export function gateProfileTitle(
    id: StreamProfileId,
    locale?: StreamLocale,
): string {
    return streamT(`gate.profile.${id}.title`, undefined, locale)
}

export function localizeStreamLogMessage(message: string): string {
    if (getStreamLocale() === "en") return message

    const exactKey = EN_LOG_TO_KEY[message]
    if (exactKey) return streamDebugLine(exactKey)

    for (const { prefix, key } of EN_LOG_PREFIX_KEYS) {
        if (!message.startsWith(prefix)) continue
        const rest = message.slice(prefix.length)
        if (key === "log.connectionTerminated") {
            return streamDebugLine(key, { code: rest })
        }
        if (key === "log.videoFormatNotFound") {
            const m = rest.match(/^(.+) was not found! Couldn't start stream!$/)
            if (m) return streamDebugLine(key, { format: m[1] })
        }
        if (key === "log.usingTransport") {
            return streamDebugLine(key, { transport: rest })
        }
        if (key === "log.usingVideoPipeline" || key === "log.usingAudioPipeline") {
            return streamDebugLine(key, { name: rest })
        }
        if (key === "log.peerState") {
            return streamDebugLine(key, { state: rest })
        }
        if (key === "log.connectionStatus") {
            return streamDebugLine(key, { status: rest })
        }
    }

    return message
}

/** Match a user-visible log line against a catalog key in either locale. */
export function streamLogMatches(message: string, key: string): boolean {
    const trimmed = message.trim()
    return (
        trimmed === streamDebugLine(key, undefined, "en") ||
        trimmed === streamDebugLine(key, undefined, "vi")
    )
}

/** True if message starts with the localized template for key (before dynamic suffix). */
export function streamLogStartsWith(message: string, key: string): boolean {
    for (const loc of ["en", "vi"] as const) {
        const prefix = streamT(key, undefined, loc).replace(/\{\w+\}/g, "")
        if (message.startsWith(prefix)) return true
    }
    return false
}

export type { StreamProfileRecommendation } from "./profile_recommendation.js"
export { fetchRecommendedProfile } from "./profile_recommendation.js"
