# TreeRow Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Shared sidebar ROW PRIMITIVE: the single visual/behavioral core of every folder-tree child row (file-tree rows, shared-folder rows, recent rows, collection/Likes/Archive rows). Owner ruling 2026-10-01 (PLAN §12) unifies these rows onto one implementation. |
| Used in            | `BaseFolderTreeItem` (file/shared/share-link rows), `RecentFilesSection` (child rows), `CollectionsSection` (collection/Likes/Archive rows)                                                                                                                     |
| Related components | `BaseFolderTreeItem`, `RecentFilesSection`, `CollectionsSection`, `useObservedElementWidth`, `pixelMiddleTruncate`                                                                                                                                              |
| Ownership note     | Pure view. Renders a row from props only; owns no controller, service, or DnD logic.                                                                                                                                                                            |

### Non-goals (binding)

- **No drag/drop, rename, expand/chevron STATE, checkbox, or context-menu logic lives here.**
  Those behaviors stay in the consumers (`useFolderTreeItemController`, the sections) and are
  injected through slots (`leading`, `icon`, `trailing`, `listItemProps`).
- Section HEADER rows are out of scope (they keep their own markup).
- No child loading, permission derivation, or selection-KEY computation (consumers pass
  `selected` as a boolean).

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/TreeRow.js`
- **Test file:** `client/src/components/folder-tree/__tests__/TreeRow.test.js`

### 2.2 Props

| Name          | Type      | Required | Default | Description                                                                                                                                              |
| ------------- | --------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| level         | number    | N        | 0       | Depth-based indent: ListItemButton `pl: level * 2` (16px/level — the tree rule, owner ruling 2026-10-01)                                                 |
| name          | string    | Y        | -       | Row label. Middle-truncated (see §2.4) and bold (700) when `selected`.                                                                                   |
| onClick       | function  | N        | -       | Row click                                                                                                                                                |
| selected      | boolean   | N        | false   | Selected highlight: `Mui-selected`, `primary.main` text/icon color, 3px `primary.main` border-left, transparent bg                                       |
| disabled      | boolean   | N        | false   | Disabled button + `opacity: 0.4`                                                                                                                         |
| leading       | ReactNode | N        | -       | Optional leading slot with the `minWidth: 24, mr: 0.5` geometry (tree chevron/spinner column). When absent the icon slot gains `mr: 0.5` (section idiom) |
| icon          | ReactNode | N        | -       | Icon slot (`minWidth: 24`)                                                                                                                               |
| iconProps     | object    | N        | -       | Spread onto the icon `ListItemIcon` (e.g. `data-testid` chips); `sx` merges with the base geometry                                                       |
| secondary     | ReactNode | N        | -       | `ListItemText.secondary` (e.g. the collection `new` dot)                                                                                                 |
| trailing      | ReactNode | N        | -       | Optional trailing slot after the text (no consumer today; part of the owner-ruled API)                                                                   |
| textSx        | object    | N        | -       | Merged onto the `ListItemText` sx (e.g. hidden-name `opacity`)                                                                                           |
| buttonProps   | object    | N        | -       | Spread onto the `ListItemButton` (e.g. row `data-testid`s)                                                                                               |
| buttonSx      | object    | N        | -       | Merged LAST onto the `ListItemButton` sx (consumer overrides, e.g. drop-target highlight)                                                                |
| listItemProps | object    | N        | -       | Spread onto the wrapper `ListItem` (`data-testid="folder-tree-item"`, drag handlers, hover sx)                                                           |

### 2.3 Rendering Contract

- Structure: `ListItem (disablePadding) > ListItemButton > [leading icon column] + [icon
column] + ListItemText + trailing`.
- Geometry parity: `py: 0.5`, `minHeight: 32`, icon column `minWidth: 24`, leading column
  `minWidth: 24, mr: 0.5` — the `BaseFolderTreeItem` idiom, now the single source.
- Indent: `pl: level * 2`. Section child rows render at `level = 1`, i.e. the SAME computed
  padding-left (16px) as a shared-folder/file-tree child row (owner ruling 2026-10-01;
  supersedes the F5 `pl: 3` / 24px pin).
- Every row button carries `data-tree-row` (primitive-usage assertion seam for the parity pins).

### 2.4 Name truncation (single font-metrics source)

- Observed-width MIDDLE truncation: `useObservedElementWidth` (adapter seam — no direct
  `ResizeObserver` in views) observing the row element + `pixelMiddleTruncate` with the shared
  row font `'14px Inter, Roboto, "Helvetica Neue", Arial, sans-serif'`.
- Budget: `max(40, observedWidth − 72px reserved row chrome)` — the documented section idiom,
  unchanged numerically for `level ≤ 1` rows.
- Tooltip exposes the FULL name only when truncation occurred (`disableInteractive`,
  `enterDelay: 300`).

### 2.5 Dependencies

- MUI primitives only + the local hook `useObservedElementWidth` + pure util
  `pixelMiddleTruncate`. No services, no controllers, no browser globals.

### 2.6 Verification Scenarios

- [ ] `pl` scales with `level` (0 ⇒ 0px, 1 ⇒ 16px, 2 ⇒ 32px).
- [ ] Selected row: `Mui-selected`, font-weight 700, 3px primary border-left.
- [ ] Long names middle-truncate with tooltip exposing the full name; short names render intact.
- [ ] Slots: leading/icon/secondary/trailing render; `onClick` fires; `disabled` blocks click.
- [ ] Cross-section indent equality: recent / collection / shared child rows compute the same
      `padding-left` (pinned in `TreeRow.test.js`, section suites).

### 2.7 Consumers & regression posture

- `BaseFolderTreeItem` keeps its full behavior surface (expand/chevron via `leading`,
  drag/drop via `listItemProps`, drop highlight via `buttonSx`, disabled via `disabled`) and
  its props surface is UNCHANGED; `data-testid="folder-tree-item"` stays on the row `ListItem`.
- Declared behavior deltas of the ruling: file-tree name cells now MIDDLE-truncate (was CSS
  ellipsis + inline `ResizeObserver` detection); tooltip delay becomes 300ms for section rows.
