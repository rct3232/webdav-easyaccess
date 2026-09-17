# collectionShareService Spec

Target-contract spec.

## 1. Overview

| Item          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role          | The sharing half of the collections platform: roles (`owner/viewer/editor`), live membership resolution + `published` gate, publish modes A/B/C with the initial-batch exception, grants CRUD + instant revocation, and `leave` (per-user hidden flag).                                                                                                                                                                                                              |
| Boundaries    | `collection_grants` / `collection_visibility` are a SEPARATE table domain: this service is the only reader/writer; `aclService`, `permissionStore`, permission caches and `__shared__` NEVER touch these tables (invariant 1, enforced by grep-gate + the permissions integration check). Member-view rendering (revoked placeholders, cross-leak exclusion) stays in [collectionsService](collectionsService.md); this service supplies the predicates it consults. |
| Exposure rule | No automation ever shares anything (invariant 2). Enabling sharing (a grant write) and publishing (an `ask`/`off` release) are the ONLY consent acts; both are user-clicked and journaled.                                                                                                                                                                                                                                                                           |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/collections/shareService.js`
- **Test file:** `server/domains/collections/__tests__/collectionShareService.test.js`
- Store used end-to-end: `collectionsStore` journaled mutators `grantAccess`,
  `revokeAccess`, `setItemPublished` + non-journaled `setVisible`/`isHiddenFor`/
  `listGrants`/`getGrant` (see its spec §2.1/§2.4).

### 2.2 Roles and capability matrix

`getRole(userId, collectionId)` → `'owner' | 'editor' | 'viewer' | null` (live read:
collection row + grants row; archived collections resolve role normally — archived is a
display state, not an ACL state). Null role on any access attempt → caller throws
`notFound` (404 masquerade, existence never leaks).

| Capability                                | owner | editor                      | viewer |
| ----------------------------------------- | ----- | --------------------------- | ------ |
| List members / preview / download member  | ✅    | ✅                          | ✅     |
| Add members                               | ✅    | ✅                          | ❌     |
| Remove stored row / exclude               | ✅    | only rows they added (§3.2) | ❌     |
| Publish / unpublish members               | ✅    | ❌                          | ❌     |
| Rename / pin / archive / restore / delete | ✅    | ❌                          | ❌     |
| Grant / revoke sharing                    | ✅    | ❌                          | ❌     |
| `leave` (hide locally)                    | n/a   | ✅                          | ✅     |

No role — ever — enables rename/move/delete of a FILE node through a collection
(invariant 1): this service has no file-mutating surface and the routes that mutate files
never accept a collection id (§2.6).

### 2.3 Publish modes (§4.7) + initial-batch exception

Mode lives on the collection row (`publish_mode`), changed only by the owner
(`updateCollection`, journaled). It governs ONLY members entering a LIVE-SHARED view:

- **A `off`**: every arrival (auto- or stored-added) parks at `published=false` until the
  owner publishes; nothing new becomes shared silently.
- **B `ask` (default)**: same parking; the owner-facing list/digest surfaces show
  `공유 대기 N` (`publishPendingCount`) with batch/individual publish controls.
- **C `auto`**: publish on every add — legal only because turning it on was itself the
  explicit act; it never applies retroactively to a collection that was not shared.
- **Initial-batch exception (Q2)**: the member set materialized by the CONFIRMED initial
  execution of a `seed`/`search` collection is created `published=true` — the §4.5/§4.6
  confirm dialog is the batch approval, including the unseen remainder (copy obligation
  in collectionsService §2.7). Subsequent arrivals park per the mode above.
- `publishPendingCount(userId, id)` → owner-only number of `published=false` rows in the
  resolved view (stored + derived); the route omits the key for grantees.
- `publish(userId, id, nodeIds, published=true|false)` → owner-only. Stored rows flip via
  `setItemPublished` (journaled; batch = ONE command row with item inverses); publishing
  a DERIVED member materializes a stored marker row `published=true` via `addItem` (the
  `stored ∪ derived` view dedups by node, so membership truth stays derived and undo
  stays row-local — collectionsService §2.2); unpublish flips the marker back to `false`
  and NEVER deletes an owner-added stored row. Publishes on a `system` collection are a
  user touch → `setAutoPin`.
- Live resolution: evaluated at READ time by collectionsService via
  `isVisibleToGrantee(collection, viewRow)` → `viewRow.published ||`
  `collection.publishMode === 'auto'` — `viewRow` may be VIRTUAL (a derived member
  without a stored row enters the grantee path as `published:false` until materialized;
  auto-mode rows are always published at add, so the flag still carries truth for a
  later mode downgrade).

### 2.4 Grants CRUD + revocation

- `listGrants(userId, id)` → owner-only rows `{ granteeId, username, role, grantedBy,
createdAt }` (username resolved via `userStore` at read).
- `grant(userId, id, { granteeId, role })` → owner-only. `role ∉ viewer|editor` →
  `invalidRole`; grantee must exist → else `granteeNotFound`. UPSERT on PK pair: a
  re-grant REPLACES the role in one journaled command (undo of a re-grant restores the
  previous role, not absence). Granting one's own collection → `forbidden`. Granting is
  the ONLY act that expands exposure and is always explicit (invariant 2). Side effect
  **Decision:** (re-)granting a user clears that user's hidden flag for the collection
  (`setVisible(hidden=false)`) — a fresh grant is intent to show them the collection.
- `revoke(userId, id, granteeId)` → owner-only; no row → `grantNotFound`. INSTANT (§4.7):
  the next read resolves role=null and every member view 404-masquerades. Already-visible
  metadata cannot be re-taken — documented limitation, same stance as journal boundaries;
  the journaled inverse restores FUTURE state only (undo of a revoke re-grants — that is
  exposure expansion, hence the journal matrix keeps it behind an explicit user undo
  click, never silent).

### 2.5 Leave / visibility

`leave(userId, id)` → recipient (viewer|editor) only; owner leaving their own collection
→ `forbidden`. Writes `collection_visibility(user_id, id, hidden=true)` — NON-journaled
self-reversing trivial state (§4.11 matrix). Effects: removed from `listCollections`,
sidebar entry gone, `granted_role` chips drop. The collection REAPPEARS only via the
re-grant clear in §2.4 (there is no "join back" surface — membership exposure is the
owner's act). No separate unhide endpoint in v1 (**Decision:** re-grant covers the
observed recovery path; an un-hide UI is additive later if real usage demands).

### 2.6 "View by collection, mutate by file" — enforcement points

| Layer                   | Enforcement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes                  | `/api/collections/*` accepts NO file-mutating verb (no rename/move/delete of nodes). File-mutating routes (`/api/files*`) accept NO collection parameter — they run pure file ACL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Service                 | `getRole` gates every collections route (§2.2); member ops call `removeItem`/`addExclusion` (membership rows only) — never a node service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Store                   | `collectionsStore` exposes no node mutator; `collection_grants`/`collection_visibility` are absent from `permissionStore`/`aclService` code paths (grep-gate + permissions integration assertion in the store spec §2.9).                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Download/preview bridge | Collection views offer download/preview of members. v1 rule: member rows offer download only when the FILE ACL allows (§3.2 control list). For grant-initiated access to owner-owned members, the preview/download route passes `collectionId`; `assertMemberConsumable(viewerId, collectionId, nodeId)` (role ≠ null ∧ `isVisibleToGrantee` ∧ node readable via its OWN file ACL) executes as a route-level pre-check OUTSIDE the ACL subsystem — it never caches into permission stores. **Decision:** collection sharing remains additive to, not a bypass of, file ACL; when file-ACL-granted collection preview is later widened, this function is the single seam to change. |
| Undo asymmetry          | grant-undo = revoke (exposure reduction — silent allowed); revoke-undo = grant (expansion — explicit user click only) per the §4.11 permissions note, applied to collection grants by the same rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### 2.7 Thrown string codes

Same collections router `ERROR_MAP` (shared with collectionsService — see its §2.11):
`notFound`, `forbidden`, `invalidRole`, `granteeNotFound`, `grantNotFound`.

---

## 3. Dependencies

- `collectionsStore` (grants, visibility, item rows, `setItemPublished`, `setAutoPin`)
- `userStore` (grantee existence + username), `actionJournalStore` (indirect — via the
  journaled store mutators)
- Called by: `server/domains/collections/routes.js` (grants/leave endpoints) and
  [collectionsService](collectionsService.md) (`getRole`, visibility predicates,
  `assertMemberConsumable` from the files domain preview/download routes)

## 4. Verification Scenarios

- [ ] Role matrix: viewer add/remove/publish/grant/rename each → 403 (`forbidden`);
      editor add succeeds; editor removes own row succeeds, owner's row → 403
- [ ] Ungranted user reading the collection or any member → `notFound` (404 masquerade)
- [ ] `grant` unknown user → `granteeNotFound`; role `admin` → `invalidRole`; re-grant
      viewer→editor replaces (single PK row) and is ONE journaled command
- [ ] Re-grant to a left user clears the hidden flag; the collection re-appears in their
      `listCollections` with `granted_role`
- [ ] `revoke` → grantee's very next list/items read 404s (instant, no cache); revoking a
      missing row → `grantNotFound`; grant-undo/revoke-undo asymmetry honored (revoke-
      undo requires the explicit undo click)
- [ ] Modes: `ask` new member invisible to grantee until publish, visible to owner with
      `published:false`; `off` identical parking without banner semantics; `auto` new
      member visible immediately; switching `auto→ask` does not unpublish history
- [ ] Initial batch: seed/search creation writes `published=true` for the materialized
      set; next upload-admitted derived member is `published=false`
- [ ] `leave`: recipient disappears from their list; owner's view unaffected; leave emits
      no journal row; owner leaving → `forbidden`
- [ ] `assertMemberConsumable`: grantee preview of a published member passes; unpublished
      fails; foreign-owned member fails in shared view (cross-leak parity with the item
      view); permission caches unchanged after any collection read (grep + cache probe)
- [ ] Live resolution: membership change on a derived collection shows in the grantee's
      next read without re-sharing; cursor/visibility survive archive→restore
