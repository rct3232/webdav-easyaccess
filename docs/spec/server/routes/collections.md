# collections routes Spec

Target-contract spec.

## 1. Overview

| Item       | Description                                                                        |
| ---------- | ---------------------------------------------------------------------------------- |
| Mount path | `/api/collections`                                                                 |
| Role       | Collection CRUD, materialized membership view, preview, merge suggestions, grants. |

**Ownership boundary:** collections never mutate file nodes — grants give list/preview/download only.
`collection_grants` is a separate table domain — never read or written by `aclService`,
`permissionStore`, or permission caches (ARCHITECTURE §1.4 untouched). Undo flows for every
mutation live in [actions.md](actions.md) (`POST /api/actions/:id/undo`); mutation
responses here carry the `undo: { action_id }` pointer only. Permanent delete returns no
undo (trash-parity: it is unrecoverable).

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

| Method | Path                 | Auth  | Description                                                                                                                                                        |
| ------ | -------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| GET    | `/`                  | Token | List collections (sort, include filters).                                                                                                                          |
| GET    | `/:id`               | Token | Single collection (owner definition; grantee `granted_role`; ungranted → 404 masquerade).                                                                          |
| POST   | `/`                  | Token | Create — body-shape dispatch: `{ name }` manual (`origin='user'`), `{ name, seedNodeId }` seed (`origin='seed'`), `{ name, semantic }` search (`origin='search'`). |     |
| PUT    | `/:id`               | Token | Update name / pin / publish_mode.                                                                                                                                  |
| POST   | `/:id/archive`       | Token | Archive (manual; confirm dialog is client-side).                                                                                                                   |
| POST   | `/:id/restore`       | Token | Restore an archived collection.                                                                                                                                    |
| DELETE | `/:id`               | Token | Permanent delete — archived only, else 409.                                                                                                                        |
| GET    | `/:id/items`         | Token | Member view — **full fetch, ONE response**, digest counts via `since`.                                                                                             |
| POST   | `/:id/items`         | Token | Add members. Body `{ nodeIds }`.                                                                                                                                   |
| DELETE | `/:id/items`         | Token | Remove materialized rows / insert exclusions.                                                                                                                      |
| PUT    | `/:id/items/publish` | Token | Publish/unpublish members. Body `{ nodeIds, published }`.                                                                                                          |
| POST   | `/preview`           | Token | Dry preview: `{ seedNodeId }` or `{ definition }`.                                                                                                                 |
| POST   | `/:id/preview`       | Token | Dry-run the stored definition of an existing one.                                                                                                                  |
| GET    | `/merge-suggestions` | Token | Pending merge-suggestion cards.                                                                                                                                    |
| POST   | `/:id/merge/:other`  | Token | Execute merge; `:id` survives.                                                                                                                                     |
| POST   | `/:id/merge-dismiss` | Token | `Later` — defer the pair (2-week re-raise).                                                                                                                        |
| POST   | `/:id/merge-reject`  | Token | `Keep separate` — permanent pair suppression.                                                                                                                      |
| GET    | `/:id/grants`        | Token | List sharing grants (owner only).                                                                                                                                  |
| POST   | `/:id/grants`        | Token | Grant `viewer\|editor`.                                                                                                                                            |
| DELETE | `/:id/grants`        | Token | Revoke grant. Query `userId`.                                                                                                                                      |
| DELETE | `/:id/grants/me`     | Token | Grantee revokes their OWN grant (`viewer\|editor`).                                                                                                                |
| POST   | `/for-nodes`         | Token | Batch membership lookup for file-listing chips.                                                                                                                    |

`GET /merge-suggestions` and `POST /preview` / `POST /for-nodes` are literal paths and
MUST be registered before the `/:id` parameterized routes. `DELETE /:id/grants/me` carries the
literal `me` tail segment (different segment count from `DELETE /:id/grants`, so no Express
shadowing exists — register it BEFORE the owner `DELETE /:id/grants` as defensive convention).

