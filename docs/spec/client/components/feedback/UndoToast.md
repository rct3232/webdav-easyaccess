# UndoToast Spec

Target-contract spec (docs-first; AI_FEATURE_PLAN §4.11 UI/UX toast system; PLAN §7 T0.7).

## 1. Overview

| Item               | Description                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Bottom toast with an action slot: `[icon] {label}  [되돌리기]` — the message-bar view for user-triggered commands carrying an undo pointer. Separate surface from the appbar job-progress area (§4.11). |
| Used in            | App-level snackbar host (same place `useMessage` renders), driven by `useUndoToast` state                                                                                                               |
| Related components | `useMessage` (extended contract below), useUndoToast, ConfirmDialog (cascade confirm host)                                                                                                              |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/feedback/UndoToast.js`
- **Test file:** `client/src/components/feedback/__tests__/UndoToast.test.js`

### 2.2 useMessage Extension Contract (additive)

- `showMessage(text, type, duration?, action?)` where `action = { label: string, onAction: () => void, disabled?: boolean }`.
- Existing callers are untouched (optional 4th arg); `message` state gains `action: null` by default.
- **Decision:** the extension is spec'd here; `hooks/useMessage.md` receives the matching row at implementation time (same PR — docs-first). Undo toasts use `type='success'` styling with the 8 s duration supplied by `useUndoToast` (default durations unchanged).

### 2.3 Props

| Name    | Type     | Required | Default | Description                                                                       |
| ------- | -------- | -------- | ------- | --------------------------------------------------------------------------------- |
| show    | boolean  | Y        | -       | Visibility                                                                        |
| text    | string   | Y        | -       | Localized command label incl. counts (e.g. `이동을 완료했습니다 (12개)`)          |
| type    | string   | N        | success | Snackbar tone                                                                     |
| action  | object   | N        | null    | `{ label, onAction, disabled? }`; `null` ⇒ plain message bar (report-only toasts) |
| onClose | function | Y        | -       | Dismiss                                                                           |

### 2.4 Rendering Contract

- Action button label: `actions.undo` (`되돌리기`), text-button style at the toast's trailing edge, min 44px touch target (mobile parity).
- `action.disabled=true` while `useUndoToast.busy` (undo in flight) — spinner-free, click-ignored.
- One visible toast at a time is the controller's guarantee (§4.11 one-per-command); the view renders whatever single message object arrives.
- Mixed-result and cascade outcomes are TEXT the controller composes from the response (`items_undone`/`items_skipped`) — the view never counts.

### 2.5 Dependencies

- **imports:** MUI Snackbar/Alert/Button, useTranslation; **no** hooks/services (fully props-driven view).

### 2.6 i18n Keys

- `actions.undo`; all other strings arrive pre-localized from callers.

### 2.7 Verification Scenarios

- [ ] Renders label + action button; click invokes `onAction` once.
- [ ] `action=null` renders no button (report-only path, e.g. permanent delete result).
- [ ] `disabled` blocks clicks without unmounting the label.
- [ ] Auto-dismiss timing is driven by the passed message state (view holds no timers).

### 2.8 Edge Cases

- Rapid replacement (command A → B): React key on message identity prevents stale-action clicks.
- Screen readers: action announced within the alert region; `onClose` reachable.
