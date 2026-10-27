# CollectionMembershipBadges Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role               | Shared collection-membership BADGE markers rendered on FILES-surface rows (list/grid/detail): one badge per containing collection plus a capped `+N` overflow marker. Host-prepared data only — the component performs no IO (the batched read is `useCollectionMemberships`).       |
| Used in            | `FileListItem` (`variant="list"`), `FileGridItem` (`variant="grid"` via the `CardTile` `cornerBadges` slot), `FileDetailRow` (`variant="detail"`) — authenticated explorer sessions; member/liked surfaces host the same row components WITHOUT the data, so no badges render there. |
| Related components | `TileCornerBadge` (grid wrapper atom), `CardTile` (`cornerBadges` slot), `MemberStateBadges` (sibling badge family, same three-variant geometry), `useCollectionMemberships` (data owner)                                                                                            |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/CollectionMembershipBadges.js`
- **Test file:** `client/src/components/file-manager/__tests__/CollectionMembershipBadges.test.js`

### 2.2 Module surface

| Export                                              | Type      | Description                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEMBERSHIP_BADGE_CAP`                              | constant  | `2` — maximum per-collection badges rendered per row; any remainder collapses into ONE `+N` overflow badge (so a row carries at most three corner plates).                                                                                                                                                    |
| `getCollectionMembershipBadges(entries, t, nodeId)` | function  | Pure descriptor builder (no JSX): returns the ordered array `[{ kind, testid, title, icon? , text? }]` — first `MEMBERSHIP_BADGE_CAP` entries render `kind: 'collection'`, a remainder renders a trailing `kind: 'more'` descriptor carrying the literal `+<n>` in `text`. `[]` when entries is empty/absent. |
| `hasCollectionMembershipBadges(entries)`            | function  | Presence check (no `t`): non-empty array. Slot-based consumers MUST branch on this — a rendered element is non-null even when it shows nothing, so `CardTile`'s `cornerBadges != null` guard alone would emit an empty corner container over membership-free tiles (mirrors `hasMemberStateBadges`).          |
| `CollectionMembershipBadges`                        | component | default export; props `{ nodeId, entries, variant, overlayTop? }` (`variant: 'list' \| 'grid' \| 'detail'`). Renders the descriptors per the §2.4 geometry, or `null` (zero DOM delta when entries is empty/absent).                                                                                          |

`entries` is the host-prepared row slice: `[{ id, name }]` — one element per containing collection, ordered per `useCollectionMemberships` (collections-list order). The component never resolves names itself.

### 2.3 Gating

- `entries` absent or `[]` ⇒ the component returns `null` and the slot guard yields `null` — zero DOM delta. Rows the membership read failed to cover simply carry no entries (the IO layer swallows failures to no-chips — `collectionsRepository.md`).
- Entries render in the given order; the first two carry `Collections` glyph badges (sidebar-collections glyph, 16px, inherited glyph color — neutral, no warning tone: membership is a fact, not an alert state).
- When `entries.length > MEMBERSHIP_BADGE_CAP` the trailing badge is the literal text `+<n>` where `n = entries.length - MEMBERSHIP_BADGE_CAP`, tooltip/aria `fileManager.membershipChipMore` with `{ count: n, names: <remaining names, comma-joined> }`.

### 2.4 Per-view placement geometry (MemberStateBadges family)

| View   | Wrapper (`variant`)        | Placement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List   | `FileListItem` `"list"`    | Flex row overlaying the LEADING icon/avatar column: `position: absolute; left: 2; z-index: 1; display: flex; gap: 0.5`, `top: 2` by default; plain 16px glyphs (no plate). The `top` position is the `overlayTop` prop: when the row ALSO renders the search read-only `EditOff` overlay (which owns `top: 2`), the host passes `overlayTop: 20` so the membership row stacks BELOW it — the two overlays never share a corner coordinate. Member-state badges never coexist with membership badges (see §1 exclusivity), so no three-way stacking exists. |
| Grid   | `FileGridItem` `"grid"`    | Joins the `CardTile.cornerBadges` slot (top-left over the media, 8px inset, gap 8px, opposite the More action). Each per-collection badge is a `TileCornerBadge` (28px translucent circular plate, 16px icon); the `+N` overflow is the same plate carrying centered 11px white text. The slot value is `<MemberStateBadges/>` plates followed by `<CollectionMembershipBadges/>` plates when both sets are present (structurally exclusive today; the concatenation keeps the zero-DOM rule: `null` only when BOTH presence checks are false).            |
| Detail | `FileDetailRow` `"detail"` | INLINE plain 16px glyphs inside the NAME cell's existing flex row (`gap: 0.75`), after the member-state inline badges and before the truncated name; `+N` renders as caption-size text.                                                                                                                                                                                                                                                                                                                                                                    |

Each badge (all variants) carries:

- `data-testid`: `membership-badge-<nodeId>-<collectionId>` / overflow `membership-badge-more-<nodeId>` (on the badge wrapper element — `TileCornerBadge` span in grid, the Tooltip span in list/detail);
- `aria-label`: the tooltip string (accessible name; tooltips are hover-only);
- Tooltip: per-collection → `fileManager.membershipChip` with `{ name }`.

### 2.5 i18n keys

- `fileManager.membershipChip` — per-badge tooltip/aria (EN "Member of {{name}}", KO "{{name}} 컬렉션에 포함").
- `fileManager.membershipChipMore` — overflow tooltip/aria (EN "+{{count}} more — {{names}}", KO "+{{count}}개 더 — {{names}}").

Both keys exist in `en.json` AND `ko.json` (mirror rule, `docs/spec/client/i18n.md`).

### 2.6 Data-flow contract (host side)

- The map arrives as prop `membershipsByNodeId` (`{ [nodeId]: [{ id, name }] }`) from `useCollectionMemberships` through `FileManagerView` → `FileGrid`/`FileList`/`FileDetail`; each list renderer slices per row and passes `memberships` to the item.
- Listing payloads never carry membership (file-listing contracts frozen — `routes/collections.md`); the badges render from the separate batched read only.
- Memoization: `FileListItem`/`FileGridItem` custom comparators compare the `memberships` PROP BY IDENTITY (the host map keeps a stable array per node until its membership or the collection list changes). `FileDetailRow` keeps the default shallow `React.memo` compare — the prop identity comparison falls out of the shallow check; no custom comparator is added (stale drag-closure rule).

### 2.7 Verification Scenarios

- [ ] Empty/absent entries ⇒ `null`; `hasCollectionMembershipBadges` false ⇒ the grid slot renders no corner container (zero DOM delta anchor for every existing tile test).
- [ ] One/two collections ⇒ exactly that many badges, correct testids, tooltip = `membershipChip` with the collection name (both locales).
- [ ] Three+ ⇒ two collection badges + one `+<n>` overflow badge (testid `membership-badge-more-<nodeId>`, count and joined remaining names in the tooltip).
- [ ] Grid plates are `TileCornerBadge` spans (not buttons — badges carry no click action); list overlay honors `overlayTop` (2 default, 20 when the read-only search overlay renders).
- [ ] Descriptors ordered: collections in host-given order, overflow last.

### 2.8 Edge Cases

- Bulk-selection surfaces hide the More button but NOT the badges (state markers, not actions).
- A collection id with no row in the collections list (created between reads — both re-read on the same notifier event) never reaches `entries` (filtered by the hook), so a badge never renders an unresolvable name.
- Share-link mode and admin sessions: the host injects the inert gateway, `entries` are always absent ⇒ zero badges and zero IO.