**Not in this router:** there is no `leave` endpoint — the recipient exit is
`DELETE /:id/grants/me`. The per-user `collection_visibility` hidden-flag storage is read by
the list SQL but never written by any route
(`setVisible` has no server-side caller). No digest-reset endpoint exists —
the visit cursor advances implicitly on `GET /:id/items`. The file-like
toggle and the whole-viewer liked-ids read ride the separate `/api/file-likes` mount —
[fileLikes.md](fileLikes.md) (per-node subject; the member-view `liked` field here stays).

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`, `requireNonAdmin` (per-router, in that order; domain layout
  per recentFiles precedent)
- **Actor restriction (operator rule):** EVERY route in this router responds
  **403 `serverErrors.collections.forbidden`** when the requester is an ADMIN (`requireNonAdmin`).
  `POST /:id/grants` additionally 403s (same code) when the resolved **grantee is an admin**
  (service-level ban in `grantCollectionAccess`); collections never reference admins.
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
  "preview_items": [
    { "node_id": 90210, "name": "beach.jpg", "type": "file", "mime": "image/jpeg" }
  ],
  "archived_at": null,
  "last_member_change_at": "2025-09-14T02:11:00Z",
  "created_at": "2025-08-02T09:30:00Z",
  "updated_at": "2025-09-14T02:11:00Z"
}
```

Field rules:

- `origin`: `system | user | seed | search`. `status`: `active | archived`.
- `pinned_by`: `user | auto | null` (auto-pin on any user touch of a system
  collection; NULL for `user|seed|search` origin).
- `definition`: returned to the **owner only**; omitted for shared (`granted_role` non-null)
  rows.
- `granted_role`: `viewer | editor` when the row is shared to the requester, else `null`
  (own collections). Shared rows appear in the same list, icon chip is client-side
  (`granted_role != null`); never pinned to top.
- `last_visited_at` (GET / rows): the REQUESTER's
  `collection_digest_cursors.last_visited_at` (ISO string) or `null` when the requester has
  NEVER opened the collection. This is the sidebar `new`-dot source (dot ⇔ `null`;
  `CollectionsSection.md` §2.6) — seeded at create for
  the creator, stamped on `GET /:id/items` opens. Omitted on `GET /:id`/POST/PUT payloads
  (list-only field).
- `item_count`: members in the requester-resolved materialized set (`collection_items`,
  live ACL + trash filter applied), exact.
- `preview_items`: up to 4 member entries for the list card's
  2×2 preview — `{ "node_id", "name", "type", "mime" }`. Built **in memory from the same
  requester-resolved member view that `item_count` counts** (services spec §List; zero extra
  queries). Filter: only rows with `state='revoked'` are NEVER surfaced
  (a revoked member's name/thumbnail is a leak); `shared_excluded` members DO preview
  (the grantee view omits those rows upstream).
  Order: `created_at` desc (membership-added time; every row is materialized), deterministic tie-break
  `node_id` desc, then sliced to 4. `mime` = filecache mime (nullable; the row carries it
  from the `fileNodeShared` mapping). Always present (empty array when nothing previewable)
  on both `GET /` and `GET /:id` rows.

- **GET /:** Query `sort` = `activity` (default — `activity_score` desc, then
  `last_member_change_at`, `created_at` desc, final deterministic tie-break
  `id` desc; `collectionsStore.md` §2.5) | `name` | `created` |
  `updated` | `similar`; `include` = comma list of `mine,shared,archived` (default
  `mine,shared`).
  `similar` = centroid-cluster grouping (greedy nearest-neighbor over the returned
  rows in JS): rows are pre-grouped in cluster order and each carries
  `cluster_index: 0|1|...` for group headers; all other sorts omit `cluster_index`.
  200: `{ "collections": [ <collection>, … ] }` — the full list, no pagination.
  **`GET /` rows carry the requester-scoped `last_visited_at`** (see field rules); one
  batched cursor read (`listDigestCursorMap(userId)`) serves the whole list — no per-row query.
- **POST /:** Body-shape dispatch (one create endpoint, additive body fields):
  - `{ name }` — manual. Creates `origin='user'`, `status='active'`,
    `publish_mode='ask'` (default). Name collision never errors: a trash-restore-style
    suffix counter is applied server-side. Create SEEDS the requester's digest cursor
    (`collection_digest_cursors.last_visited_at = created_at`, inside the same journaled
    mutation TX), so a self-created collection never renders the
    sidebar `new` dot. 201: `{ "collection": <collection>, "undo": { "action_id": 990 } }`.
  - `{ name, seedNodeId }` — seed (`origin='seed'`, embed-gate; `ai.notConfigured` 409
    without the `embed` role). Same cursor seeding and collision rule; readable candidate
    ids materialize as the initial batch with `source='seed'`, `reason='similar'`,
    `published=true`.
  - `{ name, semantic }` — search save leg (`origin='search'`):
    `semantic = { resultRef, predicates, nodeIds }` — the flattened semantic-execution
    snapshot of the saved search run (`searchService.md` §2.4/§2.6): `resultRef` is the
    run's `result_ref` signature (stored as the centroid REFERENCE — replay re-runs the
    signature under current ACL; replay chains are never persisted), `predicates` is the
    run's predicate set (`[]` at P1 — reserved), `nodeIds` are the semantic-section
    member ids (1–200, else 400 `collections.emptyNodeIds`). Name-match results are
    structurally absent from the payload. The stored definition is the snapshot
    `{ "kind": "search", "result_ref": …, "predicates": […] }`. Malformed `semantic`
    (missing/non-string `resultRef`, non-array or non-empty-at-P1 `predicates`,
    missing `nodeIds` array) → 400 `collections.invalidDefinition`. Readable ids
    materialize as the initial batch with `source='search'` and `published=true` (the
    confirm dialog IS the batch approval — `collectionsService.md` §2.7); ids the
    requester cannot read are NOT added
    and are reported in the response's `rejected_not_readable` (never silently dropped).
    201: `{ "collection": <collection>, "undo": { "action_id": 990 },
"rejected_not_readable": [90299] }` — the search arm carries the additive
    `rejected_not_readable` key (empty array when every id was readable); the manual and
    seed arms omit it.
