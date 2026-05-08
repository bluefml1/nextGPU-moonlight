import { showErrorPopup } from "../error.js";

export type SidebarEdge = "left" | "right" | "up" | "down";
export type Sidebar = {
    mount(parent: HTMLElement): void;
    unmount(parent: HTMLElement): void;
};

let sidebarExtended: boolean = false;
const sidebarRoot: HTMLElement | null = document.getElementById("sidebar-root");
const sidebarParent: HTMLElement | null = document.getElementById("sidebar-parent");
const sidebarButton: HTMLElement | null = document.getElementById("sidebar-button");

sidebarButton?.addEventListener("click", toggleSidebar);
let suppressNextSidebarToggle: boolean = false;
let activePointerId: number | null = null;
let dragStartY: number = 0;
let dragStartOffsetY: number = 0;
let isDraggingSidebarButton: boolean = false;
let longPressTimer: number | null = null;
let longPressTriggered = false;
const SIDEBAR_DRAG_OFFSET_STORAGE_KEY = "mlSidebarArrowOffsetY";
const SIDEBAR_MINIMIZED_STORAGE_KEY = "mlSidebarArrowMinimized";
let sidebarDragOffsetY: number = (() => {
    try {
        const raw = localStorage.getItem(SIDEBAR_DRAG_OFFSET_STORAGE_KEY);
        if (raw != null) {
            const parsed = Number.parseFloat(raw);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    } catch {
        // Ignore storage errors.
    }
    const h = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0, 720);
    return Math.round(h * 0.32); // default near bottom-right when edge is right
})();
const DRAG_TOGGLE_SUPPRESS_THRESHOLD_PX: number = 5;
const SIDEBAR_TOUCH_LONG_PRESS_MS = 550;
let sidebarButtonMinimized = false;

sidebarButton?.addEventListener("pointerdown", onSidebarButtonPointerDown);
sidebarButton?.addEventListener("pointermove", onSidebarButtonPointerMove);
sidebarButton?.addEventListener("pointerup", onSidebarButtonPointerUpOrCancel);
sidebarButton?.addEventListener("pointercancel", onSidebarButtonPointerUpOrCancel);
sidebarButton?.addEventListener("lostpointercapture", onSidebarButtonPointerUpOrCancel);
sidebarButton?.addEventListener("contextmenu", onSidebarButtonContextMenu);

window.addEventListener("ml-modal-visibility", () => {
    // Keep sidebar collapsed whenever a modal (e.g. Settings) is opened/closed.
    setSidebarExtended(false);
});
window.addEventListener("ml-modal-visibility", (event: Event) => {
    const customEvent = event as CustomEvent<{ visible?: boolean }>;
    const visible = customEvent?.detail?.visible;
    if (visible === false || visible == null) {
        // Safety: never keep the sidebar opener hidden after modal close.
        sidebarRoot?.classList.remove("sidebar-settings-hidden");
    }
});

let sidebarComponent: any | null = null;

export function setSidebarStyle(style: { edge?: string }): void {
    // Default values
    const edge: string = style.edge ?? "left";
    // Set edge
    sidebarRoot?.classList.remove("sidebar-edge-left", "sidebar-edge-right", "sidebar-edge-up", "sidebar-edge-down");
    sidebarRoot?.classList.add(`sidebar-edge-${edge}`);
}

export function toggleSidebar(): void {
    if (suppressNextSidebarToggle) {
        suppressNextSidebarToggle = false;
        return;
    }
    setSidebarExtended(!isSidebarExtended());
}

function onSidebarButtonPointerDown(event: PointerEvent): void {
    if (!sidebarButton) {
        return;
    }
    activePointerId = event.pointerId;
    dragStartY = event.clientY;
    dragStartOffsetY = sidebarDragOffsetY;
    isDraggingSidebarButton = false;
    longPressTriggered = false;
    sidebarButton.setPointerCapture(event.pointerId);
    if (event.pointerType !== "mouse") {
        if (longPressTimer != null) {
            clearTimeout(longPressTimer);
        }
        longPressTimer = window.setTimeout(() => {
            longPressTimer = null;
            if (activePointerId === event.pointerId && !isDraggingSidebarButton) {
                longPressTriggered = true;
                suppressNextSidebarToggle = true;
                setSidebarButtonMinimized(!sidebarButtonMinimized);
            }
        }, SIDEBAR_TOUCH_LONG_PRESS_MS);
    }
}

