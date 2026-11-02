# CollectionsOverview Spec

Target-contract spec (collection status + collection journal feed; registry shape per CODING_STYLE.md Express Patterns, consumers `useMyPageController.md` §3, `collectionsRepository.md`).

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role               | `Collections` MyPage content component: my-collections status (active/archived counts), grants received/granted with inline revoke, and the collection-domain system-changes journal feed (30d, undo + cascade). NO storage hygiene/usage/suggestion reads — those belong to `StorageDashboard`. |
| Used in            | MyPage via `getMyPageContentDescriptor` (`collections` category)                                                                                                                                                                                                                                 |
| Related components | MyPageContentPanel, ConfirmDialog (cascade), useUndoToast (row undo execution), JournalRow renderer, PageHeaderContext                                                                                                                                                                           |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/CollectionsOverview.js`
- **Test file:** `client/src/components/mypage/content/__tests__/CollectionsOverview.test.js`
- **Naming:** the module is `CollectionsOverview`; the USER-facing surface is `Collections` (category id `collections`).

### 2.2 Props

| Name    | Type     | Required | Default         | Description                                                                                                            |
| ------- | -------- | -------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| user    | object   | Y        | -               | Current user (visibility + scoping)                                                                                    |
| onUndo  | function | N        | -               | `(actionId, { confirmCascade? }) => void` — routes to `useUndoToast` execution (same 409/cascade protocol, actions.md) |
| gateway | object   | N        | explorerGateway | **IO seam:** injection for tests (useUndoToast precedent); production never passes it.                                 |

### 2.3 Blocks (render order = contract)

1. **My-collections status** — counts (active/archived), grants received/granted (revoke inline = `DELETE /:id/grants`, instant), recent merge/archive facts from the feed subset with undo (same row renderer). Zero collections renders nothing (absent-not-disabled).
2. **System-changes feed (journal)** — `GET /api/actions` rows (30d, `snake_case` verbatim) for `domain: 'collection'`: `subject_label` + `action` → i18n label map (`mypage.journalAction.${action}`), `actor: "system"` → `auto` tag, `created_at` formatted. Per row: `undo_available` + `is_tip` → undo button; non-tip → cascade-confirm dialog with `params.laterChanges` count then re-post; `not recoverable` badge for report-only rows (permanent delete/empty-trash parity contract); `status:'undone'` → strikethrough label, no action. `payload` never fetched/needed (feed contract).

Render order in the as-built surface: counts/grants block first, then the collection journal feed. Zero/absent data hides each block independently.

### 2.3.1 Data seams

- `getActions({ domain: 'collection' })` (`collectionsRepository.md` §2.3) feeds the journal section and the recent merge/archive subset.
- `loadCollections({ include: 'mine,shared,archived' })` feeds counts, granted_role rows (received grants) and the own-collection list for the grants-granted read.
- Per-own-collection `getGrants(id)` (personal scale, one absorbed read per collection) feeds the granted rows with inline revoke.
- Revoke executes `revokeGrant(collectionId, granteeId)`; success removes the row instantly (server revocation is instant).
- Row undo executes through the already-mounted `useUndoToast` (own `useMessage` bundle + rendered snackbar, cascade `ConfirmDialog`); the `onUndo` prop overrides the row handler when the host supplies one.

### 2.4 Dependencies

- **imports:** MUI list/chip/icon primitives, useTranslation, formatDate, MyPageContentPanel, useMessage/useUndoToast, ConfirmDialog, UndoToast.
- **Wiring:** `getMyPageContentDescriptor` supplies `{ user }` (`onUndo` remains an optional test/host seam); the registry carries the `collections` entry as pure data (`StorageDashboard.md` §2.5, `utils/myPageRegistry.md`).

### 2.5 i18n Keys

- `mypage.collectionsOverview` (category + page title)
- `mypage.collectionsStatusTitle`, `mypage.collectionsActiveMeta`, `mypage.collectionsArchivedMeta`, `mypage.collectionsFactsTitle`
- `mypage.grantsReceived`, `mypage.grantsGranted`, `mypage.grantsRevoke`
- `mypage.journalTitle`, `mypage.journal*` (labels/action map/undone/not recoverable/more)
- `permissions.editor`/`permissions.viewer` (received-grant role chip — localized, never the raw enum)

### 2.6 Verification Scenarios

- [ ] Counts render active/archived from the collections read.
- [ ] Grants received render the localized role chip; grants granted render grantee rows with inline revoke that removes the row instantly.
- [ ] Feed renders `subject_label` verbatim (never re-resolved) with mapped action label; system rows tagged `auto`.
- [ ] Non-tip undo opens the cascade dialog showing `laterChanges` count BEFORE re-posting with `confirmCascade: true`.
- [ ] Permanent-delete rows show `not recoverable` badge and no undo button.
- [ ] Missing collections/action/grants data hides the corresponding block (no spinners-forever, no placeholder prose).
- [ ] `collections` category renders for non-admins only (hidden / never invoked for admins — operator rule).

### 2.7 Edge Cases

- Feed cap (200 rows) hit: "more changes" note, no pagination control (30d personal scale decision).
- Revoke-grant inline success: row disappears instantly (server revocation is instant).
- Operator rule (admin is a pure operator): the category is `nonAdminOnly` and admin deep-links fall back to the default section (no redundant checks inside the component).