- **PUT /:id:** Body any of `{ name?, pinned?, publishMode? }` (publishMode ∈
  `ask|off|auto`). A user `name` write sets `name_locked=true`. `pinned:true` sets
  `pinned_by='user'`; `pinned:false` unpins (eligible for auto-archive again). Owner-only.
  200: `{ "collection": <collection>, "undo": { "action_id": 991 } }`.
- **POST /:id/archive:** Owner-only. Active → archived + `archived_at`. 409
  `collections.alreadyArchived`. 200: `{ "collection": <collection>, "undo":
{ "action_id": 992 } }`.
- **POST /:id/restore:** Owner-only, archived → active; name collision re-suffixes.
  409 `collections.notArchived`. 200: same shape as archive.
- **DELETE /:id:** Owner-only, **only when archived** (2-step trash-parity: user destructive
  actions confirm once, permanent delete lives only on archive cards).
  Active → 409 `collections.notArchived`. Permanent delete cascades membership/grant rows;
  journal rows for the collection are cascade-purged; `origin='system'` writes one
  `collection_tombstones` row (the tombstone blocks silent regeneration of the same
  definition). 204, **no undo pointer**.
- **GET /:id/items:** Query optional `since` (ISO timestamp — digest delta counts).
  `cursor`/`limit` query params are IGNORED (never an error); the response is the complete
  row set with no `next_cursor`.
  View = materialized `collection_items`, rendered with join-time ACL
  (enrichment precedent `recentFiles/service.js`): trashed-by-owner members are hidden
  (row kept); unreadable members render as `state:"revoked"` placeholder rows with
  `name`/`type` null (metadata after revocation is a leak). In a **shared view**
  (requester is grantee, not owner), foreign-owned members are omitted entirely (cross-leak
  rule); in the **owner's view** they render with `"shared_excluded": true`.
  New rule-managed members of `ask`/`off` collections render `published:false` to the
  owner; grantees only ever see `published:true` rows. Reads never evaluate definitions.
  200 — the COMPLETE row set in one response (the client's `useInfiniteScroll` slices 50+50
  for display, server order preserved):

```json
{
  "items": [
    {
      "node_id": 90210,
      "name": "poster.pdf",
      "type": "file",
      "mime": null,
      "membership": "derived",
      "published": false,
      "added_by": null,
      "created_at": "2025-09-13T10:00:00Z",
      "state": "normal",
      "liked": false,
      "reason": "tag:poster",
      "shared_excluded": false
    }
  ],
  "publish_pending_count": 5,
  "digest": { "added_since": 3, "removed_since": 1 }
}
```

