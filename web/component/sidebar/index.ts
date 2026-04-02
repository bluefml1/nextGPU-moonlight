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
let sidebarDragOffsetY: number = 0;
const DRAG_TOGGLE_SUPPRESS_THRESHOLD_PX: number = 5;

sidebarButton?.addEventListener("pointerdown", onSidebarButtonPointerDown);
sidebarButton?.addEventListener("pointermove", onSidebarButtonPointerMove);
sidebarButton?.addEventListener("pointerup", onSidebarButtonPointerUpOrCancel);
sidebarButton?.addEventListener("pointercancel", onSidebarButtonPointerUpOrCancel);
sidebarButton?.addEventListener("lostpointercapture", onSidebarButtonPointerUpOrCancel);

window.addEventListener("ml-modal-visibility", () => {
    // Keep sidebar collapsed whenever a modal (e.g. Settings) is opened/closed.
    setSidebarExtended(false);
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
    sidebarButton.setPointerCapture(event.pointerId);
}

function onSidebarButtonPointerMove(event: PointerEvent): void {
    if (activePointerId == null || event.pointerId !== activePointerId) {
        return;
    }
    
    const deltaY: number = event.clientY - dragStartY;

    if (Math.abs(deltaY) > DRAG_TOGGLE_SUPPRESS_THRESHOLD_PX) {
        isDraggingSidebarButton = true;
        suppressNextSidebarToggle = true;
    }

    if (isDraggingSidebarButton) {
        sidebarDragOffsetY = dragStartOffsetY + deltaY;
    }
}

function onSidebarButtonPointerUpOrCancel(event: PointerEvent): void {
    if (activePointerId == null || event.pointerId !== activePointerId) {
        return;
    }

    if (sidebarButton?.hasPointerCapture(event.pointerId)) {
        sidebarButton.releasePointerCapture(event.pointerId);
    }

    activePointerId = null;
    isDraggingSidebarButton = false;
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

// initialize defaults
setSidebarStyle({
    edge: "left"
});
setSidebar(null);