# AddToCollectionMenu Spec

Target-contract spec (docs-first; AI_FEATURE_PLAN §3.2/§4.5/§4.7/§4.12; PLAN §7 T0.5/T1.6/T3.6 consumers).

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role               | File-side collection entry points in context menu / action sheet / bulk toolbar: `컬렉션에 추가` submenu (single + multi-select), inline `새 컬렉션` creation, and the §4.5 seed dialog `이런 파일로 컬렉션 만들기` (embed-gated, absent-not-disabled). Membership copy (`다른 컬렉션에 추가`) reuses the submenu. |
| Used in            | FileContextMenu, FileActionSheet, BulkActionToolbar (main listing AND collection member rows — one component state), via host controller wiring                                                                                                                                                                    |
| Related components | CollectionsListView, `useCollections`, useUndoToast, `POST /collections/for-nodes` chips (T3.6)                                                                                                                                                                                                                    |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/AddToCollectionMenu.js` (submenu + dialog launcher; menu-item injection follows the existing context-menu section pattern)
- **Test file:** `client/src/components/file-manager/__tests__/AddToCollectionMenu.test.js`

### 2.2 Props

| Name            | Type     | Required | Default | Description                                                                                                                             |
| --------------- | -------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| open            | boolean  | Y        | -       | Menu/dialog visibility (host-controlled)                                                                                                |
| targetNodes     | array    | Y        | -       | `{ nodeId, name }[]` — 1 (context) or N (multi-select); member rows pass the member's real node                                         |
| collections     | array    | Y        | -       | Writable collections for the requester (own + `granted_role='editor'`), activity order                                                  |
| membershipIds   | array    | N        | []      | `collection_id`s already containing ALL target nodes (for-nodes chip data ⇒ checkmark rows)                                             |
| seedItemVisible | boolean  | N        | true    | `이런 파일로 컬렉션 만들기` shows for exactly ONE selected file AND `aiFlags.embed` — otherwise the row is ABSENT (not disabled, §4.12) |
| onAdd           | function | Y        | -       | `(collectionId, nodeIds) => void` → `POST /:id/items`                                                                                   |
| onCreateAndAdd  | function | Y        | -       | `(name, nodeIds) => void` → `POST /collections` then add                                                                                |
| onCreateSeed    | function | Y        | -       | `({ name, seedNodeId }) => void` → confirm-dialog submit (see §2.4)                                                                     |
| onClose         | function | Y        | -       | Dismiss                                                                                                                                 |

### 2.3 Submenu Contract

- Rows: writable collections with name + item count; checkmark when `membershipIds` contains the id.
- Terminal row `+ 새 컬렉션…`: inline name field (validation via `validateFileName`/`validationMessage` precedent — same rules as folder names); Enter → `onCreateAndAdd`; server never errors on collision (silent suffix; the refreshed/returned `collection.name` is what toasts show).
- Adding to a `system` collection is legal and triggers auto-pin SERVER-side (§4.9b) — the client just refreshes; no client pin logic.
- Result feedback (host): `rejected_not_readable` entries ⇒ info toast `N개는 읽기 권한이 없어 제외되었습니다`; success ⇒ undo toast from `undo.action_id` (§4.11).

### 2.4 Seed Confirm Dialog (§4.5)

- Opens from `이런 파일로 컬렉션 만들기`; ~640×560; ONE confirm dialog per invariant 5 (create is user-triggered).
- Seed preview: the chosen file (icon/name).
- Editable auto name, prefilled `{seedFileName}과 유사한 파일` (`dialogs.seedNameTemplate`, §4.10 — client-composed default; server templateNamer owns SYSTEM-origin names only).
- Member sample grid: `POST /collections/preview { seedNodeId }` → ≤12 tiles with fade-out + `이 외 N개` counter (`count − sample.length`); skeleton while loading; large-set streaming is server/T1.6 concern.
- **Mandatory copy line (§4.5 Q2):** states the ENTIRE initial set (preview + `이 외 N개`) is publish-approved as a batch if/when the collection is shared — the approval must not silently cover unseen members.
- Submit → `onCreateSeed` → create `origin='seed'` with definition `{ seed_ref, theta }` (additive create fields, collectionsRepository §2.8); undo toast after.
- Absorbed 409 `serverErrors.ai.notConfigured` (config race after gating) → plain error toast, dialog stays.

### 2.5 Dependencies

- **imports:** MUI Menu/MenuItem/Dialog primitives, useTranslation, file icon utils; **no** gateway imports (host wires callbacks).

### 2.6 i18n Keys

- `fileManager.addToCollection` (`컬렉션에 추가`), `fileManager.newCollectionInline`, `fileManager.seedCreate` (`이런 파일로 컬렉션 만들기`), `dialogs.seedDialogTitle`, `dialogs.seedNameTemplate`, `dialogs.seedMore` (`이 외 N개`), `dialogs.seedPublishNotice`, `fileManager.addRejectedNotReadable`

### 2.7 Verification Scenarios

- [ ] Multi-select shows the submenu with count = selected nodes; single context-select passes 1 node.
- [ ] `seedItemVisible=false` ⇒ the seed row is absent from the DOM (absent-not-disabled rule).
- [ ] Inline `새 컬렉션` validates name and chains create→add in one host action (one undo toast for the command).
- [ ] Seed dialog shows preview + `이 외 N개` + the publish-approval line before enabling Create.
- [ ] `membershipIds` rows render checkmarks without extra network calls.
- [ ] Member-row invocation behaves identically to main-listing invocation (same component state).

### 2.8 Edge Cases

- Zero writable collections: submenu shows only `+ 새 컬렉션…` (+seed row if visible).
- Adding files already member (server `already_members`): silent, no toast noise beyond the command toast.