`membership`: `stored | derived` — `stored` = user-added (`source='manual'`),
`derived` = rule-managed (`source ∈ system|seed|search`), materialized either way;
`state`: `normal | revoked`; `reason` = the matched rule captured when a rule-managed
row was materialized (`"tag:poster"`, `"path:/travel/2026"`, `"similar"`), `null` for
manual rows. `mime` is the filecache mime type from the node row (nullable);
it is `null` on `state:"revoked"` placeholder rows like `name`/`type` (no metadata leak). `publish_pending_count` is owner-visible only (keyed on collection
`publish_mode != auto` rows with `published=false`); grantees get the key omitted.
`digest` appears only when `since` was supplied.
Serving `GET /:id/items` stamps `collection_digest_cursors.last_visited_at` to now for
the requester (the read IS the visit; no separate reset endpoint) — one fetch per open
stamps exactly once.
**Seed at create:** `POST /` writes the creator's cursor row
(`last_visited_at = created_at`) INSIDE the journaled create mutation TX. Consequence:
the creator's own fresh collections never dot; collections shared to a requester dot
(no cursor row) until first open; the sidebar dot rule is `last_visited_at == null`
(`useFolderTreeController.md` §3).
Items sort by activity score desc, then `node_id` asc — the stable
full-set order the client slice reads head-first.

- **POST /:id/items:** Owner or editor. Body `{ nodeIds: [ … ] }` (1–200, else 400
  `collections.emptyNodeIds` / 400 over cap). Rule: you may only add what you can
  read — unreadable nodes are listed in `rejected_not_readable`, the rest still add (200).
  New stored rows start `published=false` unless `publish_mode='auto'`. Adding to a
  `system` collection triggers auto-pin. 200:

```json
{
  "added": [90210, 90211],
  "already_members": [],
  "rejected_not_readable": [90299],
  "undo": { "action_id": 993 }
}
```

- **DELETE /:id/items:** Owner, or editor for what they added — 403
  `collections.forbidden` otherwise. Body `{ nodeIds }`. Batch-exclude semantics:
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

- **PUT /:id/items/publish:** Owner or editor (viewer → 403 `collections.forbidden`).
  Body `{ nodeIds: [ … ], published: true|false }` — 1–200 ids else 400
  `collections.emptyNodeIds` (same `parseNodeIds` boundary as the sibling item routes);
  non-boolean `published` → 400 `collections.invalidPublishMode`. Reuses the journaled
  `collectionsStore.setItemPublished`: materialized rows flip
  (`published[]`), unpublish flips back to `false` and never deletes a row; ids that are
  NOT in the materialized membership land in `ignored[]` — the route never ADDS
  membership for a node the collection does not admit (anti-injection rule). Publishing
  a row on a `system` collection is a user touch → auto-pin. 200:

```json
{
  "published": [90210],
  "ignored": [90299],
  "undo": { "action_id": 995 }
}
```

`undo.action_id` points at the flip command, and `null` when nothing mutated (all-`ignored`
batch).

- **POST /preview:** Body exactly one of `{ seedNodeId }` (seed-vector rule: seed pooled
  vector vs requester-visible pooled candidates, cosine — requires the `embed` LLM role)
  or `{ definition }` (predicate dry-count works with zero LLM; `seed_vector`/`centroid`
  definitions require the embed role and use pooled cosine). 400
  `collections.previewTargetRequired` when neither/both given. 200:

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
`serverErrors.ai.notConfigured`; definition previews never touch AI.

- **POST /:id/preview:** Empty body; dry-runs the collection's stored `definition` for the
  requester (predicate or pooled-vector; never mutates membership). Owner-only (granted
  viewers/editors → 403 `forbidden`; ungranted → 404 masquerade per §2.4.2). Response
  identical to POST /preview.
- **GET /merge-suggestions:** Rows `state='pending'` where the requester owns both sides
  (one card at a time is a client concern — the full pending set is returned).
  200:

