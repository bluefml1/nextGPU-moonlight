import { Component, FetchComponent } from "./index.js"
import { ListComponent, ListComponentInit } from "./list.js"

export abstract class FetchListComponent<Data, T extends Component> implements FetchComponent<Data>, Component {
    protected list: ListComponent<T>
    private root = document.createElement("div")
    private status = document.createElement("div")
    private statusText = document.createElement("p")
    private retryButton = document.createElement("button")
    private fetchState: "idle" | "loading" | "ready" | "error" = "idle"
    private lastErrorText: string | null = null

    constructor(listInit?: ListComponentInit) {
        this.list = new ListComponent<T>([], listInit)
        this.root.classList.add("fetch-list-root")
        this.status.classList.add("fetch-list-status")
        this.statusText.classList.add("fetch-list-status-text")
        this.retryButton.classList.add("fetch-list-retry")
        this.retryButton.innerText = "Try Again"
        this.retryButton.addEventListener("click", () => {
            this.beginLoadingState()
            void this.forceFetch()
        })
        this.status.append(this.statusText, this.retryButton)
        this.root.append(this.status)
        this.refreshStatus()
    }

    protected abstract updateComponentData(component: T, data: Data): void

    protected abstract getComponentDataId(component: T): number
    protected abstract getDataId(data: Data): number

    abstract forceFetch(forceServerRefresh?: boolean): Promise<void>

    updateCache(cache: Array<Data>) {
        // Remove all non existing new data
        // Update all already existing components
        for (let i = 0; i < this.list.get().length; i++) {
            let component = this.list.get()[i]

            const dataId = this.getComponentDataId(component)

            const cacheIndex = cache.findIndex(data => this.getDataId(data) == dataId)
            if (cacheIndex == -1) {
                this.removeList(i)

                // removing an element will shift the array to the left
                // -> this means that we need to decr to get the next value because we incr in the loop
                i--
            } else {
                this.updateComponentData(component, cache[cacheIndex])
            }
        }

        // All all newly created data
        for (let i = 0; i < cache.length; i++) {
            let data = cache[i]

            const dataId = this.getDataId(data)

            const listIndex = this.list.get().findIndex(component => this.getComponentDataId(component) == dataId)
            if (listIndex == -1) {
                this.insertList(dataId, data)
            }
        }

        if (this.fetchState !== "error") {
            this.fetchState = "ready"
            this.lastErrorText = null
            this.refreshStatus()
        }
    }

    protected beginLoadingState(): void {
        this.fetchState = "loading"
        this.lastErrorText = null
        this.refreshStatus()
    }

    protected setErrorState(message?: string): void {
        this.fetchState = "error"
        this.lastErrorText = message ?? "Unable to load data."
        this.refreshStatus()
    }

    private refreshStatus(): void {
        const count = this.list.get().length
        let hidden = true
        let text = ""
        let showRetry = false

        if (this.fetchState === "loading" && count === 0) {
            hidden = false
            text = "Loading data..."
        } else if (this.fetchState === "error" && count === 0) {
            hidden = false
            text = this.lastErrorText ?? "Unable to load data."
            showRetry = true
        } else if (this.fetchState === "ready" && count === 0) {
            hidden = false
            text = "No items available."
        }

        this.status.hidden = hidden
        this.statusText.innerText = text
        this.retryButton.hidden = !showRetry
    }

    protected abstract insertList(dataId: number, data: Data): void
    protected removeList(listIndex: number) {
        this.list.remove(listIndex)
    }

    mount(parent: Element): void {
        parent.appendChild(this.root)
        this.list.mount(this.root)
        this.refreshStatus()
    }
    unmount(parent: Element): void {
        this.list.unmount(this.root)
        parent.removeChild(this.root)
    }
}