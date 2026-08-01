# Modifier Popup Plan (F-Keys Panel)

## Overview
Keep F-keys panel with modifier buttons (Ctrl, Alt, Shift, Win). When tapping a modifier button, show a popup with tabs (123, ABC, F-keys) that acts like a mini keyboard. Arrow keys row is removed.

## Changes

### 1. Update F-keys panel in `web/screen_keyboard.ts`

- Keep: Esc, F1-F12, modifier buttons (Ctrl, Alt, Shift, Win), Home/End/PgUp/PgDn/Ins/Del
- Remove: Arrow keys row (← ↑ ↓ →)

### 2. Add mini-keyboard popup with tabs

```typescript
private showModifierPickerPopup(anchorEl: HTMLElement, modifierType: string)
```

Popup has 3 tabs:
- **123**: Numbers 0-9, common symbols
- **ABC**: Letters a-z
- **F1-F12**: Function keys

Each key sends the combination (e.g., Ctrl+A, Alt+F4).

### 3. CSS for popup (z-index above main keyboard)

```css
.ml-modifier-picker {
    z-index: 100060; /* Above main keyboard's z-index */
}
```

## F-Keys Panel Layout (New)
```
┌─────────────────────────────────────┐
│ [Esc] F1 F2 F3 F4 F5 F6            │
│        F7 F8 F9 F10 F11 F12        │
│   [Ctrl] [Alt] [Shift] [Win]       │
│   Home End PgUp PgDn Ins Del       │
└─────────────────────────────────────┘
```

## Implementation Order
1. Remove arrow keys row from `buildFkeysPanel()`
2. Add popup with tab navigation
3. Add CSS styling
