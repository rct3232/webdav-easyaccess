# MemberStateBadges Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Shared member-state BADGE markers (`shared_excluded` / publish-pending) rendered identically in ALL three member views (list/grid/detail) — the sole row-level member-state marker surface.                                                                                 |
| Used in            | FileListItem (`variant="list"`), FileGridItem (`variant="grid"` via the `CardTile` `cornerBadges` slot), FileDetailRow (`variant="detail"`) — member surfaces of `CollectionsListView` (§2.5) only; file rows never carry the flag fields, so the component renders `null`. |
| Related components | `TileCornerBadge` (grid wrapper atom), `CardTile` (`cornerBadges` slot), `MemberRowControls` (in-menu `member-not-shared` chip — menu-internal detail)                                                                                                                      |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/MemberStateBadges.js`
- **Test file:** `client/src/components/file-manager/__tests__/MemberStateBadges.test.js`

### 2.2 Module surface

| Export                          | Type      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `PublishPendingIcon`            | component | The composite pending marker: `Public` (globe, 16px) + `Pending` (10px) overlaid TOP-LEFT inside a `position: relative; display: inline-flex; 16×16` wrapper span. Defined ONCE here — the single composition source for all three views. Both icons keep the inherited glyph color; the WARNING tone is MUI `warning.main` carried by the BADGE CARRIER — never by the glyphs: grid variant plate `bgcolor` (and hover) via the `TileCornerBadge` `tone` prop, list/detail inline wrapper `color` — pin/shared/lock carriers stay neutral translucent; the icon font sizes are set via INLINE `style` so the `TileCornerBadge` `& .MuiSvgIcon-root { fontSize: 16 }` descendant rule cannot resize the 10px overlay. Overlay offset: `top: -2, left: -2` (absolute). |
| `getMemberStateBadges(file, t)` | function  | Pure gating (no JSX): returns the ordered descriptor array `[{ kind, testid, title, icon }]` per §2.3 — `[]` when nothing renders.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `hasMemberStateBadges(file)`    | function  | Flag-only presence check (no `t`): `state !== 'revoked' && (shared_excluded === true \|\| published === false)`. Slot-based consumers MUST branch on this — a plain `<MemberStateBadges/>` element prop is non-null even when it renders nothing, so `CardTile`'s `cornerBadges != null` guard alone would still emit an empty corner container over file tiles (breaks the zero-DOM-delta anchor).                                                                                                                                                                                                                                                                                                                                                                   |
| `MemberStateBadges`             | component | default export; props `{ file, variant }` (`'list'                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 'grid' | 'detail'`). Renders the descriptors per the §2.4 geometry of the variant, or `null` (zero DOM delta for file rows and revoked rows). |

### 2.3 Gating matrix (as implemented)

Badge visibility is decided ONLY by the adapter fields (`useFileManager.md` `toMemberRow`): `published`, `shared_excluded`, `state`. Badge glyphs: excluded → `VpnLock` (16px, inherited glyph color); pending → the `PublishPendingIcon` composite (§2.2).

| Row case                                  | `published` | `shared_excluded` | `state`     | excluded badge | pending badge |
| ----------------------------------------- | ----------- | ----------------- | ----------- | -------------- | ------------- |
| member, published+shared                  | `true`      | `false`           | `'normal'`  | –              | –             |
| publish-pending member                    | `false`     | `false`           | `'normal'`  | –              | ✓             |
| shared-excluded member (published)        | `true`      | `true`            | `'normal'`  | ✓              | –             |
| excluded AND pending member               | `false`     | `true`            | `'normal'`  | ✓              | –             |
| revoked member                            | `false`     | `false`           | `'revoked'` | –              | –             |
| revoked AND excluded member               | any         | `true`            | `'revoked'` | –              | –             |
| plain FILE row (fields absent)            | `undefined` | `undefined`       | `undefined` | –              | –             |
| liked-surface row (flags never serialize) | `undefined` | `false`           | `'normal'`  | –              | –             |

Rules:

- `shared_excluded === true` (STRICT) ⇒ excluded badge; `published === false` AND `shared_excluded !== true` (STRICT) ⇒ pending badge — an excluded row is un-publishable forever (its member menu omits the publish action), so publish-pending NEVER renders together with `shared_excluded`. Absent (`undefined`) fields on file-browser rows therefore render NOTHING — member-context rows only.
- `state === 'revoked'` ⇒ NEITHER badge, regardless of the flags. The server (`service.js` `resolveMemberRows`) serializes revoked stored rows with `published:false` and revoked foreign rows with `shared_excluded:true` — the revoke gate overrides those flags, so badges never render on the gray placeholder rows.
- Descriptor order when badges render is excluded FIRST, then pending — per the suppression rule only one of the two can ever be present.

### 2.4 Per-view placement geometry

| View   | Wrapper (`variant`)        | Placement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List   | `FileListItem` `"list"`    | Badge row overlays the LEADING icon/avatar column: the thumbnail container gains `position: relative`; badges render in a `position: absolute; top: 2; left: 2; z-index: 1` flex row (gap 8px) of plain 16px icon badges (no circular plate — the row background is flat paper, contrast needs none).                                                                                                                                                                                                                                                                |
| Grid   | `FileGridItem` `"grid"`    | `CardTile.cornerBadges` slot (top-left over the media, `top: 8; left: 8; z-index: 1`, gap 8px, opposite the More button at top-right) — the same geometry as the collection-card corner badges; each badge is a `TileCornerBadge` (28px translucent-black circular plate, 16px icon) for legibility over arbitrary thumbnails. The `FileGridItem` slot value is `hasMemberStateBadges(file) ? <MemberStateBadges variant="grid" /> : null` — see §2.2 (a bare element prop is non-null even when empty, which would emit an empty corner container over file tiles). |
| Detail | `FileDetailRow` `"detail"` | INLINE plain 16px icon badges inside the NAME cell's existing flex row (`gap: 0.75`), between the leading `getFileIcon` glyph and the truncated name — same icon sizes as the list overlay, no absolute positioning inside the table cell.                                                                                                                                                                                                                                                                                                                           |

Each badge (all variants) carries:

- `data-testid`: `member-excluded-badge-<nodeId>` / `member-publish-pending-badge-<nodeId>` (on the badge wrapper element itself — the `TileCornerBadge` span in grid, the Tooltip span in list/detail);
- `aria-label`: the tooltip string (tooltips are hover-only; the aria label is the accessible name);
- Tooltip: excluded → `fileManager.memberNotShared` (same string the `MemberRowControls` in-menu `member-not-shared` chip header uses), pending → `fileManager.memberUnpublishedBadge`.

The badge testids above are the ONLY member-state row markers; no `-chip-` testid variants exist (unit tests, E2E, specs).

### 2.5 i18n keys

- `fileManager.memberNotShared` — excluded badge tooltip/aria (EN "Not owner's file — not shared", KO "소유자의 파일이 아닙니다 — 공유되지 않음").
- `fileManager.memberUnpublishedBadge` — pending badge tooltip/aria (EN "Awaiting publish", KO "게시 대기").

### 2.6 Memo/re-render contract

- `FileListItem` / `FileGridItem` memo comparators ALREADY compare `file.published` / `file.shared_excluded` / `file.state` — the badge fields are exactly these; no comparator change.
- `FileDetailRow` keeps the DEFAULT `React.memo` shallow compare: the member adapter re-maps every row on load/publish flip, so the fresh object identity re-renders the row; a field-only custom comparator would RISK stale `dragHandlers`/`dropHandlers` closures — not added.

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Composite icon: exactly two SVGs (globe + clock) inside one relative wrapper; overlay 10px absolutely positioned top-left; glyphs carry NO icon-level color (tone lives on the badge carrier).
- [ ] Gating matrix (§2.3) row-for-row: none / excluded only / pending only / excluded+pending ⇒ excluded ONLY (pending suppressed) / revoked none / revoked+excluded none / plain file row none.
- [ ] Testids `member-excluded-badge-<nodeId>` / `member-publish-pending-badge-<nodeId>`; aria-labels equal the `fileManager.memberNotShared` / `fileManager.memberUnpublishedBadge` strings (both locales); chip testids are GONE.
- [ ] Grid variant renders inside the `CardTile` corner-badge container (`TileCornerBadge` plates); list variant overlays the thumbnail column; detail variant renders inline before the name.
- [ ] Zero DOM delta for plain file rows and revoked rows in all three variants.

### 2.8 Edge Cases

- Bulk-selection surfaces hide the More button but NOT the badges (state markers, not actions).
- Liked-surface rows (`serializeLikedItem`): `published`/`shared_excluded` never arrive ⇒ nothing renders (adapter coerces `shared_excluded:false`, leaves `published:undefined`).
- Drop-target rows recolor glyphs to white via the row/card `& .MuiSvgIcon-root { color: white }` rules; the pending PLATE keeps its warning fill (plate-level bgcolor), glyphs white — legible on the primary fill.
