# StorageDashboard Spec

Target-contract spec (storage client domain split; registry shape per CODING_STYLE.md Express Patterns, consumers `useMyPageController.md` §3, `storageRepository.md`, `StorageCleanupSuggestions.md`).

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | `Storage` MyPage content component: storage-usage summary + sparkline, hygiene cards (deep-link, never an action center), cleanup suggestions checklist with accept undo/dismiss. The collection status/journal blocks live in `CollectionsOverview`. |
| Used in            | MyPage via `getMyPageContentDescriptor` (`storage` category)                                                                                                                                                                                          |
| Related components | StorageUsageSummary (companion block), StorageCleanupSuggestions, CollectionsOverview, MyPageContentPanel, ConfirmDialog (undo cascade), useUndoToast (accept undo), PageHeaderContext                                                                |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/StorageDashboard.js`
- **Test file:** `client/src/components/mypage/content/__tests__/StorageDashboard.test.js`
- **Naming:** the module is `StorageDashboard`; the USER-facing surface is `Storage` (category id `storage`). The component is storage-only — collection status and the collection journal feed are NOT rendered here (they moved to `CollectionsOverview`, category id `collections`).

### 2.2 Props

| Name       | Type     | Required | Default         | Description                                                                            |
| ---------- | -------- | -------- | --------------- | -------------------------------------------------------------------------------------- |
| user       | object   | Y        | -               | Current user (visibility guard)                                                        |
| onNavigate | function | Y        | -               | `(route) => void` — deep-link target for hygiene cards (`/files/__trash__`)            |
| onMessage  | function | N        | -               | `(type, text)` feedback (SharingContent precedent)                                     |
| gateway    | object   | N        | explorerGateway | **IO seam:** injection for tests (useUndoToast precedent); production never passes it. |

### 2.3 Blocks (render order = contract)

1. **Storage usage summary** — `StorageUsageSummary` renders the current breakdown:
   total, live, trash and versions bytes (`formatFileSize`). The versions row is hidden when
   `version_history_supported === false` (WebDAV mode never invents version bytes). An
   `incomplete === true` payload renders the incomplete-data warning. No quota, percentage
   or insight prose is rendered anywhere. The whole summary is omitted when the usage read
   is absent (`null`).
2. **Storage-usage sparkline** — ONLY a sparkline, no prose. Rendered ONLY when
   `series.points.length >= 2`; absent data, an absorbed read failure (`null`) or a one-point
   series ⇒ the sparkline is omitted entirely (the server already applies the two-point
   minimum; the client never fabricates a point). X positions use the ACTUAL UTC day spacing
   when the `YYYY-MM-DD` days parse (a gap day consumes proportionally more width); an
   equal/invalid day range falls back to index spacing. `data-testid="storage-usage-sparkline"`.
3. **Hygiene cards** — exact/near dups count + reclaimable bytes; trash size + retention
   countdown (`TRASH_RETENTION_DAYS`); cleanup suggestions count. Each card is a DEEP LINK to
   the context where the action happens (dup/suggestion cards scroll to the cleanup block;
   trash card → `/files/__trash__`) — pull-overview, not action center. Cards carry
   `data-testid="storage-hygiene-duplicates|trash|suggestions"`. Zero/absent data renders
   nothing (absent-not-disabled). The duplicates card carries the near-dup line when
   `near_duplicates.group_count > 0` (`mypage.hygieneNearDuplicatesMeta`).
4. **Cleanup suggestions** — `StorageCleanupSuggestions` block (its spec owns the accept
   protocol) under the in-page anchor `id="storage-suggestions"`, rendered only when at least
   one suggestion row exists. Accept trashes checked rows as ONE journaled command; the
   response `undo.action_id` produces the standard undo toast/dismiss refresh behavior.

### 2.3.1 Data seams

- `getStorageHygiene()` (`GET /api/storage`) — ONE read returning hygiene + persisted
  suggestions. Canonical payload:
  `{ hygiene: { duplicates, near_duplicates?, trash }, suggestions: rows }`; a flat legacy
  payload (`{ duplicates, near_duplicates?, trash, suggestions }`) is accepted at the
  component boundary so the read value is not coupled to one nesting. Absorbed failure is
  `{ suggestions: [] }` and hides every block (no spinners-forever, no placeholder prose).
- `getStorageUsage()` (`GET /api/storage/usage`) — `{ current, series: { points } }`; absorbed
  failure is `null`. `current` drives the summary, `series.points` drives the sparkline.
- Accept: `acceptStorageSuggestions(nodeIds)` → response carries `undo.action_id` → the
  already-mounted `useUndoToast` bundle shows "Moved N items to Trash" + Undo. A response
  WITHOUT `undo` keeps the plain report toast. Mixed outcomes toast the moved count; the
  dashboard refreshes through `loadAll`.
- Dismiss: `dismissStorageSuggestion(id)` — absorbed failure keeps the row; success refreshes
  silently (no toast — `StorageCleanupSuggestions.md` §2.3).
- The dashboard reads no actions feed, no collections list and no grants: those belong to
  `CollectionsOverview` (`GET /api/actions`, `GET /api/collections`,
  `GET /api/collections/:id/grants`).

### 2.4 Dependencies

- **imports:** MUI card/list primitives, useTranslation, formatDate/formatFileSize,
  MyPageContentPanel, useMessage/useUndoToast, ConfirmDialog, UndoToast,
  StorageCleanupSuggestions, StorageUsageSummary; data via `explorerGateway`
  (`storageRepository` re-exports).
- **Wiring:** `onNavigate` is produced by `MyPageContentArea` (`useNavigate()`) and forwarded
  through `getMyPageContentDescriptor` into the `storage` branch's `contentProps`; the
  registry carries the `storage` and `collections` entries as pure data.

### 2.5 myPageRegistry entry contract (additions)

| Entry | Shape                                                                                                    | Notes                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| user  | `{ id: 'storage', icon: <MUI>, labelKey: 'mypage.storage', visibility: 'nonAdminOnly' }`                 | Direct (single-panel) category → `StorageDashboard`                                                             |
| user  | `{ id: 'collections', icon: <MUI>, labelKey: 'mypage.collectionsOverview', visibility: 'nonAdminOnly' }` | Direct category → `CollectionsOverview` (collection status + collection journal feed, `CollectionsOverview.md`) |

- Registry entries and content-descriptor branches are pure data — `utils/myPageRegistry.md` gains the rows. Both `storage` and `collections` are `nonAdminOnly` (operator rule) and normalize to the default section for admins.

### 2.6 i18n Keys

- `mypage.storage`, `mypage.collectionsOverview`
- `mypage.storageUsageTitle`, `mypage.storageUsageTotal`, `mypage.storageUsageLive`,
  `mypage.storageUsageTrash`, `mypage.storageUsageVersions`, `mypage.storageUsageIncomplete`,
  `mypage.storageUsageSparkline`
- `mypage.hygiene*` (cards, incl. `mypage.hygieneNearDuplicatesMeta`)
- `mypage.suggestions*` (checklist-owned keys — `StorageCleanupSuggestions.md` §2.5)

### 2.7 Verification Scenarios

- [ ] Hygiene card click calls `onNavigate` (trash) or scrolls to the cleanup block (dups/suggestions) and performs NO mutation.
- [ ] Usage summary renders total/live/trash/versions; the versions row is hidden when `version_history_supported` is false; `incomplete` renders the warning.
- [ ] No quota/percent copy or element exists on the dashboard.
- [ ] Sparkline renders only with at least two points; a single point, `null` and absent data omit it.
- [ ] Sparkline x positions follow actual day gaps (a two-day gap is wider than a one-day gap).
- [ ] The dashboard does NOT render the collection journal feed, collection counts or grant rows.
- [ ] Accept with a journaled command shows the Undo toast and executes through `undoAction`; dismiss refreshes silently.
- [ ] `storage` category renders for non-admins only; `collections` category renders for non-admins only.

### 2.8 Edge Cases

- Absorbed hygiene read failure ⇒ all hygiene/suggestion blocks omitted (no crash).
- Absorbed usage read failure ⇒ summary + sparkline omitted.
- Cleanup block without persisted rows ⇒ absent.
- Operator rule (admin is a pure operator): both personal categories are hidden / never invoked for admin — deep-links normalize to the default section (no redundant checks inside the components).