function onSidebarButtonPointerMove(event: PointerEvent): void {
    if (activePointerId == null || event.pointerId !== activePointerId) {
        return;
    }
    
    const deltaY: number = event.clientY - dragStartY;

    if (Math.abs(deltaY) > DRAG_TOGGLE_SUPPRESS_THRESHOLD_PX) {
        isDraggingSidebarButton = true;
        suppressNextSidebarToggle = true;
        if (longPressTimer != null) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    if (isDraggingSidebarButton) {
        sidebarDragOffsetY = dragStartOffsetY + deltaY;
        persistSidebarDragOffset();
    }
}

function onSidebarButtonPointerUpOrCancel(event: PointerEvent): void {
    if (activePointerId == null || event.pointerId !== activePointerId) {
        return;
    }

    if (sidebarButton?.hasPointerCapture(event.pointerId)) {
        sidebarButton.releasePointerCapture(event.pointerId);
    }
    if (longPressTimer != null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
    if (longPressTriggered) {
        suppressNextSidebarToggle = true;
    }

    activePointerId = null;
    isDraggingSidebarButton = false;
    longPressTriggered = false;
}

function onSidebarButtonContextMenu(event: MouseEvent): void {
    event.preventDefault();
    setSidebarButtonMinimized(!sidebarButtonMinimized);
}

let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

export function setSidebarExtended(extended: boolean): void {
    const isShownInDom: boolean = !!(sidebarRoot?.classList.contains("sidebar-show"));
    if (extended == sidebarExtended && extended === isShownInDom) {
        return;
    }
    if (extended) {
        sidebarRoot?.classList.add("sidebar-show");
        outsideClickHandler = (e: MouseEvent) => {
            if (sidebarRoot && !sidebarRoot.contains(e.target as Node)) {
                setSidebarExtended(false);
            }
        };
        setTimeout(() => document.addEventListener("mousedown", outsideClickHandler as any, true), 0);
    } else {
        sidebarRoot?.classList.remove("sidebar-show");
        if (outsideClickHandler) {
            document.removeEventListener("mousedown", outsideClickHandler, true);
            outsideClickHandler = null;
        }
    }
    sidebarExtended = extended;
    window.dispatchEvent(new CustomEvent("ml-sidebar-extended-change", { detail: { extended } }));
}

export function isSidebarExtended(): boolean {
    return sidebarExtended;
}

export function setSidebar(sidebar: Sidebar | null): void {
    if (sidebarParent == null || sidebarRoot == null) {
        showErrorPopup("failed to get sidebar");
        return;
    }
    // Always reset to collapsed when sidebar is (re)mounted or removed.
    // This keeps the panel hidden until the user clicks the arrow button.
    setSidebarExtended(false);
    if (sidebarComponent) {
        // unmount
        sidebarComponent?.unmount(sidebarParent);
        sidebarComponent = null;
        sidebarRoot.style.visibility = "hidden";
    }
    if (sidebar) {
        // mount
        sidebarComponent = sidebar;
        sidebar?.mount(sidebarParent);
        sidebarRoot.style.visibility = "visible";
    }
}

export function getSidebarRoot(): HTMLElement | null {
    return sidebarRoot;
}

export function getSidebarDragOffsetY(): number {
    return sidebarDragOffsetY;
}

function persistSidebarDragOffset(): void {
    try {
        localStorage.setItem(SIDEBAR_DRAG_OFFSET_STORAGE_KEY, String(sidebarDragOffsetY));
    } catch {
        // Ignore storage errors.
    }
}

function setSidebarButtonMinimized(minimized: boolean): void {
    sidebarButtonMinimized = minimized;
    sidebarRoot?.classList.toggle("sidebar-arrow-minimized", minimized);
    try {
        localStorage.setItem(SIDEBAR_MINIMIZED_STORAGE_KEY, minimized ? "1" : "0");
    } catch {
        // Ignore storage errors.
    }
}

// initialize defaults
setSidebarStyle({
    edge: "right"
});
try {
    setSidebarButtonMinimized(localStorage.getItem(SIDEBAR_MINIMIZED_STORAGE_KEY) === "1");
} catch {
    setSidebarButtonMinimized(false);
}
if (sidebarButton) {
    sidebarButton.title = "Click to open/close. Drag to move. Right-click or touch-and-hold to minimize.";
}
setSidebar(null);