# FileContextMenu Spec

## 1. Overview

| Item               | Description                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Role               | Context menu for file actions: download, rename, move, copy, share, properties, delete. Positioned at mouse coordinates. |
| Used in            | FileManager (desktop right-click)                                                                                        |
| Related components | MUI Menu, MenuItem                                                                                                       |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileContextMenu.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileContextMenu.test.js`

### 2.2 Props

| Name               | Type                       | Required | Default | Description                                        |
| ------------------ | -------------------------- | -------- | ------- | -------------------------------------------------- |
| contextMenu        | { mouseX, mouseY } \| null | Y        | -       | Position or null when closed                       |
| onClose            | function                   | Y        | -       | Close handler                                      |
| file               | object                     | Y        | -       | File object                                        |
| user               | object                     | N        | -       | User                                               |
| hasWritePermission | boolean                    | Y        | -       | Default write permission                           |
| onDownload         | function                   | N        | -       | Download handler                                   |
| onRename           | function                   | N        | -       | Rename handler                                     |
| onMove             | function                   | N        | -       | Move handler                                       |
| onCopy             | function                   | N        | -       | Copy handler                                       |
| onShare            | function                   | N        | -       | Share handler                                      |
| onProperties       | function                   | N        | -       | Properties handler                                 |
| onDelete           | function                   | N        | -       | Delete handler                                     |
| onRestore          | function                   | N        | -       | Trash restore handler (rendered for trashed items) |
| onPurge            | function                   | N        | -       | Trash permanent-delete handler                     |

### 2.3 Callback Signatures

| Callback               | When invoked    | Arguments                                |
| ---------------------- | --------------- | ---------------------------------------- |
| onClose                | Menu close      | -                                        |
| handleAction(callback) | Menu item click | calls onClose first, then callback(file) |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Menu/MenuItem/ListItemIcon/ListItemText, action icons
- **Reference implementation:** `client/src/components/file-manager/FileContextMenu.js`

### 2.5 i18n Keys

- `actions.download`, `actions.rename`, `actions.move`, `actions.copy`, `actions.share`, `actions.properties`, `actions.delete`
- `actions.restore`, `actions.purge` – trash-view menu rows

### 2.6 Conditional Rendering

- Menu items only when corresponding callback provided
- Rename, move, delete disabled when !fileWritePermission (file.hasWritePermission ?? hasWritePermission)
- Returns null when !file
- **Trash rows:** when the host passes `onRestore`/`onPurge` (trash view only), the menu shows Restore (`data-testid="trash-action-restore"`, gate `fileWritePermission` = row `hasWritePermission`) and Permanent delete (`data-testid="trash-action-purge"`, error accent, same gate) above Properties; the host withholds the live-item callbacks (download/rename/move/copy/share/delete) in the trash view, so only Restore / Permanent delete / Properties render.
- E2E selector contract:
- action entries used by flow tests expose the same stable `data-testid` values as the mobile `FileActionSheet` counterparts (for example rename/delete)
- this allows the same Playwright helper to trigger rename/delete on both desktop and mobile without text matching

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Opens at contextMenu position
- [ ] Each action calls callback with file, then onClose
- [ ] Rename/move/delete disabled when no write permission
- [ ] file.hasWritePermission overrides hasWritePermission
- [ ] Trash mode: restore/purge rows render with the row write-permission gate and trigger their callbacks; live-item rows are absent when their callbacks are withheld
- [ ] onClose on menu close

### 2.8 Edge Cases

- file null – returns null
- anchorReference="anchorPosition", anchorPosition from contextMenu

---

## 3. AI-platform entries (AI platform)

Addendum to §2.2/§2.5/§2.6 per docs/features/collections-platform.md §3.2/§3.3 (`AddToCollectionMenu.md`, `MemberRowControls.md`).

- **New entries (main listing), rendered via the existing "callback provided ⇒ item renders" idiom (§2.6):**
- `Add to collection ▸` — new optional callback `onAddToCollection(file)`; the submenu itself is the host-mounted `AddToCollectionMenu` component (this menu only anchors/launches it).
- `Like` toggle — new optional callback `onToggleLike(file)`; pressed/label state comes from the **row data `file.liked`** verbatim (current viewer's own like only — invariant 9; no counts, no other-user state).
- **Member-list context variant:** when the host opens this menu on a collection MEMBER row, the rendered set is exactly the `MemberRowControls.md` §2.3 set (exclude / publish / download / `Reveal original location` / properties / like) — the host passes only those callbacks. **No move/copy/rename/delete of the file node in member context, ever** (§3.2 "collection is a view, not a workspace"; grep-able invariant in that spec).
- i18n (appends §2.5): `fileManager.addToCollection`, `fileManager.memberLike`/`fileManager.memberUnlike`.
- E2E selector contract: `data-testid="collection-add"` / `data-testid="like-toggle"`, shared with the mobile sheet (§2.6 cross-surface rule).

Verification (appends §2.7):

- [ ] (target) Items render only when their callbacks are supplied; `liked:true` row renders the unlike-state label.
- [ ] (target) Member-context rendered-items snapshot contains no move/copy/rename/delete entries.
