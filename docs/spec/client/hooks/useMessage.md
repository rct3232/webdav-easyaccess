# useMessage Spec

## 1. Overview

| Item                     | Description                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role                     | Unified message display: showMessage, showSuccess, showError, showWarning, showInfo, showErrorFromError, clearMessage. Auto-hide after duration. |
| Used by components/pages | FileManager, dialogs, pages                                                                                                                      |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useMessage.js`
- **Test file:** `client/src/hooks/__tests__/useMessage.test.js`

### 2.2 Input Parameters

| Name                    | Type   | Required | Description |
| ----------------------- | ------ | -------- | ----------- |
| options                 | object | N        | {}          |
| options.defaultDuration | number | N        | 3000        |
| options.successDuration | number | N        | 3000        |
| options.errorDuration   | number | N        | 5000        |

### 2.3 Return Value / State

| Key                | Type                                    | Meaning           |
| ------------------ | --------------------------------------- | ----------------- |
| message            | { show, text, type }                    | Current message   |
| showMessage        | (text, type, duration?) => void         | Show message      |
| showSuccess        | (text, duration?) => void               | Success           |
| showError          | (text, duration?) => void               | Error             |
| showWarning        | (text, duration?) => void               | Warning           |
| showInfo           | (text, duration?) => void               | Info              |
| showErrorFromError | (error, defaultMsg?, duration?) => void | From error object |
| clearMessage       | () => void                              | Clear             |

### 2.4 Dependencies

- i18n, getServerErrorDisplay
- No API calls

### 2.5 Side Effects

- setTimeout to auto-hide message (duration > 0)
- showErrorFromError uses error.response.data.errorCode -> getServerErrorDisplay

### 2.6 Error Handling

- showErrorFromError: prefers errorCode, else data.error, else error.message, else defaultMsg

### 2.7 Verification Scenarios

- [ ] Initial message state
- [ ] showMessage, showSuccess, showError update state
- [ ] Auto-hide after duration
- [ ] clearMessage
- [ ] showErrorFromError with errorCode

### 2.8 Edge Cases

- duration = 0: no auto-hide
- error.response.data.errorCode -> getServerErrorDisplay

---

## 3. Action-slot extension (D2) (AI platform — target, lands with P0)

Addendum to §2.3 per AI_FEATURE_PLAN §4.11 (bottom toast system). View contract: `docs/spec/client/components/feedback/UndoToast.md`; undo controller: `docs/spec/client/hooks/useUndoToast.md`.

- **Signature:** `showMessage(text, type, duration?, action?)` — additive 4th arg `action = { labelKey, onClick, disabled? }`. The snackbar host resolves `labelKey` via `t()` into the view's `action.label`, and maps `onClick` → the view's `onAction` (UndoToast.md §2.3 stays the render-side shape). An optional kind `icon` may ride the message (`[icon] {label} [action]` grammar); callers may also pass an already-localized `text` — this hook never invents labels.
- **State:** `message` gains `action: null` / `icon: null` defaults; existing keys unchanged.
- **Action variant (undo):** with `action` present the §2.2 default durations do NOT apply — the toast persists until dismissed (or replaced by the next command toast) or an explicit timeout ≥ 6000 ms elapses; `useUndoToast` supplies 8 s.
- **Backward compatible:** calls without `action` behave exactly as today (all §2.7 scenarios stay valid untouched); no existing caller changes required.
- Queue/state mechanics only live here — one-toast-per-command, ≤24 h undo-window and refusal handling belong to `useUndoToast.md`, rendering to `UndoToast.md`.

Verification (appends §2.7):

- [ ] (target) With `action`, no auto-hide fires at default duration; an explicit 8000 hides at 8 s; `clearMessage` dismisses immediately.
- [ ] (target) Without `action`, `showMessage`/`showSuccess`/`showError` are byte-identical to today's state transitions.