```json
{
  "suggestions": [
    {
      "suggestion_id": 88,
      "a_id": 17,
      "a_name": "Europe",
      "b_id": 23,
      "b_name": "2025-trip",
      "overlap_count": 41,
      "merged_count": 58,
      "score": 812,
      "created_at": "2025-09-16T03:00:00Z"
    }
  ]
}
```

`score` is the schema's scaled integer (×1000, `score BIGINT`) — the client does
not re-float it. Row order = `score` desc.

- **POST /:id/merge/:other:** Owner of both, both `active`, `:id` != `:other` (400
  `collections.mergeSameCollection`). The card IS the confirmation — no extra dialog.
  `:id` survives: kept name unless the survivor must adopt the other's
  `name_locked` state (survivor name kept as-is), stored members and likes-agnostic
  membership of `:other` are moved to the survivor, `:other` is deleted (FK cascade),
  matching suggestion row (if any) → `state='merged'`. 200:

```json
{
  "survivor": { "collection_id": 17, "name": "Europe", "item_count": 58 },
  "absorbed_id": 23,
  "undo": { "action_id": 995 }
}
```

Merge is allowed for any owned active pair even without a pending
suggestion row (a suggestion state transition is opportunistic).

- **POST /:id/merge-dismiss:** Body `{ otherId }`. `Later` semantics: suggestion →
  `state='dismissed'`, `dismissed_at=now`; the nightly pass re-raises once after 2 weeks
  then sleeps 30d (timing logic lives in the evolution pass, not the API). 200:
  `{ "suggestion_id": 88, "state": "dismissed", "dismissed_at": "…" }`.
- **POST /:id/merge-reject:** Body `{ otherId }`. `Keep separate`: → `state='rejected'`,
  `rejected_at=now` — permanent pair suppression. 200: `{ "suggestion_id": 88,
"state": "rejected", "rejected_at": "…" }`.
  Both dismiss and reject 404 `collections.suggestionNotFound` when no pending row exists
  for the pair.
- **GET /:id/grants:** Owner only. 200: `{ "grants": [ { "grantee_id": 9, "username":
"bob", "role": "viewer", "granted_by": 4, "created_at": "…" } ] }`.
- **POST /:id/grants:** Body `{ userId, role }`, role ∈ `viewer|editor` (400
  `collections.invalidRole`; unknown/approved-absent user → 404
  `collections.granteeNotFound`). Re-grant overwrites the role (PK pair), journaled as one
  command. 201: `{ "grant": { …row… }, "undo": { "action_id": 996 } }`.
- **DELETE /:id/grants:** Query `userId`. Revocation is instant. The journaled revoke TX
  also deletes the grantee's digest cursor row: a re-grant afterwards re-dots the collection
  in the grantee's sidebar. 200:
  `{ "grantee_id": 9, "revoked": true, "undo": { "action_id": 997 } }`.
  404 `collections.grantNotFound` when no such row.
- **DELETE /:id/grants/me:** Grantee self-revocation — the recipient exit from a shared
  collection. Works for any held role
  (`viewer|editor`). Revocation is instant, no confirm client-side; journaled exactly
  like the owner-side revoke (same store path `revokeAccess`, `action='revoke'`, inverse
  `grant-access`, actor = grantee — and the same TX deletes the self-revoking grantee's digest
  cursor). Response mirrors the owner DELETE shape. 200:
  `{ "grantee_id": 9, "revoked": true, "undo": { "action_id": 998 } }`.
  404 `collections.grantNotFound` when the caller holds no grant row (incl. the collection
  OWNER calling it on their own collection); unknown collection / zero-access caller →
  404 `collections.notFound` (masquerade — existence never leaks, §2.4.2).
- **POST /for-nodes:** Body `{ nodeIds }` (1–200). Batch membership chips for the file
  listing. Resolves materialized membership in every collection visible to the
  requester (own + granted, active only); no definition evaluation. 200: `{ "memberships": [
{ "node_id": 90210, "collection_ids": [17, 23] } ] }` — one entry per requested node,
  `collection_ids` possibly empty.

### 2.4.1 Error Codes (SERVER_ERROR_CODES style)

