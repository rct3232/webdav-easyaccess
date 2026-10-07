# file-likes routes Spec

Target-contract spec (`docs/features/collections-platform.md` §3.3 Like, §3.4 Usage signals; store: [fileLikesStore.md](../store/fileLikesStore.md)).

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/file-likes`                                                                                                                                                                                                                                                                  |
| Role       | Viewer-scoped like surface for the context-menu / action-sheet / properties-header heart: the toggle write and the whole-list read that feeds `file.liked` row state (main listing AND collection member rows share one state — the heart reflects the current viewer's own like). |
| Journal    | NONE — a like is self-reversing trivial state (undo-journal matrix "like/visit/sort manipulation": no toast, no undo). Response carries no `undo` pointer.                                                                                                                         |

**Mount boundary:** likes are per (user, file-node), not per collection, and a `/likes` literal
under `/api/collections` would be shadowed by the `/:id` parameterized routes — `/api/file-likes`
mounts independently (kebab-case plural mount-path convention). Router file
still owned by the collections domain: `server/domains/collections/fileLikesRoutes.js`.

**`GET /api/collections/:id/items` keeps its per-row `liked` field** (member-view enrichment,
`collectionsService.md`); this router adds the whole-viewer read (listing rows) and the write.

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/collections/fileLikesRoutes.js` (thin router)
- **Service:** `server/domains/collections/fileLikesService.js` (bare string codes → route-level `ERROR_MAP`/`mapServiceError`)
- **Test file:** `server/domains/collections/__tests__/fileLikes.test.js`

**Mount:** `server/index.js`, next to the collections mount, after the app-level migrationGate and
with `setupModeGuardInstance`:
`app.use('/api/file-likes', setupModeGuardInstance, require('./domains/collections/fileLikesRoutes'))`.

### 2.2 Route List (sync with api.md)

