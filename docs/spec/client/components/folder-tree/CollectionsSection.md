# CollectionsSection Spec

Target-contract spec.

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Collapsible folder-tree section for the `__collections__` virtual node (depth=1): header + a static `Likes` child row AT THE TOP + activity-ordered collection rows (plain Collections icon — received distinction lives on the card badge only) + a trailing `__archive__` node (`ArchiveNode`). No tree-walking into members. |
| Used in            | FolderTree (desktop sidebar + mobile drawer), composed like `RecentFilesSection`/`SharedFoldersSection`                                                                                                                                                                                                                         |
| Related components | TreeRow (shared child-row primitive), BaseFolderTreeItem (selected-style idiom), RecentFilesSection (collapsible idiom), CollectionsListView (click target view)                                                                                                                                                                |

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
| collections         | array    | Y        | -       | snake_case Collection rows, server `activity` order (tree order is FIXED activity — never user-sortable)       |
| currentPath         | string   | Y        | -       | Selection keying (see §2.4)                                                                                    |
| onCollectionClick   | function | Y        | -       | Row click: `(collectionId) => void` → host routes `/files/__collections__/collection/:id`                      |
| onArchiveClick      | function | Y        | -       | ArchiveNode click → `/files/__collections__/__archive__`                                                       |
| onLikesClick        | function | Y        | -       | Likes row click → `/files/__collections__/liked`                                                               |
| newCollectionIds    | array    | N        | []      | Ids with the subtle `new` dot (never-opened cue; computed by the controller from the server cursor — see §2.6) |

### 2.3 Rendering Contract

- **Child-row rendering (TreeRow):** every section child row
  (LikesNode, collection rows, ArchiveNode) renders through the shared `TreeRow` primitive at
  `level = 1` with the reserved `TreeRowSpacer` leading column — computed `padding-left: 16px`
  and icon offset identical to a shared-folder/file-tree child row
  (`pl: level*2`, the unified tree indent rule; pinned cross-section in `TreeRow.test.js` and the
  per-section computed-paddingLeft tests). Section children use the tree's level-based indent:
  the sections and the file tree share ONE row implementation.
- Header row: `{CollectionsIcon} Collections` (`nav.collections`), collapsible like RecentFilesSection.
- **Header expansion contract:** the `collections-toggle` control exposes
  `aria-expanded={collectionsExpanded}`. The section is a controlled view: when the
  current route is `/__collections__` or a descendant, the controller auto-expands the
  section on first render/remount; an undo/notifier refresh preserves the current
  expansion; a manual collapse is preserved while the route is unchanged. Collapsed
  state is never inferred from row absence: `aria-expanded` distinguishes collapsed
  from expanded, and an expanded section with zero rows renders the empty hint. A
  row-load failure is not represented as a collapse; expansion remains route/manual
  state, so a failed load cannot masquerade as a user collapse.
- Collection row: icon + name (the row secondary keeps only the `new` dot — no item-count
  display); **shared-with-me rows** (`granted_role != null`)
  render the plain collections icon and are never hoisted — same
  activity-sorted list. Pinned (`pinned=true`)
  rows keep server order (gravity, not hoisting).
- **ArchiveNode:** auto-child at the section end listing exactly the `status=archived` collections as a navigable node — no separate archive screen, no per-collection archive toggle in the tree. The row renders unconditionally (the lifecycle destination must stay reachable even at count 0). **No count badge** — the sidebar shows no numeric counts, and no `archiveCount` read exists.
- **LikesNode:** static child row
  rendering at the TOP of the section body — immediately BEFORE the active collection rows (the
  ArchiveNode stays the section tail), inside the same Collapse — same always-rendered
  zero-state rule as ArchiveNode (the destination lists `GET /api/file-likes/items` live; an empty
  like set is a legal empty view, never a hidden route). `FavoriteBorderIcon` + label
  `nav.collectionsLiked`; no count badge (the row listing is a per-open full fetch
  and the sidebar holds no such read; no count read exists). `data-testid="collections-liked-node"`.
