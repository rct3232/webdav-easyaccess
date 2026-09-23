# collections routes Spec

Target-contract spec.

## 1. Overview

| Item       | Description                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| Mount path | `/api/collections`                                                                                    |
| Role       | Collection CRUD, membership view (stored ∪ derived − exclusions), preview, merge suggestions, grants. |

**Ownership boundary:** collections never mutate file nodes (invariant 1).
`collection_grants` is a separate table domain — never read or written by `aclService`,
`permissionStore`, or permission caches (ARCHITECTURE §1.4 untouched). Undo flows for every
mutation live in [actions.md](actions.md) (`POST /api/actions/:id/undo`); mutation
responses here carry the `undo: { action_id }` pointer only (§4.11). Permanent delete
returns no undo (invariant 10, trash-parity).

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/collections/routes.js`
- **Service:** `server/domains/collections/service.js` (business logic; throws bare string
  codes translated by route-level `ERROR_MAP`/`mapServiceError`)
- **Test file:** `server/domains/collections/__tests__/collections.test.js`

**Mount:** `server/index.js` registers the router **after** the app-level migrationGate and
with `setupModeGuardInstance` (coverage invariant, ARCHITECTURE §1.3):
`app.use('/api/collections', setupModeGuardInstance, require('./domains/collections/routes'))`.

### 2.2 Route List (sync with api.md)

| Method | Path                 | Auth  | Description                                           |
| ------ | -------------------- | ----- | ----------------------------------------------------- |
| GET    | `/`                  | Token | List collections (sort, include filters).             |
| GET    | `/:id`               | Token | Single collection (owner definition; grantee `granted_role`; ungranted → 404 masquerade). |
| POST   | `/`                  | Token | Create manual (`origin='user'`) collection.           |
| PUT    | `/:id`               | Token | Update name / pin / publish_mode.                     |
| POST   | `/:id/archive`       | Token | Archive (manual; confirm dialog is client-side).      |
| POST   | `/:id/restore`       | Token | Restore an archived collection.                       |
| DELETE | `/:id`               | Token | Permanent delete — archived only, else 409.           |
| GET    | `/:id/items`         | Token | Member view, cursor-paged, digest counts via `since`. |
| POST   | `/:id/items`         | Token | Add members. Body `{ nodeIds }`.                      |
| DELETE | `/:id/items`         | Token | Remove stored rows / insert exclusions (derived).     |
| POST   | `/preview`           | Token | Dry preview: `{ seedNodeId }` or `{ definition }`.    |
| POST   | `/:id/preview`       | Token | Dry-run the stored definition of an existing one.     |
| GET    | `/merge-suggestions` | Token | Pending merge-suggestion cards (§4.4).                |
| POST   | `/:id/merge/:other`  | Token | Execute merge; `:id` survives.                        |
| POST   | `/:id/merge-dismiss` | Token | `Later` — defer the pair (2-week re-raise).           |
| POST   | `/:id/merge-reject`  | Token | `Keep separate` — permanent pair suppression.         |
| GET    | `/:id/grants`        | Token | List sharing grants (owner only).                     |
| POST   | `/:id/grants`        | Token | Grant `viewer\|editor`.                               |
| DELETE | `/:id/grants`        | Token | Revoke grant. Query `userId`.                         |
| POST   | `/for-nodes`         | Token | Batch membership lookup for file-listing chips.       |

`GET /merge-suggestions` and `POST /preview` / `POST /for-nodes` are literal paths and
MUST be registered before the `/:id` parameterized routes.

**Not in this router:** `leave` (`Leave`, per-user `collection_visibility` hidden flag,
§4.7). No digest-reset endpoint exists —
the visit cursor advances implicitly on `GET /:id/items` (see decision below). The file-like
toggle and the whole-viewer liked-ids read ride the separate `/api/file-likes` mount —
[fileLikes.md](fileLikes.md) (per-node subject; the member-view `liked` field here stays).

### 2.3 Middleware Used

- `authenticateToken`, `requireUser` (per-router, domain layout per recentFiles precedent)
- `setupModeGuardInstance` at mount (see §2.1)
- `parseNodeId`-style validation for `nodeIds`/`seedNodeId` payload fields (numeric nodeIds
  only; invalid ids are rejected 400, never normalized)

### 2.4 Request/Response Spec

**Wire casing (CODING_STYLE.md Express Patterns, binding):** request bodies camelCase nodeId-style (`nodeIds`,
`seedNodeId`, `userId`, `otherId`, `publishMode`); **all response fields snake_case**
(`collection_id`, `publish_mode`, `created_at`, `node_id`, `action_id`). Timestamps are
ISO-8601 UTC strings. Route param `:id` is the numeric `collection_id`.

Common collection object (`collection`):

```json
{
  "collection_id": 17,
  "owner_id": 4,
  "name": "Europe trip",
  "origin": "user",
  "status": "active",
  "publish_mode": "ask",
  "pinned": true,
  "pinned_by": "user",
  "name_locked": true,
  "definition": { "kind": "seed_vector", "seed_ref": 90210, "theta": 0.62 },
  "granted_role": null,
  "item_count": 58,
  "archived_at": null,
  "last_member_change_at": "2026-09-14T02:11:00Z",
  "created_at": "2026-08-02T09:30:00Z",
  "updated_at": "2026-09-14T02:11:00Z"
}
```

Field rules:

- `origin`: `system | user | seed | search` (§3.1). `status`: `active | archived`.
- `pinned_by`: `user | auto | null` (§4.9b — auto-pin on any user touch of a system
  collection; NULL for `user|seed|search` origin).
- `definition`: returned to the **owner only**; omitted for shared (`granted_role` non-null)
  rows (a rule definition leaks the owner's predicate set).
- `granted_role`: `viewer | editor` when the row is shared to the requester, else `null`
  (own collections). Shared rows appear in the same list, icon chip is client-side
  (`granted_role != null`); never pinned to top (§3.1).
- `item_count`: members in the requester-resolved view (stored ∪ derived − exclusions,
  live ACL + trash filter applied), exact.

- **GET /:** Query `sort` = `activity` (default — `activity_score` desc, then
  `last_member_change_at`, `created_at` desc; store §2.5) | `name` | `created` |
  `updated` | `similar`; `include` = comma list of `mine,shared,archived` (default
  `mine,shared`).
  `similar` = centroid-cluster grouping (§3.1, greedy nearest-neighbor over the returned
  rows in JS): rows are pre-grouped in cluster order and each carries
  `cluster_index: 0|1|...` for group headers; all other sorts omit `cluster_index`.
  200: `{ "collections": [ <collection>, … ] }` — the full list, no pagination.
  **Decision:** the collection list is unpaginated (personal scale; §3.1 "≤~20 rows"
  in-JS sort precedent).
- **POST /:** Body `{ name }`. Creates `origin='user'`, `status='active'`,
  `publish_mode='ask'` (default, §3.1). Name collision never errors: a trash-restore-style
  suffix counter is applied server-side (§3.1). 201: `{ "collection": <collection>,
"undo": { "action_id": 990 } }`.
- **PUT /:id:** Body any of `{ name?, pinned?, publishMode? }` (publishMode ∈
  `ask|off|auto`). A user `name` write sets `name_locked=true` (§3.2). `pinned:true` sets
  `pinned_by='user'`; `pinned:false` unpins (eligible for auto-archive again). Owner-only.
  200: `{ "collection": <collection>, "undo": { "action_id": 991 } }`.
- **POST /:id/archive:** Owner-only. Active → archived + `archived_at`. 409
  `collections.alreadyArchived`. 200: `{ "collection": <collection>, "undo":
{ "action_id": 992 } }`.
- **POST /:id/restore:** Owner-only, archived → active; name collision re-suffixes.
  409 `collections.notArchived`. 200: same shape as archive.
- **DELETE /:id:** Owner-only, **only when archived** (2-step trash-parity, invariant 5).
  Active → 409 `collections.notArchived`. Permanent delete cascades membership/grant rows;
  journal rows for the collection are cascade-purged; `origin='system'` writes one
  `collection_tombstones` row (invariant 10). 204, **no undo pointer**.
- **GET /:id/items:** Query `cursor` (opaque, from `next_cursor`), `limit` (default 50,
  max 200), optional `since` (ISO timestamp — digest delta counts, §4.8).
  View = stored ∪ derived − exclusions, resolved at read time with join-time ACL
  (enrichment precedent `recentFiles/service.js`): trashed-by-owner members are hidden
  (row kept); unreadable members render as `state:"revoked"` placeholder rows with
  `name`/`type` null (metadata after revocation is a leak, §3.2). In a **shared view**
  (requester is grantee, not owner), foreign-owned members are omitted entirely (cross-leak
  rule); in the **owner's view** they render with `"shared_excluded": true` (§3.2 chip).
  New members of `ask`/`off` collections render `published:false` to the owner; grantees
  only ever see `published:true` rows (§4.7).
  200:

```json
{
  "items": [
    {
      "node_id": 90210,
      "name": "poster.pdf",
      "type": "file",
      "membership": "derived",
      "published": false,
      "added_by": null,
      "created_at": "2026-09-13T10:00:00Z",
      "state": "normal",
      "liked": false,
      "reason": "tag:poster",
      "shared_excluded": false
    }
  ],
  "next_cursor": null,
  "publish_pending_count": 5,
  "digest": { "added_since": 3, "removed_since": 1 }
}
```

`membership`: `stored | derived`; `state`: `normal | revoked`; `reason` = matched
predicate name for derived members (computed at query time, §4.8 — not a history table),
`null` for stored. `publish_pending_count` is owner-visible only (keyed on collection
`publish_mode != auto` rows with `published=false`); grantees get the key omitted.
`digest` appears only when `since` was supplied.
**Decision:** serving `GET /:id/items` stamps `collection_digest_cursors.last_visited_at`
to now for the requester (the read IS the visit; no separate reset endpoint).
`similar`-style ordering: items sort by activity score desc, then `node_id` asc — stable
under cursor.

- **POST /:id/items:** Owner or editor. Body `{ nodeIds: [ … ] }` (1–200, else 400
  `collections.emptyNodeIds` / 400 over cap). Rule §3.2: you may only add what you can
  read — unreadable nodes are listed in `rejected_not_readable`, the rest still add (200).
  New stored rows start `published=false` unless `publish_mode='auto'` (§4.7). Adding to a
  `system` collection triggers auto-pin (§4.9b). 200:

```json
{
  "added": [90210, 90211],
  "already_members": [],
  "rejected_not_readable": [90299],
  "undo": { "action_id": 993 }
}
```

- **DELETE /:id/items:** Owner, or editor for what they added (§4.7) — 403
  `collections.forbidden` otherwise. Body `{ nodeIds }`. Semantics per §3.2 batch exclude:
  stored rows are deleted (`removed`); for non-`user` origins an
  `collection_exclusions` row is inserted so the definition cannot re-admit the node
  (`excluded`). An exclusion on a `user`-origin collection is meaningless → the node lands
  in `ignored`. Auto-pin touch on system collections. 200:

```json
{
  "removed": [90210],
  "excluded": [90211],
  "ignored": [],
  "undo": { "action_id": 994 }
}
```

- **POST /preview:** Body exactly one of `{ seedNodeId }` (seed-vector rule: seed vector vs
  requester-visible candidates, cosine, §4.5 — requires the `embed` LLM role) or
  `{ definition }` (rule dry-count: path/tag/like/date/size predicates, §3.2 — works with
  zero LLM). 400 `collections.previewTargetRequired` when neither/both given. 200:

```json
{
  "count": 143,
  "sample": [
    { "node_id": 90210, "name": "poster.pdf" },
    { "node_id": 90212, "name": "map.png" }
  ],
  "sample_truncated": true
}
```

`sample` is capped at 12 (the confirm dialog renders sample + `plus N more` from
`count - sample.length`). Seed preview without `embed` configured → 409
`serverErrors.ai.notConfigured` (§4.12); definition previews never touch AI.

- **POST /:id/preview:** Empty body; dry-runs the collection's stored `definition` for the
  requester. Owner-only (granted viewers/editors → 403 `forbidden`; ungranted → 404
  masquerade per §2.4.2). Response identical to POST /preview.
- **GET /merge-suggestions:** Rows `state='pending'` where the requester owns both sides
  (§4.4; one card at a time is a client concern — the full pending set is returned).
  200:

```json
{
  "suggestions": [
    {
      "suggestion_id": 88,
      "a_id": 17,
      "a_name": "Europe",
      "b_id": 23,
      "b_name": "2026-trip",
      "overlap_count": 41,
      "merged_count": 58,
      "score": 812,
      "created_at": "2026-09-16T03:00:00Z"
    }
  ]
}
```

`score` is the schema's scaled integer (×1000, `score BIGINT` in §5) — the client does
not re-float it. **Decision:** row order = `score` desc.

- **POST /:id/merge/:other:** Owner of both, both `active`, `:id` != `:other` (400
  `collections.mergeSameCollection`). The card IS the confirmation — no extra dialog
  (§4.4). `:id` survives: kept name unless the survivor must adopt the other's
  `name_locked` state (survivor name kept as-is; §4.4), stored members and likes-agnostic
  membership of `:other` are moved to the survivor, `:other` is deleted (FK cascade),
  matching suggestion row (if any) → `state='merged'`. 200:

```json
{
  "survivor": { "collection_id": 17, "name": "Europe", "item_count": 58 },
  "absorbed_id": 23,
  "undo": { "action_id": 995 }
}
```

**Decision:** merge is allowed for any owned active pair even without a pending
suggestion row (a suggestion state transition is opportunistic).

- **POST /:id/merge-dismiss:** Body `{ otherId }`. `Later` semantics: suggestion →
  `state='dismissed'`, `dismissed_at=now`; the nightly pass re-raises once after 2 weeks
  then sleeps 30d (§4.4 — timing logic lives in the evolution pass, not the API). 200:
  `{ "suggestion_id": 88, "state": "dismissed", "dismissed_at": "…" }`.
- **POST /:id/merge-reject:** Body `{ otherId }`. `Keep separate`: → `state='rejected'`,
  `rejected_at=now` — permanent pair suppression (§4.4). 200: `{ "suggestion_id": 88,
"state": "rejected", "rejected_at": "…" }`.
  Both dismiss and reject 404 `collections.suggestionNotFound` when no pending row exists
  for the pair.
- **GET /:id/grants:** Owner only. 200: `{ "grants": [ { "grantee_id": 9, "username":
"bob", "role": "viewer", "granted_by": 4, "created_at": "…" } ] }`.
- **POST /:id/grants:** Body `{ userId, role }`, role ∈ `viewer|editor` (400
  `collections.invalidRole`; unknown/approved-absent user → 404
  `collections.granteeNotFound`). Re-grant overwrites the role (PK pair), journaled as one
  command. 201: `{ "grant": { …row… }, "undo": { "action_id": 996 } }`.
- **DELETE /:id/grants:** Query `userId`. Revocation is instant (§4.7). 200:
  `{ "grantee_id": 9, "revoked": true, "undo": { "action_id": 997 } }`.
  404 `collections.grantNotFound` when no such row.
- **POST /for-nodes:** Body `{ nodeIds }` (1–200). Batch membership chips for the file
  listing (listing contracts frozen). Resolves membership in every collection
  visible to the requester (own + granted, active only). 200: `{ "memberships": [
{ "node_id": 90210, "collection_ids": [17, 23] } ] }` — one entry per requested node,
  `collection_ids` possibly empty.

### 2.4.1 Error Codes (SERVER_ERROR_CODES style)

| HTTP | errorCode                                        | Trigger                                                                                              |
| ---- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 400  | `serverErrors.collections.nameRequired`          | Empty/missing name on create.                                                                        |
| 400  | `serverErrors.collections.invalidName`           | `validateFileName` failure (incl. `.wea-` prefix).                                                   |
| 400  | `serverErrors.collections.invalidSort`           | Unknown `sort` value.                                                                                |
| 400  | `serverErrors.collections.invalidInclude`        | Unknown token in `include`.                                                                          |
| 400  | `serverErrors.collections.invalidPublishMode`    | Bad `publishMode`.                                                                                   |
| 400  | `serverErrors.collections.invalidRole`           | Grant role outside `viewer\|editor`.                                                                 |
| 400  | `serverErrors.collections.emptyNodeIds`          | Missing/empty/over-cap `nodeIds`.                                                                    |
| 400  | `serverErrors.collections.previewTargetRequired` | 0 or 2 of `seedNodeId`/`definition`.                                                                 |
| 400  | `serverErrors.collections.mergeSameCollection`   | `:id == :other`.                                                                                     |
| 400  | `serverErrors.collections.invalidDefinition`     | Malformed `definition` payload (unknown kind / predicate type / bad atom).                            |
| 403  | `serverErrors.collections.forbidden`             | Non-owner mutation; viewer writes; editor removing what they did not add.                            |
| 404  | `serverErrors.collections.notFound`              | Unknown id, or no access at all (read = 404 masquerade — ungranted reads do not disclose existence). |
| 404  | `serverErrors.collections.granteeNotFound`       | Unknown user on grant.                                                                               |
| 404  | `serverErrors.collections.grantNotFound`         | Revoke of a non-existing row.                                                                        |
| 404  | `serverErrors.collections.suggestionNotFound`    | Dismiss/reject without a pending row.                                                                |
| 409  | `serverErrors.collections.alreadyArchived`       | Archive of an archived collection.                                                                   |
| 409  | `serverErrors.collections.notArchived`           | Restore/delete of an active collection.                                                              |
| 409  | `serverErrors.ai.notConfigured`                  | Seed preview without the `embed` role (§4.12).                                                       |

All errors follow the shared error envelope (`errorCode` + optional `params`,
[shared-contracts.md](../../../shared-contracts.md)); client locale mirror is mandatory.

### 2.4.2 Decisions (micro-details the plan left open)

- **Decision:** list `include` defaults to `mine,shared`; archived is opt-in because
  `__archive__` is a separate virtual node (§3.1).
- **Decision:** read access without any grant is a 404 masquerade (files-read precedent),
  never 403, so collection existence is not leaked.
- **Decision:** item ordering = activity score desc then `node_id` asc (stable cursor).
- **Decision:** `since` is an ISO timestamp compared against stored
  `collection_items.created_at` and the row's `last_member_change_at` (derived, §4.8).
- **Decision:** DELETE `/items` carries a JSON body (`{ nodeIds }`) — same channel shape
  as POST for symmetric batch semantics.
- **Decision:** merge survivor = `:id` path param (the card's target collection), loser
  hard-deleted; undo restores the loser row and moves members back (journal payload).
- **Decision:** `ai.notConfigured` on preview uses HTTP 409 (capability-state conflict),
  consistent with §4.12 "not 404".
- **Decision:** `pinned` accepts only `true|false`; there is no `pinned_by` write surface
  (`auto` is set only by the evolution pass, §4.9b).
- **Decision (as-built T0.3):** a multi-field `PUT /:id` body journals one command per
  present field (rename / pin / publish-mode, in that order) and the response's
  `undo.action_id` points at the FIRST command — a tip undo of it cascades through the
  later commands of the same update (journal chain semantics, actions.md).
- **Decision (as-built T0.3):** restore with a name collision journals the silent
  suffix rename and the restore; the undo pointer is the restore command.
- **Decision (as-built T0.3):** item ordering reads member activity scores from the
  `node_activity` rollup when its store lands (T0.6); until then every score is absent
  and ordering falls through to the `node_id` asc tie-break. The cursor keyset is
  `(activity score, node_id)`-shaped so paging stays stable when scores appear.

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md),
  [ARCHITECTURE.md](../../../ARCHITECTURE.md), [actions.md](actions.md) (undo),
  `docs/features/collections-platform.md` §2/§3.1/§3.2/§4.4/§4.5/§4.7/§4.8/§4.9/§5, CODING_STYLE.md Express Patterns.

### 2.6 Integration Test Scenarios

- [ ] Create → list (default `mine` sort=activity) → rename (name_locked flips) →
      archive → restore → delete only after archive; active delete → 409 `notArchived`
- [ ] Ungranted GET /:id or /:id/items → 404 masquerade; viewer POST /items → 403
- [ ] Name collision on create/restore auto-suffixes, never errors
- [ ] Items: stored member + derived member + excluded node → view shows
      stored ∪ derived − exclusions; trashed member hidden; revoked member renders
      placeholder with null name
- [ ] `since` returns digest `added_since/removed_since` and reading items advances the
      visit cursor (second call with fresh `since` → zeros)
- [ ] `publish_pending_count` visible to owner, absent for grantee; `ask` new member is
      invisible to grantee until published (`auto` mode flips this)
- [ ] Editor may exclude a node they added but not one added by the owner → 403
- [ ] Exclusion on a system collection inserts `collection_exclusions` and sets
      `pinned_by='auto'`; no journal row for the pin itself (§4.9b)
- [ ] POST /preview with definition works with zero LLM; with `seedNodeId` and embed
      absent → 409 `serverErrors.ai.notConfigured`
- [ ] Merge: both owned → 200, survivor absorbs, loser gone, suggestion → `merged`,
      undo action id returned; `:id == :other` → 400
- [ ] Dismiss then reject on the same pair: dismiss is reversible by the pass, reject is
      terminal (`rejected` row never re-suggested)
- [ ] Grants lifecycle: grant viewer → grantee lists the collection with `granted_role`
      and no `definition` field → revoke instant
- [ ] for-nodes returns membership chips including derived membership
- [ ] Every mutation response carries snake_case fields and an `undo.action_id`;
      DELETE /:id carries none
- [ ] Setup-mode: mount returns the guard response while setup incomplete
