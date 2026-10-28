# collectionShareService Spec

Target-contract spec.

## 1. Overview

| Item          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role          | The sharing half of the collections platform: roles (`owner/viewer/editor`), live membership resolution + `published` gate, publish modes A/B/C with the initial-batch exception, grants CRUD + instant revocation, and grantee self-revocation (`DELETE /:id/grants/me`).                                                                                                                                                                              |
| Boundaries    | `collection_grants` / `collection_visibility` are a SEPARATE table domain: this service is the only reader/writer; `aclService`, `permissionStore`, permission caches and `__shared__` NEVER touch these tables (enforced by grep-gate + the permissions integration check). Member-view rendering (revoked placeholders, cross-leak exclusion) stays in [collectionsService](collectionsService.md); this service supplies the predicates it consults. |
| Exposure rule | No automation ever shares anything — exposure expansion is always explicit. Enabling sharing (a grant write) and publishing (an `ask`/`off` release) are the ONLY consent acts; both are user-clicked and journaled.                                                                                                                                                                                                                                    |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/collections/shareService.js`
- **Test file:** `server/domains/collections/__tests__/collectionShareService.test.js`
- Store used end-to-end: `collectionsStore` journaled mutators `grantAccess`,
  `revokeAccess`, `setItemPublished` + non-journaled `setVisible`/`isHiddenFor`/
  `listGrants`/`getGrant` (see its spec §2.1/§2.4).
- Route surfaces delegated HERE by `routes.js`: `GET /:id/grants`, `POST /:id/grants`,
  `DELETE /:id/grants`, `DELETE /:id/grants/me`, `PUT /:id/items/publish`. The router-level
  `ERROR_MAP` is shared — delegation changes no thrown code, status, or response shape.
  Dependency direction is one way: `service.js` consumes this module (role/visibility
  predicates, read-masquerade helper, pending count); this module reads the stores
  directly and never imports `service.js`. Membership classification for `publish` uses
  the materialized `collection_items` read (the same row set the item view composes).

### 2.2 Roles and capability matrix

`getRole(userId, collectionId)` → `'owner' | 'editor' | 'viewer' | null` (live read:
collection row + grants row; archived collections resolve role normally — archived is a
display state, not an ACL state). Null role on any access attempt → caller throws
`notFound` (404 masquerade, existence never leaks).

Read-path gates supplied by this module: `getCollectionForRead(userId, collectionId)` →
`{ collection, grant, role }` (unknown collection, null role, or hidden flag set for a
grantee → `notFound`); `requireOwner(userId, collection)` (`forbidden` for any grantee
role); `requireOwnerOrRole(userId, collection, minimumRole)` → the live role, `forbidden`
below the minimum, `notFound` on zero access. [collectionsService](collectionsService.md)
consumes these predicates; `routes.js` reaches them through the delegated surfaces.

| Capability                                      | owner | editor               | viewer |
| ----------------------------------------------- | ----- | -------------------- | ------ |
| List members / preview / download member        | ✅    | ✅                   | ✅     |
| Add members                                     | ✅    | ✅                   | ❌     |
| Remove stored row / exclude                     | ✅    | only rows they added | ❌     |
| Publish / unpublish members                     | ✅    | ✅                   | ❌     |
| Rename / pin / archive / restore / delete       | ✅    | ❌                   | ❌     |
| Grant / revoke sharing                          | ✅    | ❌                   | ❌     |
| Self-revoke own grant (`DELETE /:id/grants/me`) | n/a   | ✅                   | ✅     |

No role — ever — enables rename/move/delete of a FILE node through a collection
(view by collection, mutate by file): this service has no file-mutating surface and the routes that mutate files
never accept a collection id (§2.6).

### 2.3 Publish modes + initial-batch exception

Mode lives on the collection row (`publish_mode`), changed only by the owner
(`updateCollection`, journaled). It governs ONLY members entering a LIVE-SHARED view:

- **A `off`**: every arrival (auto- or stored-added) parks at `published=false` until the
  owner publishes; nothing new becomes shared silently.
- **B `ask` (default)**: same parking; the owner-facing list/digest surfaces show
  `N awaiting publish` (`publishPendingCount`) with batch/individual publish controls.
- **C `auto`**: publish on every add — legal only because turning it on was itself the
  explicit act; it never applies retroactively to a collection that was not shared.
- **Initial-batch exception**: the member set materialized by the CONFIRMED initial
  execution of a `seed`/`search` collection is created `published=true` — the seed/search
  confirm dialog is the batch approval, including the unseen remainder (copy obligation
  in collectionsService §2.7). Subsequent arrivals park per the mode above.
- `publishPendingCount(userId, collectionId, rows)` → owner-only number of
  `published=false` rows in the requester-resolved view (stored + derived), regardless of
  `publish_mode` (`auto` publishes on add and never retroactively publishes parked
  history, so legacy parked rows remain counted). The items route passes the SAME rows it
  just resolved (in-memory count, zero extra reads); the owner gate lives here — a non-owner
  caller throws `forbidden`, and the route omits the key for grantees.
- `publish(userId, id, nodeIds, published=true|false)` → owner or editor (viewer →
  `forbidden`). Route surface `PUT /:id/items/publish`. `nodeIds` ride the shared
  `emptyNodeIds` boundary (1–200) and `published` must be boolean
  (`invalidPublishMode`). Stored rows flip via
  `setItemPublished` (journaled; batch = ONE command row with item inverses); publishing
  a DERIVED member materializes a stored marker row `published=true` via `addItem` (the
  `stored ∪ derived` view dedups by node, so membership truth stays derived and undo
  stays row-local — collectionsService §2.2); unpublish flips the marker back to `false`
  and NEVER deletes an owner-added stored row. Ids outside the materialized membership
  land in `ignored[]` — publish never ADDS membership (anti-injection); `undo` is the
  flip command or `null` for an all-`ignored` batch. Publishes on a `system` collection
  are a user touch → `setAutoPin`.
- Live resolution: evaluated at READ time by collectionsService via
  `isVisibleToGrantee(collection, viewRow)` — a materialized row is visible when
  its `published` flag is true; the `|| collection.publishMode === 'auto'` arm
  applies ONLY to a VIRTUAL viewRow (a derived member without a stored row
  enters the grantee path as `published:false` until materialized). Mode `auto`
  publishes ON ADD — it never republishes parked history, so grantees only ever
  see `published:true` materialized rows (routes/collections.md §2.4). The flag
  carries truth for a later mode downgrade because auto-mode rows were published
  at add.

### 2.4 Grants CRUD + revocation

- `listGrants(userId, id)` → owner-only rows `{ granteeId, username, role, grantedBy,
createdAt }` (username resolved via `userStore` at read).
- `grant(userId, id, { granteeId, role })` → owner-only. `role ∉ viewer|editor` →
  `invalidRole`; grantee must exist → else `granteeNotFound`. UPSERT on PK pair: a
  re-grant REPLACES the role in one journaled command (undo of a re-grant restores the
  previous role, not absence). Granting one's own collection → `forbidden`. Granting is
  the ONLY act that expands exposure and is always explicit (no automation ever grants). Side effect:
  (re-)granting a user clears that user's hidden flag for the collection
  (`setVisible(hidden=false)`).
- `revoke(userId, id, granteeId)` → owner-only; no row → `grantNotFound`. INSTANT:
  the next read resolves role=null and every member view 404-masquerades. The revoke TX also
  DELETES the grantee's digest-cursor row (re-grant re-dots;
  collectionsService.md §2.8). Already-visible
  metadata cannot be re-taken — documented limitation; the journaled
  inverse restores FUTURE state only: revoke-undo = re-grant (exposure expansion),
  therefore behind an explicit user undo click only, never silent.

### 2.5 Visibility / grantee self-revocation

There is no `leave` route: a grantee removes their own access via self-revocation —
`DELETE /:id/grants/me` → `revokeOwnGrant(userId, id)` — a journaled revoke riding the
SAME `collectionsStore.revokeAccess` path as the owner side (actor = grantee, digest
cursor deleted in the same TX). The caller must hold a `viewer|editor` grant; zero
access/unknown id → `notFound` (read-masquerade), a caller with no grant row (incl. the
owner) → `grantNotFound`. The `collection_visibility`
hidden flag is a read-side input at P0: the list SQL omits collections whose flag is
set for the requester and single-collection reads honor it (`isHiddenFor`), while
`setVisible` has no API caller at P0. A re-grant clears the grantee's hidden flag
(§2.4) — the sole recovery path; there is no separate unhide endpoint in v1.

### 2.6 "View by collection, mutate by file" — enforcement points

| Layer                   | Enforcement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes                  | `/api/collections/*` accepts NO file-mutating verb (no rename/move/delete of nodes). File-mutating routes (`/api/files*`) accept NO collection parameter — they run pure file ACL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Service                 | `getRole` gates every collections route (§2.2); member ops call `removeItem`/`addExclusion` (membership rows only) — never a node service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Store                   | `collectionsStore` exposes no node mutator; `collection_grants`/`collection_visibility` are absent from `permissionStore`/`aclService` code paths (grep-gate + permissions integration assertion in the store spec §2.9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Download/preview bridge | Collection views offer download/preview of members. v1 rule: member rows offer download only when the FILE ACL allows. For grant-initiated access to owner-owned members, the preview/download route passes `collectionId`; `assertMemberConsumable(viewerId, collectionId, nodeId)` (role ≠ null ∧ `isVisibleToGrantee` ∧ node readable via its OWN file ACL) executes as a route-level pre-check OUTSIDE the ACL subsystem — it never caches into permission stores. Collection sharing remains additive to, not a bypass of, file ACL. Code contract of the pre-check: zero-access requester, unknown collection, hidden flag set, a nodeId absent from the materialized membership (nothing exists behind this collection), or a trashed/vanished member node (the same liveness read the item view uses) → `notFound` (404 masquerade). Grantee requesters (`viewer`/`editor`) additionally require `isVisibleToGrantee` on the materialized row and the node to be the collection OWNER's own (cross-leak parity — a foreign-owned member is never consumable through a shared view; the owner's ACL over it never leaks through sharing). An owner requester passes the visibility gate (owners see every row) and must be able to read the node via its own file ACL (ownership or granted READ). The predicate never writes into or bypasses permission caches; with NO collection context a grant never replaces the file ACL — the plain file routes stay pure ACL. No shipped files-domain route carries a collection context in v1 — the pre-check is the seam the bridge consumes when one does. |
| Undo asymmetry          | grant-undo = revoke (exposure reduction — silent allowed); revoke-undo = grant (expansion — explicit user click only — exposure expansion never acts silently), applied to collection grants by the same rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### 2.7 Thrown string codes

Same collections router `ERROR_MAP` (shared with collectionsService — see its §2.11):
`notFound`, `forbidden`, `invalidRole`, `granteeNotFound`, `grantNotFound`.

---

## 3. Dependencies

- `collectionsStore` (grants, visibility, item rows, `setItemPublished`, `setAutoPin`)
- `userStore` (grantee existence + username), `actionJournalStore` (indirect — via the
  journaled store mutators)
- Called by: `server/domains/collections/routes.js` (grants/self-revocation and publish
  endpoints) and
  [collectionsService](collectionsService.md) (`getRole`-based read/role gates,
  `isVisibleToGrantee`, `publishPendingCount`);
  `assertMemberConsumable` is the predicate the files domain preview/download routes pass a
  collection context through (spec §2.6)

## 4. Verification Scenarios

- [ ] Role matrix: viewer add/remove/publish/grant/rename each → 403 (`forbidden`);
      editor add succeeds; editor removes own row succeeds, owner's row → 403
- [ ] Ungranted user reading the collection or any member → `notFound` (404 masquerade)
- [ ] `grant` unknown user → `granteeNotFound`; role `admin` → `invalidRole`; re-grant
      viewer→editor replaces (single PK row) and is ONE journaled command
- [ ] Re-grant over a set hidden flag clears it; the collection appears in their
      `listCollections` with `granted_role`
- [ ] `revoke` → grantee's very next list/items read 404s (instant, no cache); revoking a
      missing row → `grantNotFound`; grant-undo/revoke-undo asymmetry honored (revoke-
      undo requires the explicit undo click)
- [ ] Modes: `ask` new member invisible to grantee until publish, visible to owner with
      `published:false`; `off` identical parking without banner semantics; `auto` new
      member visible immediately; switching `auto→ask` does not unpublish history
- [ ] Initial batch: seed/search creation writes `published=true` for the materialized
      set; next upload-admitted derived member is `published=false`
- [ ] Self-revocation (`DELETE /:id/grants/me`): the grantee loses access instantly
      (404-masquerade on next read); the revoke is journaled like the owner-side path;
      caller with no grant row (incl. the owner) → `grantNotFound`
- [ ] `assertMemberConsumable`: grantee preview of a published member passes; unpublished
      fails; foreign-owned member fails in shared view (cross-leak parity with the item
      view); owner requester passes its own members (visibility gate not applied); nodeId
      absent from the materialized membership → `notFound`; hidden-flag grantee →
      `notFound`; owner requester on a member their own file ACL cannot read →
      `forbidden`; permission caches unchanged after any collection read (grep + cache probe)
- [ ] Live resolution: membership change on a derived collection shows in the grantee's
      next read without re-sharing; cursor/visibility survive archive→restore