| HTTP | errorCode                                        | Trigger                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `serverErrors.collections.nameRequired`          | Empty/missing name on create.                                                                                                                                                                                                                        |
| 400  | `serverErrors.collections.invalidName`           | `validateFileName` failure (incl. `.wea-` prefix).                                                                                                                                                                                                   |
| 400  | `serverErrors.collections.invalidSort`           | Unknown `sort` value.                                                                                                                                                                                                                                |
| 400  | `serverErrors.collections.invalidInclude`        | Unknown token in `include`.                                                                                                                                                                                                                          |
| 400  | `serverErrors.collections.invalidPublishMode`    | Bad `publishMode`.                                                                                                                                                                                                                                   |
| 400  | `serverErrors.collections.invalidRole`           | Grant role outside `viewer\|editor`.                                                                                                                                                                                                                 |
| 400  | `serverErrors.collections.emptyNodeIds`          | Missing/empty/over-cap `nodeIds` (item routes and the `{ name, semantic }` create arm).                                                                                                                                                              |
| 400  | `serverErrors.collections.previewTargetRequired` | 0 or 2 of `seedNodeId`/`definition`.                                                                                                                                                                                                                 |
| 400  | `serverErrors.collections.mergeSameCollection`   | `:id == :other`.                                                                                                                                                                                                                                     |
| 400  | `serverErrors.collections.invalidDefinition`     | Malformed `definition` payload (unknown kind / predicate type / bad atom); malformed `semantic` create payload on the `{ name, semantic }` arm (missing/non-string `resultRef`, non-array or non-empty-at-P1 `predicates`, missing `nodeIds` array). |
| 403  | `serverErrors.collections.forbidden`             | Non-owner mutation; viewer writes; editor removing what they did not add. ALSO the admin-operator gate: EVERY endpoint for an ADMIN requester (`requireNonAdmin`) and `POST /:id/grants` with an ADMIN grantee (service ban).                        |
| 404  | `serverErrors.collections.notFound`              | Unknown id, or no access at all (read = 404 masquerade — ungranted reads do not disclose existence).                                                                                                                                                 |
| 404  | `serverErrors.collections.granteeNotFound`       | Unknown user on grant.                                                                                                                                                                                                                               |
| 404  | `serverErrors.collections.grantNotFound`         | Revoke of a non-existing row; `/grants/me` caller holding no grant row (incl. owner).                                                                                                                                                                |
| 404  | `serverErrors.collections.suggestionNotFound`    | Dismiss/reject without a pending row.                                                                                                                                                                                                                |
| 409  | `serverErrors.collections.alreadyArchived`       | Archive of an archived collection.                                                                                                                                                                                                                   |
| 409  | `serverErrors.collections.notArchived`           | Restore/delete of an active collection.                                                                                                                                                                                                              |
| 409  | `serverErrors.ai.notConfigured`                  | Seed preview without the `embed` role.                                                                                                                                                                                                               |

All errors follow the shared error envelope (`errorCode` + optional `params`,
[shared-contracts.md](../../../shared-contracts.md)); client locale mirror is mandatory.

### 2.4.2 Contract clarifications

- List `include` defaults to `mine,shared`; archived is opt-in.
- Include tokens select row sets — `mine` = own rows,
  `shared` = granted rows, `archived` = own `status='archived'` rows; `listForUser`
  defaults to `status='active'` (store contract), so archived rows never arrive twice.
  `mine,archived` (the `__archive__` surface and the ArchiveNode badge) is
  ARCHIVED-ONLY (CollectionsSection §2.3 "exactly the `status=archived` collections");
  any include carrying `shared` alongside `archived` (the dashboard status read) is the
  full active ∪ archived ∪ granted superset.
- Read access without any grant is a 404 masquerade,
  never 403.
- Item ordering = activity score desc then `node_id` asc (stable full-set order).
- `since` is an ISO timestamp compared against materialized
  `collection_items.created_at` and the row's `last_member_change_at`; membership never
  changes on read.
- Reads (`GET /`, `GET /:id`, `GET /:id/items`, `POST /for-nodes`) return
  `collection_items` only. Definition evaluation runs at write boundaries (upload hook /
  evolution reconcile) and may add/remove rows; previews are explicit dry-runs.
