# CollectionsSection Spec

Target-contract spec.

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Collapsible folder-tree section for the `__collections__` virtual node (depth=1): header + a static `Likes` child row AT THE TOP (M-2) + activity-ordered collection rows (plain Collections icon — the received icon swap was RETIRED 2026-10-01; received distinction lives on the card badge only) + a trailing `__archive__` node (`ArchiveNode`). No tree-walking into members (§3.1). |
| Used in            | FolderTree (desktop sidebar + mobile drawer), composed like `RecentFilesSection`/`SharedFoldersSection`                                                                                                                                                                                                                                                                                     |
| Related components | TreeRow (shared child-row primitive), BaseFolderTreeItem (selected-style idiom), RecentFilesSection (collapsible idiom), CollectionsListView (click target view)                                                                                                                                                                                                                            |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/CollectionsSection.js` (ArchiveNode is a row variant in the same module — one spec, one file; no separate tree component)
- **Test file:** `client/src/components/folder-tree/__tests__/CollectionsSection.test.js`

### 2.2 Props

| Name                | Type     | Required | Default | Description                                                                                                    |
| ------------------- | -------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| collectionsExpanded | boolean  | Y        | -       | Section expanded                                                                                               |
| onCollectionsToggle | function | Y        | -       | Expand/collapse header                                                                                         |
| onCollectionsClick  | function | Y        | -       | Header click → navigate `/files/__collections__`                                                               |
| collections         | array    | Y        | -       | snake_case Collection rows, server `activity` order (tree order is FIXED activity, §3.1 — never user-sortable) |
| currentPath         | string   | Y        | -       | Selection keying (see §2.4)                                                                                    |
| onCollectionClick   | function | Y        | -       | Row click: `(collectionId) => void` → host routes `/files/__collections__/collection/:id`                      |
| onArchiveClick      | function | Y        | -       | ArchiveNode click → `/files/__collections__/__archive__`                                                       |
| onLikesClick        | function | Y        | -       | (P-5) Likes row click → `/files/__collections__/liked`                                                         |
| newCollectionIds    | array    | N        | []      | Ids with the subtle `new` dot (system-create cue, §4.11 surface 5; computed by the controller — see §2.6)      |

### 2.3 Rendering Contract

- **Child-row rendering (TreeRow, owner ruling 2026-10-01, PLAN §12):** every section child row
  (LikesNode, collection rows, ArchiveNode) renders through the shared `TreeRow` primitive at
  `level = 1` with the reserved `TreeRowSpacer` leading column — computed `padding-left: 16px`
  and icon offset identical to a shared-folder/file-tree child row
  (`pl: level*2`, the unified tree indent rule; pinned cross-section in `TreeRow.test.js` and the
  per-section computed-paddingLeft tests). The earlier F5 pin (`sx={{ pl: 3 }}` ⇒ 24px equality
  between the two sections) is RETIRED: section children intentionally moved onto the tree's
  level-based indent, so the sections and the file tree now share ONE row implementation instead
  of two parallel indent idioms.
- Header row: `{CollectionsIcon} Collections` (`nav.collections`), collapsible like RecentFilesSection.
- Collection row: icon + name (**M-1, 2026-09-30: the secondary item-count display is REMOVED** —
  the row secondary keeps only the `new` dot); **shared-with-me rows** (`granted_role != null`)
  render the plain collections icon (2026-10-01 owner ruling) and are never hoisted — same
  activity-sorted list (§3.1). Pinned (`pinned=true`)
  rows keep server order (gravity, not hoisting).
- **ArchiveNode:** auto-child at the section end listing exactly the `status=archived` collections as a navigable node — no separate archive screen, no per-collection archive toggle in the tree (§3.1). The row renders unconditionally (the lifecycle destination must stay reachable). **Decision (T0.4):** the earlier "renders only when `archiveCount > 0`" wording contradicted this zero-render rule — the row renders unconditionally (the destination must stay reachable even at count 0); **No count badge (owner ruling, 2026-10-01 §11 follow-up):** the former `archiveCount` badge — and the second `mine,archived` fetch feeding it — are removed (M-1 purity: the sidebar shows no numeric counts).
- **LikesNode (P-5, owner ruling 2026-09-29; MOVED TO TOP by M-2, 2026-09-30):** static child row
  rendering at the TOP of the section body — immediately BEFORE the active collection rows (the
  ArchiveNode stays the section tail), inside the same Collapse — same always-rendered
  zero-state rule as ArchiveNode (the destination lists `GET /api/file-likes/items` live; an empty
  like set is a legal empty view, never a hidden route). `FavoriteBorderIcon` + label
  `nav.collectionsLiked`; no count badge (the row listing is a per-open full fetch — Decision B,
  2026-09-29 — and the sidebar holds no such read; no count read exists). `data-testid="collections-liked-node"`.
- **Decision (M-1 amended, 2026-09-30):** rows display NO member count (the former
  `item_count` secondary text is removed — depth-1 stays: no per-row lazy child loading;
  `item_count` remains wire data, just unrendered).

### 2.4 Selection & Conditional Rendering

- Selected (BaseFolderTreeItem idiom) when `currentPath === '/__collections__'` (section header/highlight) or equals a collection, the P-5 liked route (`'/__collections__/liked'`) or the archive route.
- Empty list ⇒ header only + `nav.collectionsEmpty` hint when expanded. **Decision (T0.4):** ArchiveNode follows the §2.3 zero-render rule (always present) — the earlier "renders only when `archiveCount > 0`" alternative is retired because the empty destination is not dead: `/files/__collections__/__archive__` renders `fileManager.archiveEmpty` (CollectionsListView §2.2), so the lifecycle destination stays reachable at count 0.
- Hidden entirely in share-link mode (product overlay rule — shell passes no section).

### 2.5 Dependencies

- **imports:** MUI tree primitives, `useTranslation`, `TreeRow` (child rows; the primitive owns
  `pixelMiddleTruncate`/width observation internally), `getFileIcon`-adjacent glyphs only.
- **Boundary:** pure view — the controller loads rows via `explorerGateway.loadCollections({ sort: 'activity', include: 'mine,shared' })` (badge via a second `include: 'mine,archived'` read) and subscribes to `subscribeToCollections`; this component never imports services/notifier. As-built controller surface: `docs/spec/client/hooks/useFolderTreeController.md` §3 (updated with the T0.4 implementation).

### 2.6 i18n Keys

- `nav.collections`, `nav.collectionsArchive`, `nav.collectionsLiked` (P-5 LikesNode label — EN "Liked" / KO "좋아요"), `nav.collectionsEmpty`, `nav.collectionsSharedChip` (aria-label), `nav.collectionsNewDot` (aria-label)
- `new` dot rule (controller side, noted for contract completeness): collection ids created after the user's last `__collections__` visit (localStorage cursor, digest-cursor parity precedent) get the dot; visiting clears it. No sidebar chips for merges (§4.4 rejection).

### 2.7 Verification Scenarios

- [ ] Header toggles expand/collapse; header click navigates to `__collections__`.
- [ ] Rows render in given order (no client re-sort); NO count text (M-1 — secondary is the
      `new` dot only).
- [ ] `granted_role != null` row shows the PLAIN collections icon (no chip) and is NOT hoisted.
- [ ] ArchiveNode click invokes `onArchiveClick`; selected styling matches its route.
- [ ] (P-5) Likes row renders unconditionally (empty like set still navigable) before ArchiveNode; click invokes `onLikesClick`; selected styling matches `/__collections__/liked`.
- [ ] `newCollectionIds` dots render/clear per prop change only (no internal state).
- [ ] Empty list renders header + empty hint without crashing.

### 2.8 Edge Cases

- Duplicate render keys impossible (server list is full, unpaginated — collections.md Decision).
- Very long names: middle truncation + tooltip, rendered by the shared `TreeRow` primitive
  (single font-metrics source with RecentFilesSection/file-tree rows).
- Operator rule (admin is a pure operator — PLAN §14 client half): the section is NEVER mounted for admin (`user.is_admin`) — hidden via the FolderTree mount gate; the component itself stays role-neutral.
