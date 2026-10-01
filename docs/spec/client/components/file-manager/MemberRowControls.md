# MemberRowControls Spec

Target-contract spec (`docs/features/collections-platform.md` §3.2 member-row control set, §4.7 sharing).

## 1. Overview

| Item               | Description                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Context menu + multi-select action set for collection MEMBER rows (and the owner's batch bar). Enforces the §3.2 boundary: collection is a view, not a workspace — file-mutating items are DELIBERATELY ABSENT. |
| Used in            | CollectionsListView member mode (context menu, action sheet, bulk toolbar)                                                                                                                                      |
| Related components | FileContextMenu sections (idiom), AddToCollectionMenu (`Add to another collection` reuse), FilePropertiesDialog (collection-context variant), useUndoToast (host)                                               |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/MemberRowControls.js`
- **Test file:** `client/src/components/file-manager/__tests__/MemberRowControls.test.js`

### 2.2 Props

| Name           | Type         | Required | Default | Description                                                                                                                                                                                                                                                                                                              |
| -------------- | ------------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| open           | boolean      | Y        | -       | Menu visibility                                                                                                                                                                                                                                                                                                          |
| anchorEl       | node         | N        | -       | MUI Menu anchor (row `More` button); alternative `contextMenu` `{mouseX,mouseY}` follows the FileContextMenu anchorPosition idiom                                                                                                                                                                                        |
| member         | object       | cond.    | -       | Single row: snake_case item (`node_id`, `membership`, `published`, `state`, `shared_excluded`, `liked`, `reason`)                                                                                                                                                                                                        |
| selectedRows   | array        | cond.    | -       | Multi-select variant (bulk toolbar) — exactly one of `member`/`selectedRows`                                                                                                                                                                                                                                             |
| collection     | object\|null | Y        | -       | Parent row: `origin`, `publish_mode`, `granted_role` (viewer/editor/owner resolution). **P-5:** the Liked surface passes `null` (the listing is not inside any collection) — the manage-publish gate then resolves FALSE and NO Exclude/publish items render; the row-target callbacks (`member`) stay fully functional. |
| onExclude      | function     | Y        | -       | `Exclude` → `DELETE /:id/items` (stored row delete; non-`user` origins also insert exclusion — server semantics §3.2)                                                                                                                                                                                                    |
| onPublish      | function     | Y        | -       | publish on/off → publish seam (`nodeIds`)                                                                                                                                                                                                                                                                                |
| onDownload     | function     | Y        | -       | file download via existing file seam (only offered when file ACL allows)                                                                                                                                                                                                                                                 |
| onShowOriginal | function     | Y        | -       | `Reveal original location` → host navigates to the node's real parent where normal file menus apply                                                                                                                                                                                                                      |
| onProperties   | function     | Y        | -       | opens FilePropertiesDialog (read-only tab subset when requester is not the file owner)                                                                                                                                                                                                                                   |
| onToggleLike   | function     | Y        | -       | like toggle → `PUT /api/file-likes/:nodeId` (routes: [fileLikes.md](../../../server/routes/fileLikes.md)); row `liked` optimistic until refresh                                                                                                                                                                          |
| onAddToOther   | function     | N        | -       | `Add to another collection` (multi-select variant only) — hosts the AddToCollectionMenu submenu (membership copy)                                                                                                                                                                                                        |
| onClose        | function     | Y        | -       | Dismiss                                                                                                                                                                                                                                                                                                                  |

### 2.3 Rendered Set (exact — §3.2)

- Per row: `Exclude` | publish on/off (`publish_mode != auto`, owner/editor) | `Download` (ACL-allowed only) | `Reveal original location` | `Properties` | like toggle (heart reflects the CURRENT VIEWER'S OWN like only — invariant 9; no counts, no others' states anywhere). Liked-state heart color = theme token `like` (M-5, `FileContextMenu.md` §2.x rule; never `error`).
  - **Publishable gate — CLIENT rule (P-4 fix, 2026-09-29):** the toggle shows when `collection.publish_mode !== 'auto'` AND the requester can manage publishing AND the row is not `shared_excluded`. "Can manage" is `granted_role` ∈ {`owner`,`editor`} **OR `granted_role == null`** — an OWN collection (user/system origin in the `mine` view) serializes with `granted_role: null` (there is no grant row for the owner). The pre-P-4 client rule tested ONLY {`owner`,`editor`}, so owners never saw the publish menu (the bug this fixes); the previous spec line also required "shared collections only", which contradicted the owner case (a `publish_mode='ask'` OWN collection parks members in the pending banner and must be publishable). The fix is CLIENT-side (accept `null`); no `granted_role:'owner'` is invented on the wire. Viewer-role grantees (`granted_role:'viewer'`) stay hidden.
- Multi-select adds: batch `Exclude`, batch publish, `Add to another collection` (membership copy via AddToCollectionMenu submenu).
- **Explicitly ABSENT (grep-able invariant):** move / copy / rename / delete of the FILE node — no such items render in any collection member context, ever (invariant 1: "view by collection, mutate by file"). **No batch delete — by rule** (§3.2).
- Viewer-role grantees: `Exclude` only for rows they added (403 otherwise — server enforces; UI hides for others' rows). Publish controls are owner-side only.
- **P-5 (`collection:null`):** the Liked surface (`/files/__collections__/liked`) hosts the SAME single
  `MemberRowControls` instance with no parent collection — membership mutations are structurally
  impossible (Exclude/publish items NEVER render; the host additionally passes no `onExclude`/
  `onPublish` callbacks), while `Download` / `Reveal original location` / `Properties` / like toggle
  render normally. The like toggle on this surface is the unlike entry: `handleToggleLike` (shell)
  → `PUT /api/file-likes/:nodeId {liked:false}` → notifier refresh + optimistic row removal
  (`FileManager.md` like-wiring note).
- Revoked rows (`state:'revoked'`): placeholder, menu renders nothing except close (no name/thumbnail exposure).

### 2.4 Feedback (host, restated for observability)

- `Exclude`/publish/add succeed ⇒ undo toast from `undo.action_id` (§4.11 matrix: collection create/add/exclude/pin/publish all undoable). Permanent effects of auto-pin are invisible (§4.9b) — list refresh only.
- Row `reason` (`why is this here`, derived members) is display data for the digest expansion, NOT a menu item.

### 2.5 Dependencies

- **imports:** MUI menu primitives, useTranslation, icons; **no** gateway/service imports (callbacks).

### 2.6 i18n Keys

- `fileManager.memberExclude`, `fileManager.memberPublish`, `fileManager.memberUnpublish`, `fileManager.memberDownload`, `fileManager.memberShowOriginal` (`Reveal original location`), `fileManager.memberProperties`, `fileManager.memberLike`/`unlike`, `fileManager.memberAddToOther` (`Add to another collection`), `fileManager.memberBatchExclude`

### 2.7 Verification Scenarios

- [ ] No move/copy/rename/delete entries exist in any prop permutation (rendered-items snapshot assertion).
- [ ] `publish_mode:'auto'` collection ⇒ publish toggles absent (nothing to gate).
- [ ] Viewer grantee sees `Exclude` only on own-added rows; batch bar mirrors the rule.
- [ ] `shared_excluded:true` row renders the `Not owner's file — not shared` chip in owner view and offers no publish toggle.
- [ ] (P-4) OWN collection (`granted_role:null`, `publish_mode:'ask'`) ⇒ publish on/off toggle IS offered to the owner (the owner-visibility fix); a `viewer` grantee (`granted_role:'viewer'`) is NOT.
- [ ] Multi-select offers batch exclude/publish/`Add to another collection` and NO delete affordance.
- [ ] Like toggle reflects `liked` from the row verbatim (viewer-scoped, no aggregate).
- [ ] (P-5) `collection:null` (liked surface) ⇒ no Exclude/publish items render (no crash — the manage-publish gate is null-guarded) and Download/Reveal/Properties/like toggle DO render; the like item toggles via the shared `onToggleLike` seam.

### 2.8 Edge Cases

- `selectedRows` spanning readable+revoked rows: batch actions apply to eligible ids only (server ignores the rest; no client pre-filter toast).
- Trashed-by-owner rows never arrive (server hides) — no defensive menu needed.
