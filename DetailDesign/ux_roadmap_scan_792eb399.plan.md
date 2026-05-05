---
name: UX roadmap scan
overview: Repo-wide UX scan identified high-impact opportunities around loading/error clarity, stream recovery, settings guardrails, and discoverability. This plan prioritizes quick wins first, then larger structural UX improvements.
todos:
  - id: phase1-list-states
    content: Design and add list loading/empty/error/retry states for hosts/games
    status: pending
  - id: phase1-settings-validation
    content: Add robust settings normalization/clamping before save/start-stream
    status: pending
  - id: phase1-discoverability
    content: Surface visible reload/details actions without right-click dependency
    status: pending
  - id: phase2-stream-recovery
    content: Implement reconnect/retry overlay and connection progress milestones
    status: pending
  - id: phase2-transfer-ux
    content: Improve file transfer feedback and multi-file drag/drop behavior
    status: pending
  - id: phase3-settings-a11y
    content: Add advanced-settings disclosure and accessibility improvements
    status: pending
isProject: false
---

# UX Improvement Roadmap (Repo-wide Scan)

## Top opportunities (prioritized)

1. **Loading/empty/retry states for host and game lists (High)**
   - Users currently cannot reliably distinguish loading vs empty vs failure states.
   - Add explicit pending/empty/error UI + retry actions around list fetches.
   - Key files: [web/component/fetch_list.ts](/Users/bluefml1/nextGPU-moonlight/web/component/fetch_list.ts), [web/component/host/list.ts](/Users/bluefml1/nextGPU-moonlight/web/component/host/list.ts), [web/component/game/list.ts](/Users/bluefml1/nextGPU-moonlight/web/component/game/list.ts), [web/index.ts](/Users/bluefml1/nextGPU-moonlight/web/index.ts)

2. **In-flow stream recovery (High)**
   - Add a user-facing reconnect overlay (`Retry`, `Open Settings`, `Exit`) for transport drop/fatal connection states.
   - Reuse existing restart path before forcing full exit.
   - Key files: [web/stream.ts](/Users/bluefml1/nextGPU-moonlight/web/stream.ts), [web/stream/index.ts](/Users/bluefml1/nextGPU-moonlight/web/stream/index.ts), [web/stream_overlays.ts](/Users/bluefml1/nextGPU-moonlight/web/stream_overlays.ts)

3. **Connection progress made visible (High)**
   - Convert internal connection statuses into user-facing startup milestones (e.g. direct/relay fallback, slow-connect warning).
   - Key files: [web/stream.ts](/Users/bluefml1/nextGPU-moonlight/web/stream.ts), [web/stream/index.ts](/Users/bluefml1/nextGPU-moonlight/web/stream/index.ts)

4. **Settings validation and guardrails (High)**
   - Sanitize/clamp numeric settings before persistence and before stream start (`bitrate`, `fps`, `packetSize`, queues, custom dimensions).
   - Prevent invalid persisted values from degrading UX later.
   - Key files: [web/component/settings_menu.ts](/Users/bluefml1/nextGPU-moonlight/web/component/settings_menu.ts), [web/app_settings.ts](/Users/bluefml1/nextGPU-moonlight/web/app_settings.ts), [web/stream/index.ts](/Users/bluefml1/nextGPU-moonlight/web/stream/index.ts)

5. **Simplify and clarify settings UX (Medium)**
   - Progressive disclosure: keep core settings visible; collapse advanced network/renderer controls.
   - Improve wording and units (`FPS`, `WebSocket`, kbps labels, short help text).
   - Key files: [web/component/settings_menu.ts](/Users/bluefml1/nextGPU-moonlight/web/component/settings_menu.ts), [web/styles/standard.css](/Users/bluefml1/nextGPU-moonlight/web/styles/standard.css), [web/styles/moonlight.css](/Users/bluefml1/nextGPU-moonlight/web/styles/moonlight.css)

6. **Discoverability of primary actions (Medium)**
   - Avoid over-reliance on right-click/context menus by surfacing visible reload/details actions.
   - Key files: [web/index.ts](/Users/bluefml1/nextGPU-moonlight/web/index.ts), [web/component/context_menu.ts](/Users/bluefml1/nextGPU-moonlight/web/component/context_menu.ts), [web/component/host/index.ts](/Users/bluefml1/nextGPU-moonlight/web/component/host/index.ts), [web/component/game/index.ts](/Users/bluefml1/nextGPU-moonlight/web/component/game/index.ts)

7. **File transfer UX robustness (Medium)**
   - Add clearer success/failure messaging and multi-file drag/drop queue behavior.
   - Key files: [web/stream.ts](/Users/bluefml1/nextGPU-moonlight/web/stream.ts), [web/stream/index.ts](/Users/bluefml1/nextGPU-moonlight/web/stream/index.ts)

8. **Accessibility hardening (Medium)**
   - Improve modal semantics, focus-visible states, and custom select keyboard/ARIA behavior.
   - Key files: [web/component/modal/index.ts](/Users/bluefml1/nextGPU-moonlight/web/component/modal/index.ts), [web/component/input.ts](/Users/bluefml1/nextGPU-moonlight/web/component/input.ts), [web/styles/standard.css](/Users/bluefml1/nextGPU-moonlight/web/styles/standard.css), [web/styles/moonlight.css](/Users/bluefml1/nextGPU-moonlight/web/styles/moonlight.css)

## Suggested delivery phases

- **Phase 1 (quick wins, 2-4 days):** list loading/empty/retry states, settings validation/clamping, clearer error copy, visible reload action.
- **Phase 2 (1 week):** stream reconnect overlay + connection milestone messaging + file transfer success/failure polish.
- **Phase 3 (1-2 weeks):** progressive settings disclosure + accessibility hardening + deeper navigation/discoverability improvements.

## Existing UX-related TODOs to fold in

- [web/component/error.ts](/Users/bluefml1/nextGPU-moonlight/web/component/error.ts) (`fatal` handling TODO)
- [web/styles/moonlight.css](/Users/bluefml1/nextGPU-moonlight/web/styles/moonlight.css) (stream sidebar reorder TODO)

## Decision checkpoint before implementation

Start with **Phase 1** first to maximize impact per effort and reduce user confusion quickly, then proceed to stream recovery work in Phase 2.