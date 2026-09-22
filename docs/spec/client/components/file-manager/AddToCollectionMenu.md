# AddToCollectionMenu Spec

Target-contract spec.

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | File-side collection entry points in context menu / action sheet / bulk toolbar: `Add to collection` submenu (single + multi-select), inline `New collection` creation, and the §4.5 seed dialog `Make a collection like this file` (embed-gated, absent-not-disabled). Membership copy (`Add to another collection`) reuses the submenu. |
| Used in            | FileContextMenu, FileActionSheet, BulkActionToolbar (main listing AND collection member rows — one component state), via host controller wiring                                                                                                                                                                                           |
| Related components | CollectionsListView, `useCollections`, useUndoToast, `POST /collections/for-nodes` chips                                                                                                                                                                                                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/AddToCollectionMenu.js` (submenu + dialog launcher; menu-item injection follows the existing context-menu section pattern)
- **Test file:** `client/src/components/file-manager/__tests__/AddToCollectionMenu.test.js`

### 2.2 Props

| Name            | Type     | Required | Default | Description                                                                                                                                    |
| --------------- | -------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| open            | boolean  | Y        | -       | Menu/dialog visibility (host-controlled)                                                                                                       |
| targetNodes     | array    | Y        | -       | `{ nodeId, name }[]` — 1 (context) or N (multi-select); member rows pass the member's real node                                                |
| collections     | array    | Y        | -       | Writable collections for the requester (own + `granted_role='editor'`), activity order                                                         |
| membershipIds   | array    | N        | []      | `collection_id`s already containing ALL target nodes (for-nodes chip data ⇒ checkmark rows)                                                    |
| seedItemVisible | boolean  | N        | true    | `Make a collection like this file` shows for exactly ONE selected file AND `aiFlags.embed` — otherwise the row is ABSENT (not disabled, §4.12) |
| onAdd           | function | Y        | -       | `(collectionId, nodeIds) => void` → `POST /:id/items`                                                                                          |
| onCreateAndAdd  | function | Y        | -       | `(name, nodeIds) => void` → `POST /collections` then add                                                                                       |
| onCreateSeed    | function | Y        | -       | `({ name, seedNodeId }) => void` → confirm-dialog submit (see §2.4)                                                                            |
| onClose         | function | Y        | -       | Dismiss                                                                                                                                        |

### 2.3 Submenu Contract

- Rows: writable collections with name + item count; checkmark when `membershipIds` contains the id.
- Terminal row `+ New collection…`: inline name field (validation via `validateFileName`/`validationMessage` precedent — same rules as folder names); Enter → `onCreateAndAdd`; server never errors on collision (silent suffix; the refreshed/returned `collection.name` is what toasts show).
- Adding to a `system` collection is legal and triggers auto-pin SERVER-side (§4.9b) — the client just refreshes; no client pin logic.
- Result feedback (host): `rejected_not_readable` entries ⇒ info toast `N excluded (not readable)`; success ⇒ undo toast from `undo.action_id` (§4.11).

### 2.4 Seed Confirm Dialog (§4.5)

- Opens from `Make a collection like this file`; ~640×560; ONE confirm dialog per invariant 5 (create is user-triggered).
- Seed preview: the chosen file (icon/name).
- Editable auto name, prefilled `{seedFileName} and similar files` (`dialogs.seedNameTemplate`, §4.10 — client-composed default; server templateNamer owns SYSTEM-origin names only).
- Member sample grid: `POST /collections/preview { seedNodeId }` → ≤12 tiles with fade-out + `plus N more` counter (`count − sample.length`); skeleton while loading; large-set streaming is a server concern.
- **Mandatory copy line (§4.5 Q2):** states the ENTIRE initial set (preview + `plus N more`) is publish-approved as a batch if/when the collection is shared — the approval must not silently cover unseen members.
- Submit → `onCreateSeed` → create `origin='seed'` with definition `{ seed_ref, theta }` (additive create fields, collectionsRepository §2.8); undo toast after.
- Absorbed 409 `serverErrors.ai.notConfigured` (config race after gating) → plain error toast, dialog stays.

### 2.5 Dependencies

- **imports:** MUI Menu/MenuItem/Dialog primitives, useTranslation, file icon utils; **no** gateway imports (host wires callbacks).

### 2.6 i18n Keys

- `fileManager.addToCollection` (`Add to collection`), `fileManager.newCollectionInline`, `fileManager.seedCreate` (`Make a collection like this file`), `dialogs.seedDialogTitle`, `dialogs.seedNameTemplate`, `dialogs.seedMore` (`plus N more`), `dialogs.seedPublishNotice`, `fileManager.addRejectedNotReadable`

### 2.7 Verification Scenarios

- [ ] Multi-select shows the submenu with count = selected nodes; single context-select passes 1 node.
- [ ] `seedItemVisible=false` ⇒ the seed row is absent from the DOM (absent-not-disabled rule).
- [ ] Inline `New collection` validates name and chains create→add in one host action (one undo toast for the command).
- [ ] Seed dialog shows preview + `plus N more` + the publish-approval line before enabling Create.
- [ ] `membershipIds` rows render checkmarks without extra network calls.
- [ ] Member-row invocation behaves identically to main-listing invocation (same component state).

### 2.8 Edge Cases

- Zero writable collections: submenu shows only `+ New collection…` (+seed row if visible).
- Adding files already member (server `already_members`): silent, no toast noise beyond the command toast.
