# useUndoToast Spec

Target-contract spec.

## 1. Overview

| Item                     | Description                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role                     | Undo-toast controller: turns a mutation's `undo: { action_id }` pointer into ONE bottom toast per COMMAND (`[icon] {label} [Undo]`), executes undo through the gateway, and drives the tip/cascade/fingerprint/mixed-result outcomes. Owns the ≤24h undo-window rule of the toast surface. |
| Used by components/pages | `FileManager` shell (collection CRUD, merge, add/remove members, save-to-collection), MyPage `SuggestionsChecklist` accept, `MergeProposalCard` host, dialog flows                                                                                                                         |
| Does not own             | Snackbar rendering details (`UndoToast` view), message queue mechanics (extended `useMessage`), journal feed presentation (dashboard), server-side inverse execution (`actions.md`)                                                                                                        |

---

## 2. Implementation Spec

### 2.1 File Path

- **Scope:** Global. **Source:** `client/src/hooks/useUndoToast.js`
- **Test file:** `client/src/hooks/__tests__/useUndoToast.test.js`
- **Placement:** global, not page-local — the `Storage` dashboard's suggestions accept makes MyPage (`SuggestionsChecklist`) a second consumer alongside the FileManager shell.

### 2.2 Input Parameters

| Name    | Type     | Required | Description                                                                   |
| ------- | -------- | -------- | ----------------------------------------------------------------------------- |
| gateway | object   | N        | `undoAction` seam (`explorerGateway` §2.6; mock seam for tests)               |
| message | object   | N        | `useMessage()` bundle carrying the action-slot extension (`useMessage.md` §3) |
| refresh | function | N        | `() => void` — host listing/list re-read invoked after a successful undo      |

### 2.3 Return Value / State

| Key             | Type                                                  | Meaning                                                                                                                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| showUndoToast   | `({ actionId, text, params?, shownAt? }) => void`     | Show (or REPLACE the current) undo toast. `text` is the already-localized label; `params` optional render values. `shownAt` is the optional ORIGINAL command timestamp for programmatic re-show/recovery paths — it stamps the ≤24 h window instead of the re-show moment; omitted ⇒ `Date.now()`. |
| showReportToast | `(text, params?) => void`                             | Report-only variant (permanent delete / GC runs: toast, no undo button).                                                                                                                                                                                                                           |
| undoNow         | `(actionId, options?) => Promise<void>`               | **Row-button undo** (CollectionDashboard journal feed): executes the same undo protocol directly from a row button (tip free / 409→`cascadeConfirm` re-post / refresh on success) — no toast action slot is shown. Stable identity (latest-props ref).                                             |
| cascadeConfirm  | `{ open, laterChanges, confirm(), cancel() } \| null` | Non-tip undo state: hook received 409 `actions.cascadeConfirmRequired`; host renders ConfirmDialog from `params.laterChanges`.                                                                                                                                                                     |
| busy            | boolean                                               | Undo execution in flight (button disabled while `true`).                                                                                                                                                                                                                                           |

### 2.4 Contract Rules

- **One toast per command (never per item):** showing a new undo toast replaces the pending one; the journal already holds history at command-row granularity.
- **≤24h window:** the undo action slot renders only while `now − shownAt ≤ 24h` AND an `actionId` exists. Toast auto-hides at 8 s. Scope split: the ≤24h window governs the toast surface only — it guards re-showing/recovery paths (e.g. restore-after-reload hooks feeding old commands); the dashboard feed is not bound by it and carries undo beyond that window (rows live 30d, `actions.md`).
- **snake_case → UI mapping:** consumed fields are `undo.action_id`, `items_undone`, `items_skipped`, `cascade_undone`, `params.laterChanges`, `errorCode`. Labels are i18n keys supplied by the CALLER (`text`), not invented here.
- Undo execution: `undoAction(actionId)` → on 200: re-read via `refresh()`, then success toast with counts — mixed results render `11 undone, 1 skipped (state changed since)` (`items_undone`/`items_skipped`).
- 409 `cascadeConfirmRequired` → set `cascadeConfirm`; re-post with `{ confirmCascade: true }` on user confirm (409-then-repost, no force flag).
- 409 `fingerprintMismatch` / `expired` / `alreadyUndone`, 404 masquerade → error toast via `message.showError`; toast action stays visible only while undo remains possible (drop the button after terminal refusals).
- No toast for silent system acts or trivial self-reversing state (like/visit/sort) — system acts are carried by the digest/feed surfaces instead.

### 2.5 Dependencies

- **Must route IO through:** `explorerGateway` (`undoAction`).
- **May use:** `useMessage` (extended), ConfirmDialog host callbacks.
- **Must not use:** direct `collectionsRepository` imports, `window`/`localStorage`.

### 2.6 Error Handling

- Absorbed refusals never leave a dead `[Undo]` button: terminal errorCode removes the action slot and reports.
- Undo success but refresh failure: report the refresh error via `showError`; do not re-show undo (already `undone`).

### 2.7 Verification Scenarios

- [ ] A mutation payload WITHOUT `undo.action_id` yields no undo toast (permanent delete, absorbed failure).
- [ ] Second `showUndoToast` replaces the first (one visible toast max).
- [ ] Tip undo: 200 → `refresh()` called once, count toast shown.
- [ ] Mixed 200 (`items_undone: 11, items_skipped: 1`) renders both counts.
- [ ] Non-tip 409 exposes `cascadeConfirm.laterChanges` and a confirm re-posts with `confirmCascade: true`.
- [ ] `fingerprintMismatch` shows error and drops the action button.
- [ ] `showReportToast` never renders an action button.

### 2.8 Edge Cases

- Undo pressed twice: second call hits `alreadyUndone` (409) → error path, no double refresh loop.
- Window expiry while the toast is up is unreachable in practice (8 s auto-hide ≪ 24 h); rule exists for programmatic re-show paths only.
