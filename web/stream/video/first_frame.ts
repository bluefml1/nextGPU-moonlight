/** Bubbling DOM event a renderer fires on its own element once the first video frame is on screen. */
export const FIRST_VIDEO_FRAME_EVENT = "ml-first-video-frame"

export function notifyFirstVideoFrame(el: HTMLElement) {
    el.dispatchEvent(new Event(FIRST_VIDEO_FRAME_EVENT, { bubbles: true }))
}

type VideoFrameCallbackElement = HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number
}

/** Notify once when a `<video>` element presents (or at least decodes) its first frame. */
export function watchVideoElementFirstFrame(video: HTMLVideoElement) {
    let notified = false
    const notify = () => {
        if (notified) return
        notified = true
        video.removeEventListener("loadeddata", onLoadedData)
        notifyFirstVideoFrame(video)
    }
    const onLoadedData = () => {
        if (video.videoWidth > 0) notify()
    }

    video.addEventListener("loadeddata", onLoadedData)
    const frameCallbackVideo = video as VideoFrameCallbackElement
    if (typeof frameCallbackVideo.requestVideoFrameCallback == "function") {
        frameCallbackVideo.requestVideoFrameCallback(notify)
    }
}