| Method | Path       | Auth  | Description                                                                                  |
| ------ | ---------- | ----- | -------------------------------------------------------------------------------------------- |
| GET    | `/`        | Token | All liked node ids of the current viewer.                                                    |
| GET    | `/items`   | Token | Liked-items ROW listing (Likes surface) — **full fetch, ONE response**, classified (§2.4.2). |
| PUT    | `/:nodeId` | Token | Explicit set: body `{ liked: true\|false }` → toggle row.                                    |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`, `requireNonAdmin` (per-router, in that order; recentFiles/collections precedent)
- **Actor restriction (operator rule):** ALL routes (`GET /`, `GET /items`,
  `PUT /:nodeId`) respond **403 `serverErrors.collections.forbidden`** for ADMIN requesters — the
  admin actor never likes (collections/likes/dashboard are personal-storage surfaces).
- `setupModeGuardInstance` at mount (coverage invariant, ARCHITECTURE §1.3)
- `parseNodeId` for `:nodeId` (numeric only; invalid → 400, never normalized)

### 2.4 Request/Response Spec

Wire casing: request bodies camelCase nodeId-based; responses snake_case.

- **GET /:** 200: `{ "liked": [90210, 90211] }` — `node_id`s only (viewer-scoped: likes
  reflect the current viewer only — no names, no counts, no other-user state). Ordering:
  `node_id` asc (store contract).
  View-scoped read includes liked-but-since-trashed nodes (rows survive trash, fileLikesStore §2.3)
  — clients resolve like-state against the rows they can already see.
- **PUT /:nodeId:** Body `{ liked }` (`liked` strictly boolean, else 400
  `files.invalidPath`). Unknown or non-readable target node → 404
  `files.notFound` (404 masquerade — liking must not disclose node existence). On accept 200:
  `{ "node_id": 90210, "liked": true }` — echo of the settled state (idempotent: re-liking a
  liked pair is a 200 no-op, `addLike` `changes: 0`, fileLikesStore §2.2).
- **Usage recording:** on the transition into a NEW like (`liked=true` AND
  the store insert actually inserted, `changes: 1`), the service fires
  `usageService.recordEvent({ userId, nodeId, action: 'like' })` — fire-and-forget after the
  like row commits (the commit point; recording errors are logged, never fail the toggle,
  usageStore.md §2.5). Unlike records NOTHING (positive-weight signal only — `w_like` is an
  activity-score weight);
  re-liking an already-liked pair records nothing (idempotency guard = the same `changes:1`).

### 2.4.1 Error Codes

| HTTP | errorCode                            | Trigger                                                                      |
| ---- | ------------------------------------ | ---------------------------------------------------------------------------- |
| 400  | `serverErrors.files.invalidPath`     | Non-numeric `:nodeId`, missing/empty, or non-boolean `liked`.                |
| 403  | `serverErrors.collections.forbidden` | ADMIN requester — operator-rule gate (`requireNonAdmin`); admin never likes. |
| 404  | `serverErrors.files.notFound`        | Node unknown or not readable by the requester (masquerade).                  |

No new `SERVER_ERROR_CODES` keys (locale mirrors untouched); all existing codes/en/ko strings apply.

### 2.4.2 GET /items — the liked-items listing (Likes surface)

Backs the static Likes child row of the Collections sidebar section: the surface is
`/files/__collections__/liked`, NOT a top-level `__liked__` virtual root
(`docs/features/collections-platform.md` §3.3 landing note).

- **Query:** none. `?cursor=`/`?limit=` are IGNORED (never an error) — the response always
  carries the complete row set with no `next_cursor`.
- **200:** `{ "items": [ { "node_id", "name", "type", "mime", "state", "liked": true,
"created_at" } ] }` — the COMPLETE classified row set in one response (the client's
  `useInfiniteScroll` slices 50+50 for display);
  the `serializeItem`-shape minus the
  membership fields (there is no stored/derived membership, publish state or `reason` on this
  surface); `created_at` is the NODE creation time (the only timestamp available — see
  Ordering) and feeds the client's `lastmod` fallback (`toMemberRow`).
- **Source & Ordering:** `fileLikesStore.listLikedNodeIds(userId)` then a
  per-node `fileNodesStore.getNode` loop. **No liked-at timestamp exists in the store**, so
  the listing order is `node_id` asc — that is the contract (stable full-set order).
- **Classification** (likes SURVIVE trash and permission loss — fileLikesStore.md §2.3 — so
  the listing must resolve each id against CURRENT state, mirroring
  `collections/service.js resolveMemberRows`):
  - Live (`getNode` returns the row) AND readable (same `canReadNode` gate as the PUT:
    owner-resolved or READ ACL) ⇒ `state:'normal'` with `name`/`type`/`mime` from the node.
  - Node exists but is no longer readable by the viewer (grant revoked) ⇒ `state:'revoked'`
    with `name`/`type`/`mime` **NULL** (the resolveMemberRows masquerade parity — the listing
    never discloses a name the viewer can no longer read).
  - Node trashed (or purged — then the like row cascaded away) ⇒ **row HIDDEN**, the like row
    stays in the store (member parity: `resolveMemberRows` skips missing `getNode` rows; a
    restored node surfaces again on the next read).
- **Scoping:** viewer-scoped (likes are per user+node; other users' like states are never
  visible) — the requesting user's own likes only; auth-only,
  no new error codes (`limit`/`cursor` params are ignored).

### 2.5 Related Documents

- [collections.md](collections.md) (member-view `liked`), [fileLikesStore.md](../store/fileLikesStore.md),
  [usageStore.md](../store/usageStore.md) (recording path), [api.md](../../../api.md),
  `docs/features/collections-platform.md` §3.3/§3.4/§4.11.

### 2.6 Integration Test Scenarios

- [ ] Unauthenticated GET/PUT → 401; setup-mode → guard response while incomplete
- [ ] PUT `{liked:true}` on a readable node → 200 `{node_id, liked:true}`; GET lists the id
- [ ] PUT `{liked:true}` again → 200, still one row, no second `like` usage event
- [ ] PUT `{liked:false}` → row removed; GET omits the id; NO usage event (either way)
- [ ] Non-boolean `liked` / non-numeric `:nodeId` → 400 `files.invalidPath`
- [ ] Unknown node / node without READ grant → 404 `files.notFound` (no row, no event)
- [ ] Usage insert failure never surfaces on the toggle response (fire-and-forget)
- [ ] Viewer scoping: user B's GET does not contain A's liked ids
- [ ] GET /items: readable liked node ⇒ `state:'normal'` row with `name`/`type`/`mime` +
      `liked:true` + `created_at`; order `node_id` asc
- [ ] GET /items: revoked grant ⇒ `state:'revoked'` row with null `name`/`type`/`mime`
      (masquerade parity); trashed liked node ⇒ row ABSENT while the like row survives the
      trash (restore re-surfaces it)
- [ ] GET /items: returns the FULL classified row set in one response; `cursor`/`limit`
      params are IGNORED (200, same complete body incl. junk values); no
      `next_cursor` key on the response
- [ ] GET /items unauthenticated → 401; viewer scoping holds (B's listing excludes A's likes)
