# CollectionDashboard Spec

Target-contract spec (`docs/features/collections-platform.md` §4.11 (feed surface), §4.12, §4.14/§4.15 (admin entry), §4.16; registry shape per CODING_STYLE.md Express Patterns, consumers `useMyPageController.md` §3).

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | `Storage` MyPage content component: hygiene cards (deep-link, never an action center), system-changes journal feed (30d, undo + cascade), my-collections status, SuggestionsChecklist block, storage-usage sparkline. Also owns the `myPageRegistry` entry contract for the new categories (§2.5). |
| Used in            | MyPage via `getMyPageContentDescriptor` (`storage` category)                                                                                                                                                                                                                                       |
| Related components | SuggestionsChecklist, MyPageContentPanel, ConfirmDialog (cascade), useUndoToast (undo execution reuse), PageHeaderContext                                                                                                                                                                          |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/CollectionDashboard.js`
- **Test file:** `client/src/components/mypage/content/__tests__/CollectionDashboard.test.js`
- **Naming:** the module is `CollectionDashboard`; the USER-facing surface is `Storage` (category id `storage`) because it is broader than collections — the name/label divergence is intentional.

### 2.2 Props

| Name       | Type     | Required | Default         | Description                                                                                                            |
| ---------- | -------- | -------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| user       | object   | Y        | -               | Current user (visibility + scoping)                                                                                    |
| onNavigate | function | Y        | -               | `(route) => void` — deep-link target for hygiene cards (`/files/__trash__`, collection member views, etc.)             |
| onUndo     | function | N        | -               | `(actionId, { confirmCascade? }) => void` — routes to `useUndoToast` execution (same 409/cascade protocol, actions.md) |
| onMessage  | function | N        | -               | `(type, text)` feedback (SharingContent precedent)                                                                     |
| gateway    | object   | N        | explorerGateway | **IO seam:** injection for tests (useUndoToast precedent); production never passes it.                                 |

### 2.3 Blocks (render order = contract)

1. **Hygiene cards** — exact/near dups count + reclaimable GB; trash size + retention countdown (`TRASH_RETENTION_DAYS`); cleanup suggestions count. Each card is a DEEP LINK to the context where the action happens (dup finder view / `/files/__trash__` / SuggestionsChecklist scroll target) — pull-overview, not action center. Counts via gateway seams; zero/absent data block renders nothing (absent-not-disabled). The duplicates card carries the near-dup line when the payload's `near_duplicates` block is present with `group_count > 0` (`mypage.hygieneNearDuplicatesMeta` — same deep-link target; near-dup rows ride the suggestions list).
2. **System-changes feed (journal)** — `GET /api/actions` rows (30d, `snake_case` verbatim): `subject_label` + `action` → i18n label map (`mypage.journalAction.${action}`), `actor: "system"` → `auto` tag, `created_at` formatted. Per row: `undo_available` + `is_tip` → undo button; non-tip → cascade-confirm dialog with `params.laterChanges` count then re-post; `not recoverable` badge for report-only rows (permanent delete/empty-trash parity contract); `status:'undone'` → strikethrough label, no action. `payload` never fetched/needed (feed contract).
3. **My-collections status** — counts (active/archived), grants received/granted (revoke inline = `DELETE /:id/grants`, instant), recent merge/archive facts from the feed subset with undo (same row renderer).
4. **Suggestions** — `SuggestionsChecklist` block (its spec owns the accept protocol).
5. **Storage-usage sparkline** — ONLY a sparkline, no insight prose. Seam `loadStorageUsageSeries()` (`explorerGateway.md` §2.6) returns `{ points: [{ day, bytes }] }` from `GET /api/dashboard/storage-usage`; the block renders ONLY when at least two points exist. Absent data, an absorbed read failure (`null`) or a one-point series ⇒ block omitted entirely (the server already applies the two-point minimum; the client never fabricates a point). The retained `data-testid="capacity-sparkline"` and `mypage.capacityTitle` key are stable identifiers for the Storage sparkline.

#### 2.3.1 Data seams

- Hygiene cards + Suggestions block read the ONE gateway seam `getFileSuggestions()`
  (`GET /api/dashboard` — `collectionsRepository.md` §2.3): `duplicates` feeds the dup card
  (+ the `near_duplicates` near-dup line when present), `suggestions` feeds both the
  suggestions-count card and the `SuggestionsChecklist` (exact-dup AND `near_dup` rows — the
  row shape is kind-generic, so near-dup rows render with no component change; the reason
  label maps `mypage.suggestionsReason.NearDup`) plus the LLM-free rule kinds
  (`temp_pattern`/`stale_screenshot`/`old_installer` → `mypage.suggestionsReason.TempPattern`/
  `StaleScreenshot`/`OldInstaller`),
  `trash` feeds the trash card (size + countdown from `oldest_deleted_at` +
  `retention_days`; `retention_days === 0` renders "no automatic purge"). The journal feed
  uses `getActions({ domain: 'collection' })`; collections status uses `loadCollections` +
  per-own-collection `getGrants` (personal scale, one absorbed read per collection).
- Dup-card deep link: the dup rows ARE the suggestions list, so the card scrolls to the
  suggestions block (in-page target `dashboard-suggestions`) — there is no separate dup finder
  view; trash card → `onNavigate('/files/__trash__')`.
- Feed member-op rows render `subject_label` (collection name captured at
  commit time — `store/collectionsStore.md` §2.1).
- Accept: the response carries `undo.action_id` (ONE journaled command — `routes/dashboard.md`
  §2.4) → `showUndoToast({ actionId, text: 'mypage.suggestionsTrashed', params: { count } })`
  from the already-mounted `useUndoToast` bundle ("Moved N items to Trash" + Undo; the undo
  executes through the generic `POST /api/actions/:id/undo`). A response WITHOUT `undo`
  (absent pointer = nothing was journaled) keeps the plain report toast. Mixed outcomes
  (`trashed` shorter than the checked list) still toast the moved count; the checklist
  refreshes through `loadAll`.
- Dismiss: the host passes `onDismiss={handleDismiss}` into `SuggestionsChecklist` — the
  gateway seam `dismissFileSuggestion(id)` (absorbed failure ⇒ row stays; success ⇒ silent
  list refresh, no toast — `SuggestionsChecklist.md` §2.2). Expiry footer rows refresh with
  the same read.
- Undo execution: `useUndoToast` mounted inside the dashboard (own `useMessage` bundle +
  rendered snackbar, cascade `ConfirmDialog` from `cascadeConfirm` state — FileManager
  protocol); `onUndo` prop overrides the row handler when the host supplies one.

### 2.4 Dependencies

- **imports:** MUI card/list primitives, useTranslation, formatDate/formatFileSize, MyPageContentPanel; data via `explorerGateway` §2.6 seams called from a MyPage controller seam (useMyPageController extension at implementation time) and passed as props where the panel pattern requires it (SharingContent precedent allows content-level service reads; the new gateway boundary wins for collections surfaces).
- **Wiring:** `onNavigate` is produced by `MyPageContentArea` (`useNavigate()` — the page-level router hook stays out of the pure registry helper) and forwarded through `getMyPageContentDescriptor` inputs into the `storage` branch's `contentProps`; the registry gains the `storage` entry + descriptor branch (pure data).

### 2.5 myPageRegistry entry contract (additions)

| Entry | Shape                                                                                                 | Notes                                                                                                                                                                                                                                               |
| ----- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| user  | `{ id: 'storage', icon: <MUI>, labelKey: 'mypage.storage', visibility: 'all' }`                       | Direct (single-panel) category → `CollectionDashboard`                                                                                                                                                                                              |
| admin | `{ id: 'admin-ai', icon: <MUI>, labelKey: 'mypage.adminAiOps', visibility: 'admin', statusChip: fn }` | Admin AI-governance panel; row shows health chip `not_configured \| preparing(phase, progress) \| probe_failed(reason) \| partial \| ok` from `settings/public.ai` + backend health — admin sees the visible-STATE, regular users never see the row |

- `statusChip` is a plain serializable `{ labelKey, tone }` descriptor produced by the registry helper (no JSX in registry data); the sidebar renders it.
- Registry entries and content-descriptor branches are pure data — `utils/myPageRegistry.md` gains the two rows.

### 2.6 i18n Keys

- `mypage.storage`, `mypage.adminAiOps`, `mypage.journal*` (title/labels/action map/undone), `mypage.hygiene*` (cards, incl. `mypage.hygieneNearDuplicatesMeta`), `mypage.capacityTitle`, `mypage.collectionsStatus*`, `mypage.grantsReceived`/`grantsGranted`/`revoke`, `mypage.suggestionsReason.ExactDup`/`NearDup`, `permissions.editor`/`permissions.viewer` (received-grant role chip — localized, never the raw enum)

### 2.7 Verification Scenarios

- [ ] Hygiene card click calls `onNavigate` and performs NO mutation.
- [ ] Feed renders `subject_label` verbatim (never re-resolved) with mapped action label; system rows tagged `auto`.
- [ ] Non-tip undo opens cascade dialog showing `laterChanges` count BEFORE re-posting with `confirmCascade: true`.
- [ ] Permanent-delete rows show `not recoverable` badge and no undo button.
- [ ] `storage` category renders for non-admins only (hidden / never invoked for admins — operator rule); `admin-ai` only for admins and carries the 4-state chip.
- [ ] Missing storage-usage/dup data hides blocks (no spinners-forever, no placeholder prose); one series point also hides the sparkline.

### 2.8 Edge Cases

- Feed cap (200 rows) hit: "more changes" note, no pagination control (30d personal scale decision).
- Revoke-grant inline success: row disappears instantly (server revocation is instant).
- Operator rule (admin is a pure operator): the dashboard is hidden / never invoked for admin — the `storage` category is `nonAdminOnly` and admin deep-links fall back to the default section (no redundant checks inside the component).
