# CollectionsListView Spec

Target-contract spec.

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role               | The `__collections__` surface: **list mode** (collection cards with sort menu incl. similar-cluster headers, merge-card slot) and **member mode** (an opened collection's stored ∪ derived − exclusions listing with digest + publish-pending banners). Explorer rows reused for members; collection cards for the list. |
| Used in            | FileManager page shell (virtual-collection overlay, alongside the `__recent__`/`__shared__`/`__trash__` precedents)                                                                                                                                                                                                      |
| Related components | MergeProposalCard, MemberRowControls, CollectionsSection (tree), FileList/FileGrid (member row rendering), CollectionPropertiesDialog, ConfirmDialog                                                                                                                                                                     |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/CollectionsListView.js`
- **Test file:** `client/src/components/file-manager/__tests__/CollectionsListView.test.js`

### 2.2 Routes & Modes

- `/files/__collections__` — list mode (`include=mine,shared`).
- `/files/__collections__/collection/:id` — member mode (`GET /:id/items` cursor paging, activity-score order server-side).
- `/files/__collections__/__archive__` — list mode, `include=mine,archived`, permanent-delete affordances enabled (§3.2).
- **Decision:** route shapes extend the trash virtual-node pattern (`/files/__trash__/node/:id`).

### 2.3 Props (prepared by `useCollections` + listing seam — pure view)

| Name                | Type      | Required | Description                                                                                             |
| ------------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------- |
| mode                | string    | Y        | `'list' \| 'members'`                                                                                   |
| collections         | array     | list     | snake_case rows for the active `sort`                                                                   |
| sort / onSortChange | fn        | list     | Menu options `activity (default) \| name \| created \| updated \| similar` (§3.1)                       |
| mergeSlot           | ReactNode | list     | Host injects `MergeProposalCard`; **zero pending ⇒ zero layout footprint** (no placeholder, no padding) |
| items / nextCursor  | array/fn  | members  | Member rows + `loadMore` (cursor)                                                                       |
| digest              | object?   | members  | `{ added_since, removed_since }` + expanded reasons (see §2.5)                                          |
| publishPendingCount | number?   | members  | Owner-only (`publish_pending_count`); grantee rows never carry it                                       |
| onCardAction        | fn        | list     | `(action, collection) => void` — card context-menu dispatch (see §2.4)                                  |
| onMemberAction      | fn        | members  | `(action, memberRow) => void` — see `MemberRowControls.md`                                              |
| onPublishBatch      | fn        | members  | Publish-pending banner batch action (DEF-25 seam)                                                       |

### 2.4 List Mode

- Card: name, `item_count`, origin/status chips, shared icon chip (`granted_role != null`), auto-pin chip when `pinned_by='auto'` (subtle, with unpin CTA — §4.9b).
- **Sort `similar`:** server pre-groups rows (`cluster_index: 0|1|…`); view renders cluster GROUP HEADERS (unlabeled visual groups), not one path order (§3.1). Other sorts render a flat list.
- **Card context menu by origin (§3.2):** own (`user|system` rows): 열기 / 이름변경 (→ server sets `name_locked`) / pin·unpin / 아카이브 (ONE confirm) / 공유 설정 (opens CollectionPropertiesDialog 공유 tab) / 삭제 (visible ONLY in `__archive__`, second-step confirm, trash-parity, report-only toast). Viewer-received rows (`granted_role != null`): 열기, `나가기` (hide, local — DEF-25 `leave` gap), NO mutations.

### 2.5 Member Mode — top-of-list banners (same digest surface, §4.7/§4.8)

- **Digest banner:** one line `+N / -M / 병합 1 · 펼치기` from `GET /:id/items?since=`; `since` = per-collection last-visit timestamp held client-side (localStorage; **Decision:** the server stamps its own cursor implicitly — the client copy exists only to request `digest` deltas on first paint after navigation). Expanded = per-entry rows with `왜 여기에` answers = item `reason` (matched predicate name, query-time, not a history table) + undo links for system-act entries (≤24h, §4.11 surface 2).
- **Publish-pending banner:** owner sees `공유 대기 N` (`publish_pending_count`) with batch/individual publish (DEF-25); only when the collection is live-shared and `publish_mode != auto`. Hidden for grantees (field absent server-side).
- Member rows render through the existing row components (icon/name/size/date from enrichment — search.md Decision reuse) with `MemberRowControls` menus; row states: `state:'revoked'` ⇒ gray placeholder WITHOUT filename/thumbnail; `shared_excluded:true` ⇒ `타인 소유 — 공유 제외` chip (owner view only); trashed-by-owner ⇒ absent (server hides).
- Initial `seed`/`search` members are already `published:true` (Q2) — never park in the banner retroactively.

### 2.6 Dependencies

- **imports:** MUI list/card primitives, `useTranslation`, format helpers, row components — NO services/gateways (props only).

### 2.7 i18n Keys

- `fileManager.collectionsSort*` (5 options), `fileManager.collectionsEmpty`, `fileManager.archiveEmpty`, `fileManager.digestLine`, `fileManager.digestExpand`, `fileManager.whyHere`, `fileManager.publishPending`, `fileManager.publishBatch`, `fileManager.sharedExcludedChip`, `fileManager.cardMenu*`

### 2.8 Verification Scenarios

- [ ] Sort menu switches fetch params; `similar` renders cluster headers per `cluster_index` runs.
- [ ] Empty suggestions ⇒ no merge-card DOM node (zero footprint).
- [ ] Banner order: merge card (list) / digest + publish-pending (members); both co-render in member mode.
- [ ] Archive-mode cards expose 삭제; live cards do NOT (2-step lifecycle enforced in UI).
- [ ] Viewer-received card menu has no mutation entries.
- [ ] Revoked member renders no name/thumbnail; grantee never sees `shared_excluded` chip or pending banner.
- [ ] `auto` publish_mode collection shows no pending banner even after adds.

### 2.9 Edge Cases

- Cursor list while definition re-evaluates between pages: de-dup by `node_id` client-side; no re-order of rendered pages (stability over freshness).
- Name collision rename: server suffixes; refresh shows final name.
