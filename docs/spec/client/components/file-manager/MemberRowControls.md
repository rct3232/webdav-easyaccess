# MemberRowControls Spec

Target-contract spec , §4.7; the collections-platform feature doc §7 DEF-25).

## 1. Overview

| Item               | Description                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Context menu + multi-select action set for collection MEMBER rows (and the owner's batch bar). Enforces the §3.2 boundary: collection is a view, not a workspace — file-mutating items are DELIBERATELY ABSENT. |
| Used in            | CollectionsListView member mode (context menu, action sheet, bulk toolbar)                                                                                                                                      |
| Related components | FileContextMenu sections (idiom), AddToCollectionMenu (`다른 컬렉션에 추가` reuse), FilePropertiesDialog (collection-context variant), useUndoToast (host)                                                      |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/MemberRowControls.js`
- **Test file:** `client/src/components/file-manager/__tests__/MemberRowControls.test.js`

### 2.2 Props

| Name           | Type     | Required | Default | Description                                                                                                                                    |
| -------------- | -------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| open           | boolean  | Y        | -       | Menu visibility                                                                                                                                |
| member         | object   | cond.    | -       | Single row: snake_case item (`node_id`, `membership`, `published`, `state`, `shared_excluded`, `liked`, `reason`)                              |
| selectedRows   | array    | cond.    | -       | Multi-select variant (bulk toolbar) — exactly one of `member`/`selectedRows`                                                                   |
| collection     | object   | Y        | -       | Parent row: `origin`, `publish_mode`, `granted_role` (viewer/editor/owner resolution)                                                          |
| onExclude      | function | Y        | -       | `제외` → `DELETE /:id/items` (stored row delete; non-`user` origins also insert exclusion — server semantics §3.2)                             |
| onPublish      | function | Y        | -       | publish on/off → DEF-25 publish seam (`nodeIds`)                                                                                               |
| onDownload     | function | Y        | -       | file download via existing file seam (only offered when file ACL allows)                                                                       |
| onShowOriginal | function | Y        | -       | `원본에서 보기` → host navigates to the node's real parent where normal file menus apply                                                       |
| onProperties   | function | Y        | -       | opens FilePropertiesDialog (read-only tab subset when requester is not the file owner)                                                         |
| onToggleLike   | function | Y        | -       | like toggle — **Decision:** likes route ships with T0.x file-domain work (`file_likes` exists in §5; no collections.md route yet); seam stable |
| onClose        | function | Y        | -       | Dismiss                                                                                                                                        |

### 2.3 Rendered Set (exact — §3.2)

- Per row: `제외` | publish on/off (shared collections only, `publish_mode != auto`, owner/editor) | `다운로드` (ACL-allowed only) | `원본에서 보기` | `속성` | like toggle (heart reflects the CURRENT VIEWER'S OWN like only — invariant 9; no counts, no others' states anywhere).
- Multi-select adds: batch `제외`, batch publish, `다른 컬렉션에 추가` (membership copy via AddToCollectionMenu submenu).
- **Explicitly ABSENT (grep-able invariant):** move / copy / rename / delete of the FILE node — no such items render in any collection member context, ever (invariant 1: "view by collection, mutate by file"). **No batch delete — by rule** (§3.2).
- Viewer-role grantees: `제외` only for rows they added (403 otherwise — server enforces; UI hides for others' rows). Publish controls are owner-side only.
- Revoked rows (`state:'revoked'`): placeholder, menu renders nothing except close (no name/thumbnail exposure).

### 2.4 Feedback (host, restated for observability)

- `제외`/publish/add succeed ⇒ undo toast from `undo.action_id` (§4.11 matrix: 컬렉션 생성/추가/제외/pin/publish all undoable). Permanent effects of auto-pin are invisible (§4.9b) — list refresh only.
- Row `reason` (`왜 여기에`, derived members) is display data for the digest expansion, NOT a menu item.

### 2.5 Dependencies

- **imports:** MUI menu primitives, useTranslation, icons; **no** gateway/service imports (callbacks).

### 2.6 i18n Keys

- `fileManager.memberExclude`, `fileManager.memberPublish`, `fileManager.memberUnpublish`, `fileManager.memberDownload`, `fileManager.memberShowOriginal` (`원본에서 보기`), `fileManager.memberProperties`, `fileManager.memberLike`/`unlike`, `fileManager.memberAddToOther` (`다른 컬렉션에 추가`), `fileManager.memberBatchExclude`

### 2.7 Verification Scenarios

- [ ] No move/copy/rename/delete entries exist in any prop permutation (rendered-items snapshot assertion).
- [ ] `publish_mode:'auto'` collection ⇒ publish toggles absent (nothing to gate).
- [ ] Viewer grantee sees `제외` only on own-added rows; batch bar mirrors the rule.
- [ ] `shared_excluded:true` row renders the `타인 소유 — 공유 제외` chip in owner view and offers no publish toggle.
- [ ] Multi-select offers batch exclude/publish/`다른 컬렉션에 추가` and NO delete affordance.
- [ ] Like toggle reflects `liked` from the row verbatim (viewer-scoped, no aggregate).

### 2.8 Edge Cases

- `selectedRows` spanning readable+revoked rows: batch actions apply to eligible ids only (server ignores the rest; no client pre-filter toast).
- Trashed-by-owner rows never arrive (server hides) — no defensive menu needed.
