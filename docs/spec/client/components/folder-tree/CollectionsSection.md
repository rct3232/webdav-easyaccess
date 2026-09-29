# CollectionsSection Spec

Target-contract spec.

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Collapsible folder-tree section for the `__collections__` virtual node (depth=1): header + activity-ordered collection rows + shared-origin icon chips + a static `Likes` child row (P-5) + a trailing `__archive__` node (`ArchiveNode`). No tree-walking into members (§3.1). |
| Used in            | FolderTree (desktop sidebar + mobile drawer), composed like `RecentFilesSection`/`SharedFoldersSection`                                                                                                                                                                         |
| Related components | BaseFolderTreeItem (selected-style idiom), RecentFilesSection (collapsible idiom), CollectionsListView (click target view)                                                                                                                                                      |

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
| archiveCount        | number   | N        | 0       | Count badge on the ArchiveNode (`include=mine,archived` rows)                                                  |
| currentPath         | string   | Y        | -       | Selection keying (see §2.4)                                                                                    |
| onCollectionClick   | function | Y        | -       | Row click: `(collectionId) => void` → host routes `/files/__collections__/collection/:id`                      |
| onArchiveClick      | function | Y        | -       | ArchiveNode click → `/files/__collections__/__archive__`                                                       |
| onLikesClick        | function | Y        | -       | (P-5) Likes row click → `/files/__collections__/liked`                                                         |
| newCollectionIds    | array    | N        | []      | Ids with the subtle `new` dot (system-create cue, §4.11 surface 5; computed by the controller — see §2.6)      |

### 2.3 Rendering Contract

- Header row: `{CollectionsIcon} Collections` (`nav.collections`), collapsible like RecentFilesSection.
- Collection row: icon + name + item count; **shared-with-me rows** (`granted_role != null`) get an icon chip ONLY — never pinned to top, same activity-sorted list (§3.1). Pinned (`pinned=true`) rows keep server order (gravity, not hoisting).
- **ArchiveNode:** auto-child at the section end listing exactly the `status=archived` collections as a navigable node — no separate archive screen, no per-collection archive toggle in the tree (§3.1). Badge = `archiveCount`; zero ⇒ row still renders (the lifecycle destination must stay reachable). **Decision (T0.4):** the earlier "renders only when `archiveCount > 0`" wording contradicted this zero-render rule — the row renders unconditionally (the destination must stay reachable even at count 0); the badge simply hides at 0.
- **LikesNode (P-5, owner ruling 2026-09-29):** static child row rendering immediately BEFORE the
  ArchiveNode (the section tail stays archive's), inside the same Collapse — same always-rendered
  zero-state rule as ArchiveNode (the destination lists `GET /api/file-likes/items` live; an empty
  like set is a legal empty view, never a hidden route). `FavoriteBorderIcon` + label
  `nav.collectionsLiked`; no count badge (the listing is cursor-paged/unbounded-cheap — no count
  read exists). `data-testid="collections-liked-node"`.
- **Decision:** member counts come from `item_count` (already on the row); no per-row lazy child loading (depth=1 rule).

### 2.4 Selection & Conditional Rendering

- Selected (BaseFolderTreeItem idiom) when `currentPath === '/__collections__'` (section header/highlight) or equals a collection, the P-5 liked route (`'/__collections__/liked'`) or the archive route.
- Empty list ⇒ header only + `nav.collectionsEmpty` hint when expanded. **Decision (T0.4):** ArchiveNode follows the §2.3 zero-render rule (always present) — the earlier "renders only when `archiveCount > 0`" alternative is retired because the empty destination is not dead: `/files/__collections__/__archive__` renders `fileManager.archiveEmpty` (CollectionsListView §2.2), so the lifecycle destination stays reachable at count 0.
- Hidden entirely in share-link mode (product overlay rule — shell passes no section).

### 2.5 Dependencies

- **imports:** MUI tree primitives, `useTranslation`, `getFileIcon`-adjacent glyphs only.
- **Boundary:** pure view — the controller loads rows via `explorerGateway.loadCollections({ sort: 'activity', include: 'mine,shared' })` (badge via a second `include: 'mine,archived'` read) and subscribes to `subscribeToCollections`; this component never imports services/notifier. As-built controller surface: `docs/spec/client/hooks/useFolderTreeController.md` §3 (updated with the T0.4 implementation).

### 2.6 i18n Keys

- `nav.collections`, `nav.collectionsArchive`, `nav.collectionsLiked` (P-5 LikesNode label — EN "Liked" / KO "좋아요"), `nav.collectionsEmpty`, `nav.collectionsSharedChip` (aria-label), `nav.collectionsNewDot` (aria-label)
- `new` dot rule (controller side, noted for contract completeness): collection ids created after the user's last `__collections__` visit (localStorage cursor, digest-cursor parity precedent) get the dot; visiting clears it. No sidebar chips for merges (§4.4 rejection).

### 2.7 Verification Scenarios

- [ ] Header toggles expand/collapse; header click navigates to `__collections__`.
- [ ] Rows render in given order (no client re-sort); count shown from `item_count`.
- [ ] `granted_role != null` row shows the chip and is NOT hoisted.
- [ ] ArchiveNode click invokes `onArchiveClick`; selected styling matches its route.
- [ ] (P-5) Likes row renders unconditionally (empty like set still navigable) before ArchiveNode; click invokes `onLikesClick`; selected styling matches `/__collections__/liked`.
- [ ] `newCollectionIds` dots render/clear per prop change only (no internal state).
- [ ] Empty list renders header + empty hint without crashing.

### 2.8 Edge Cases

- Duplicate render keys impossible (server list is full, unpaginated — collections.md Decision).
- Very long names: middle truncation + tooltip per the RecentFilesSection UI-enhancement idiom.