- Rows display NO member count — depth-1 stays: no per-row lazy child loading;
  `item_count` is wire data only, never rendered.

### 2.4 Selection & Conditional Rendering

- Selected (BaseFolderTreeItem idiom) when `currentPath === '/__collections__'` (section header/highlight) or equals a collection, the liked route (`'/__collections__/liked'`) or the archive route.
- Empty list ⇒ header only + `nav.collectionsEmpty` hint when expanded. ArchiveNode follows the §2.3 zero-render rule (always present): the empty destination is not dead — `/files/__collections__/__archive__` renders `fileManager.archiveEmpty` (CollectionsListView §2.2), so the lifecycle destination stays reachable at count 0.
- Hidden entirely in share-link mode (product overlay rule — shell passes no section).

### 2.5 Dependencies

- **imports:** MUI tree primitives, `useTranslation`, `TreeRow` (child rows; the primitive owns
  `pixelMiddleTruncate`/width observation internally), `getFileIcon`-adjacent glyphs only.
- **Boundary:** pure view — the controller loads rows via one `explorerGateway.loadCollections({ sort: 'activity', include: 'mine,shared' })` read (no badge read — there is no second `include: 'mine,archived'` fetch and no count badge) and subscribes to `subscribeToCollections`; this component never imports services/notifier. Controller surface: `docs/spec/client/hooks/useFolderTreeController.md` §3.

### 2.6 i18n Keys

- `nav.collections`, `nav.collectionsArchive`, `nav.collectionsLiked` (LikesNode label — EN "Liked" / KO "좋아요"), `nav.collectionsEmpty`, `nav.collectionsSharedChip` (aria-label), `nav.collectionsNewDot` (aria-label)
- `new` dot rule (controller side, noted for contract completeness):
  dot ⇔ the row's `last_visited_at == null` — the requesting user has NEVER opened that
  collection (the server digest cursor is the only visit state; there is no client-side
  visit-cursor storage). The creator is seeded at create, so self-created collections never
  dot. Opening stamps the cursor; the dot clears on the next list refresh (the controller
  re-fetches when returning to `/__collections__`). Both revoke paths delete the grantee's
  cursor row server-side, so a re-grant RE-DOTS; undo of a revoke restores the grant but not
  the cursor, so undo-revoke re-dots too. No sidebar chips for merges.

### 2.7 Verification Scenarios

- [ ] Header toggles expand/collapse; header click navigates to `__collections__`.
- [ ] `collections-toggle` exposes `aria-expanded` equal to `collectionsExpanded`; a
      collapsed section is distinguishable from an expanded empty section (empty hint).
- [ ] A route-driven expansion and a later manual collapse keep their respective
      `aria-expanded` states across a row refresh (no internal state overrides the prop).
- [ ] Rows render in given order (no client re-sort); NO count text (secondary is the
      `new` dot only).
- [ ] `granted_role != null` row shows the PLAIN collections icon (no chip) and is NOT hoisted.
- [ ] ArchiveNode click invokes `onArchiveClick`; selected styling matches its route.
- [ ] Likes row renders unconditionally (empty like set still navigable) before ArchiveNode; click invokes `onLikesClick`; selected styling matches `/__collections__/liked`.
- [ ] `newCollectionIds` dots render/clear per prop change only (no internal state).
- [ ] Empty list renders header + empty hint without crashing.

### 2.8 Edge Cases

- Duplicate render keys impossible (server list is full, unpaginated).
- Very long names: middle truncation + tooltip, rendered by the shared `TreeRow` primitive
  (single font-metrics source with RecentFilesSection/file-tree rows).
- Operator rule (admin is a pure operator): the section is NEVER mounted for admin (`user.is_admin`) — hidden via the FolderTree mount gate; the component itself stays role-neutral.
