# CollectionDashboard Spec

Target-contract spec (`docs/features/collections-platform.md` §4.11 (feed surface), §4.12, §4.14/§4.15 (admin entry), §4.16; registry shape per CODING_STYLE.md Express Patterns, consumers `useMyPageController.md` §3).

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | `Storage` MyPage content component: hygiene cards (deep-link, never an action center), system-changes journal feed (30d, undo + cascade), my-collections status, SuggestionsChecklist block, capacity sparkline. Also owns the `myPageRegistry` entry contract for the new categories (§2.5). |
| Used in            | MyPage via `getMyPageContentDescriptor` (`storage` category)                                                                                                                                                                                                                                  |
| Related components | SuggestionsChecklist, MyPageContentPanel, ConfirmDialog (cascade), useUndoToast (undo execution reuse), PageHeaderContext                                                                                                                                                                     |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/CollectionDashboard.js`
- **Test file:** `client/src/components/mypage/content/__tests__/CollectionDashboard.test.js`
- **Decision (naming):** spec keeps the plan's module name `CollectionDashboard`; the USER-facing surface is `Storage` (category id `storage`) because it is broader than collections — name/label divergence is intentional.

### 2.2 Props

| Name       | Type     | Required | Default         | Description                                                                                                            |
| ---------- | -------- | -------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| user       | object   | Y        | -               | Current user (visibility + scoping)                                                                                    |
| onNavigate | function | Y        | -               | `(route) => void` — deep-link target for hygiene cards (`/files/__trash__`, collection member views, etc.)             |
| onUndo     | function | N        | -               | `(actionId, { confirmCascade? }) => void` — routes to `useUndoToast` execution (same 409/cascade protocol, actions.md) |
| onMessage  | function | N        | -               | `(type, text)` feedback (SharingContent precedent)                                                                     |
| gateway    | object   | N        | explorerGateway | **As-built (T0.10):** IO seam injection for tests (useUndoToast precedent); production never passes it.                |

### 2.3 Blocks (render order = contract)

1. **Hygiene cards** — exact/near dups count + reclaimable GB; trash size + retention countdown (`TRASH_RETENTION_DAYS`); cleanup suggestions count. Each card is a DEEP LINK to the context where the action happens (dup finder view / `/files/__trash__` / SuggestionsChecklist scroll target) — pull-overview, not action center (§4.16). Counts via gateway seams; zero/absent data block renders nothing (absent-not-disabled).
2. **System-changes feed (journal)** — `GET /api/actions` rows (30d, `snake_case` verbatim): `subject_label` + `action` → i18n label map (`mypage.journalAction.${action}`), `actor: "system"` → `auto` tag, `created_at` formatted. Per row: `undo_available` + `is_tip` → undo button; non-tip → cascade-confirm dialog with `params.laterChanges` count then re-post (§4.11 surface 3); `not recoverable` badge for report-only rows (permanent delete/empty-trash parity contract); `status:'undone'` → strikethrough label, no action. `payload` never fetched/needed (feed contract).
3. **My-collections status** — counts (active/archived), grants received/granted (revoke inline = `DELETE /:id/grants`, instant), recent merge/archive facts from the feed subset with undo (same row renderer).
4. **Suggestions** — `SuggestionsChecklist` block (its spec owns the accept protocol).
5. **Capacity sparkline** — ONLY a sparkline, no insight prose (§4.16 rejection). **Decision:** series endpoint ships with later tasks; seam `loadCapacitySeries()` returns `{ points: [{ day, bytes }] }`; absent ⇒ block omitted entirely.

#### 2.3.1 As-built seams (T0.10)

- Hygiene cards + Suggestions block read the ONE gateway seam `getFileSuggestions()`
  (`GET /api/dashboard` — `collectionsRepository.md` §2.3): `duplicates` feeds the dup card,
  `suggestions` feeds both the suggestions-count card and the `SuggestionsChecklist`,
  `trash` feeds the trash card (size + countdown from `oldest_deleted_at` +
  `retention_days`; `retention_days === 0` renders "no automatic purge"). The journal feed
  uses `getActions({ domain: 'collection' })`; collections status uses `loadCollections` +
  per-own-collection `getGrants` (personal scale, one absorbed read per collection).
- Dup-card deep link (P0): the dup rows ARE the suggestions list, so the card scrolls to the
  suggestions block (in-page target `dashboard-suggestions`) instead of a not-yet-built dup
  finder view; trash card → `onNavigate('/files/__trash__')`.
- Feed member-op rows render `subject_label` per register (d) (collection name captured at
  commit time — `store/collectionsStore.md` §2.1).
- Accept (P0): the command is not journaled yet (`routes/dashboard.md` §2.4 decision), so
  success shows the report toast WITHOUT an Undo button; the trash-restore UX is the undo
  path until the T3.3 command-unit row lands.
- Undo execution: `useUndoToast` mounted inside the dashboard (own `useMessage` bundle +
  rendered snackbar, cascade `ConfirmDialog` from `cascadeConfirm` state — FileManager
  protocol); `onUndo` prop overrides the row handler when the host supplies one.

### 2.4 Dependencies

- **imports:** MUI card/list primitives, useTranslation, formatDate/formatFileSize, MyPageContentPanel; data via `explorerGateway` §2.6 seams called from a MyPage controller seam (useMyPageController extension at implementation time) and passed as props where the panel pattern requires it (SharingContent precedent allows content-level service reads; the new gateway boundary wins for collections surfaces).
- **As-built (T0.10):** `onNavigate` is produced by `MyPageContentArea` (`useNavigate()` — the page-level router hook stays out of the pure registry helper) and forwarded through `getMyPageContentDescriptor` inputs into the `storage` branch's `contentProps`; the registry gains the `storage` entry + descriptor branch (pure data, this PR).

### 2.5 myPageRegistry entry contract (additions)

| Entry | Shape                                                                                                 | Notes                                                                                                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| user  | `{ id: 'storage', icon: <MUI>, labelKey: 'mypage.storage', visibility: 'all' }`                       | Direct (single-panel) category → `CollectionDashboard`                                                                                                                                                      |
| admin | `{ id: 'admin-ai', icon: <MUI>, labelKey: 'mypage.adminAiOps', visibility: 'admin', statusChip: fn }` | §4.15 panel; row shows health chip `not_configured \| probe_failed(reason) \| partial \| ok` from `settings/public.ai` + backend health — admin sees visible-STATE (§4.12), regular users never see the row |

- **Decision:** `statusChip` is a plain serializable `{ labelKey, tone }` descriptor produced by the registry helper (no JSX in registry data); sidebar renders it.
- Registry entries and content-descriptor branches are pure data — `utils/myPageRegistry.md` gains the two rows at implementation time (same PR).

### 2.6 i18n Keys

- `mypage.storage`, `mypage.adminAiOps`, `mypage.journal*` (title/labels/action map/undone), `mypage.hygiene*` (cards), `mypage.capacityTitle`, `mypage.collectionsStatus*`, `mypage.grantsReceived`/`grantsGranted`/`revoke`

### 2.7 Verification Scenarios

- [ ] Hygiene card click calls `onNavigate` and performs NO mutation.
- [ ] Feed renders `subject_label` verbatim (never re-resolved) with mapped action label; system rows tagged `auto`.
- [ ] Non-tip undo opens cascade dialog showing `laterChanges` count BEFORE re-posting with `confirmCascade: true`.
- [ ] Permanent-delete rows show `not recoverable` badge and no undo button.
- [ ] `storage` category renders for non-admins; `admin-ai` only for admins and carries the 4-state chip.
- [ ] Missing capacity/dup data hides blocks (no spinners-forever, no placeholder prose).

### 2.8 Edge Cases

- Feed cap (200 rows) hit: "more changes" note, no pagination control (30d personal scale decision).
- Revoke-grant inline success: row disappears instantly (server revocation is instant, §4.7).