- DELETE `/items` carries a JSON body (`{ nodeIds }`).
- Merge survivor = `:id` path param (the card's target collection), loser
  hard-deleted; undo restores the loser row and moves members back (journal payload).
- `ai.notConfigured` on preview uses HTTP 409 (capability-state conflict) —
  unconfigured-AI errors report `serverErrors.ai.notConfigured`, never 404.
- `pinned` accepts only `true|false`; there is no `pinned_by` write surface
  (`auto` is set only by the evolution pass).
- A multi-field `PUT /:id` body journals one command per
  present field (rename / pin / publish-mode, in that order) and the response's
  `undo.action_id` points at the FIRST command — a tip undo of it cascades through the
  later commands of the same update (journal chain semantics, actions.md).
- Restore with a name collision journals the silent
  suffix rename and the restore; the undo pointer is the restore command.
- Item ordering reads member activity scores from the
  `node_activity` rollup; while member scores are absent, ordering falls through to the
  `node_id` asc tie-break.

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md),
  [ARCHITECTURE.md](../../../ARCHITECTURE.md), [actions.md](actions.md) (undo),
  `docs/features/collections-platform.md` §2/§3.1/§3.2/§4.4/§4.5/§4.7/§4.8/§4.9, CODING_STYLE.md Express Patterns.

### 2.6 Integration Test Scenarios

- [ ] Create → list (default `mine` sort=activity) → rename (name_locked flips) →
      archive → restore → delete only after archive; active delete → 409 `notArchived`
- [ ] Ungranted GET /:id or /:id/items → 404 masquerade; viewer POST /items → 403
- [ ] Name collision on create/restore auto-suffixes, never errors
- [ ] Items: manual row + rule-managed row + excluded node → view shows the materialized
      rows; excluded node has no row; trashed member hidden; revoked member renders
      placeholder with null name
- [ ] Two consecutive reads with different view counts/new candidate files return the
      same member set (definition evaluation never runs on a read path)
- [ ] `GET /` card rows carry `preview_items` (≤4, newest-added first, revoked rows never
      present, `shared_excluded` rows present to the owner; each entry `{node_id,name,type,mime}`)
- [ ] `since` returns digest `added_since/removed_since` and reading items advances the
      visit cursor (second call with fresh `since` → zeros)
- [ ] `POST /` responds and the creator's `GET /` row carries
      `last_visited_at` = the collection's `created_at` (cursor seeded inside the create TX
      — a direct DB read shows exactly one `collection_digest_cursors` row); `GET /` rows
      for a never-opened shared collection carry `last_visited_at: null`; opening
      `GET /:id/items` then refreshing `GET /` flips it to an ISO stamp
- [ ] GET /:id/items ships the FULL row set in one response; the
      `cursor`/`limit` params are IGNORED (200, same complete body); `next_cursor` key absent
- [ ] `publish_pending_count` visible to owner, absent for grantee; `ask` new member is
      invisible to grantee until published (`auto` mode flips this)
- [ ] PUT /:id/items/publish: owner flips a stored `ask` member → grantee sees the
      row; `ignored[]` carries non-member ids (nothing was added); viewer → 403;
      non-boolean `published` → 400 `invalidPublishMode`; empty/oversized `nodeIds` →
      400 `emptyNodeIds`; undo of the returned pointer re-hides the row
- [ ] Editor may exclude a node they added but not one added by the owner → 403
- [ ] Exclusion on a system collection inserts `collection_exclusions` and sets
      `pinned_by='auto'`; no journal row for the pin itself
- [ ] POST /preview with definition works with zero LLM; with `seedNodeId` and embed
      absent → 409 `serverErrors.ai.notConfigured`
- [ ] Merge: both owned → 200, survivor absorbs, loser gone, suggestion → `merged`,
      undo action id returned; `:id == :other` → 400
- [ ] Dismiss then reject on the same pair: dismiss is reversible by the pass, reject is
      terminal (`rejected` row never re-suggested)
- [ ] Grants lifecycle: grant viewer → grantee lists the collection with `granted_role`
      and no `definition` field → revoke instant
- [ ] for-nodes returns materialized membership chips only (no definition evaluation)
- [ ] Every mutation response carries snake_case fields and an `undo.action_id`;
      DELETE /:id carries none
- [ ] Setup-mode: mount returns the guard response while setup incomplete
