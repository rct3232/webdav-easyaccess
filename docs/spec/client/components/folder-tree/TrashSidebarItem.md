# TrashSidebarItem Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Bottom-pinned sidebar entry for the trash view (DEF-16 P9): `{휴지통 아이콘} 휴지통` row rendered below all FolderTree lines. Tree-row-style selected state when the trash view is active, and a one-shot lid-open animation + error flash when trash contents change. Not a tree section: no expansion, no DnD, no children. |
| Used in            | FolderTree (desktop sidebar drawer and the mobile tree collapse use the same component)                                                                                                                                                                                                                                       |
| Related components | FolderTree, `trashNotifier` (subscribe), BaseFolderTreeItem (selected-style idiom)                                                                                                                                                                                                                                            |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/TrashSidebarItem.js`
- **Test file:** `client/src/components/folder-tree/__tests__/TrashSidebarItem.test.js`

### 2.2 Props

| Name         | Type     | Required | Default | Description                                                           |
| ------------ | -------- | -------- | ------- | --------------------------------------------------------------------- |
| currentPath  | string   | Y        | -       | Current explorer display path (selected state keyed off `/__trash__`) |
| onTrashClick | function | Y        | -       | Click handler: `() => void` (host navigates to `/files/__trash__`)    |

### 2.3 Rendering Contract

- `ListItemButton` with `data-testid="sidebar-trash"`, `aria-label`/title from i18n `nav.trash`
  (44px+ touch target via `minHeight`).
- Label: `t('nav.trash')` (en "Trash", ko "휴지통").
- Icon: small custom two-path SVG trash icon (`TrashIcon` — lid path + can-body path, both
  `fill="currentColor"`). Not `DeleteOutline`, because the animation needs a separately
  transformable lid.
- **Selected state:** when `currentPath === '/__trash__'`, same tree-row-selected idiom as
  `BaseFolderTreeItem` (`.Mui-selected`: transparent background, `primary.main` color, 3px
  `primary.main` left border, icon colored).
- Footer placement: rendered by `FolderTree` after the scrollable tree list, pinned at the bottom of
  the sidebar column.

### 2.4 Animation Contract (delete feedback, DEF-16 P9)

- Subscribes to `trashNotifier.subscribeToTrashChanged` while mounted; each notification increments
  a pulse counter and the icon plays the animation **once**.
- Animation (CSS `@keyframes` declared in MUI `sx` — no styled-components, MUI v5 + sx only,
  ~1.2s total, runs once per pulse via icon remount keyed on the pulse counter):
  - **Lid:** rotates open (~-40deg), holds briefly, closes back to 0deg
    (`transformBox: 'view-box'`, transform origin at the lid hinge).
  - **Color flash:** icon color `inherit` → `theme.palette.error.main` (mid) → back to inherit.
- Static rendering (no animation) when no pulse has fired yet.

### 2.5 Callback Signatures

| Callback     | When invoked | Arguments |
| ------------ | ------------ | --------- |
| onTrashClick | Row click    | -         |

### 2.6 Dependencies

- **imports:** MUI `Box/ListItem/ListItemButton/ListItemText`, `useTranslation`, `useTheme`,
  `trashNotifier` (`subscribeToTrashChanged`).
- **Boundary:** pure view — navigation and trash IO stay with the host shell/controller hooks; the
  component only consumes the notifier signal.

### 2.7 i18n Keys

- `nav.trash`

### 2.8 Verification Scenarios

- [ ] Renders the `nav.trash` label with the trash icon and `data-testid="sidebar-trash"`
- [ ] Click invokes `onTrashClick`
- [ ] `currentPath === '/__trash__'` applies the selected (tree-row) styling
- [ ] Non-trash currentPath is not selected
- [ ] A `notifyTrashChanged()` call triggers exactly one new animation pulse; animation is absent before any pulse

### 2.7 Edge Cases

- Unsubscribe on unmount; subscriber errors never break the tree
- Long label keeps the 44px touch target and truncates like tree rows
