# file-likes routes Spec

Target-contract spec (T0.5 — `docs/features/collections-platform.md` §3.3 Like, §3.4 Usage signals; store: [fileLikesStore.md](../store/fileLikesStore.md)).

## 1. Overview

| Item       | Description                                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/file-likes`                                                                                                                                   |
| Role       | Viewer-scoped like surface for the context-menu / action-sheet / properties-header heart: the toggle write and the whole-list read that feeds `file.liked` row state (main listing AND collection member rows share one state — §3.3). |
| Journal    | NONE — a like is self-reversing trivial state (§4.11 matrix "like/visit/sort manipulation": no toast, no undo). Response carries no `undo` pointer.  |

**Why not under `/api/collections`:** likes are per (user, file-node), not per collection; the
collections router's `/:id` parameterized routes would shadow any `/likes` literal mounted after
it. Separate kebab-case plural mount (§6 domain-layout convention), router file still owned by the
collections domain: `server/domains/collections/fileLikesRoutes.js`.

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

| Method | Path        | Auth  | Description                                              |
| ------ | ----------- | ----- | -------------------------------------------------------- |
| GET    | `/`         | Token | All liked node ids of the current viewer.                |
| PUT    | `/:nodeId`  | Token | Explicit set: body `{ liked: true\|false }` → toggle row. |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser` (per-router, recentFiles/collections precedent)
- `setupModeGuardInstance` at mount (coverage invariant, ARCHITECTURE §1.3)
- `parseNodeId` for `:nodeId` (numeric only; invalid → 400, never normalized)

### 2.4 Request/Response Spec

Wire casing per PLAN §6: request bodies camelCase nodeId-based; responses snake_case.

- **GET /:** 200: `{ "liked": [90210, 90211] }` — `node_id`s only (invariant 9: viewer-scoped;
  no names, no counts, no other-user state). Ordering: `node_id` asc (store contract).
  View-scoped read includes liked-but-since-trashed nodes (rows survive trash, fileLikesStore §2.3)
  — clients resolve like-state against the rows they can already see.
- **PUT /:nodeId:** Body `{ liked }` (`liked` strictly boolean, else 400 `files.invalidPath` —
  reuse of the generic malformed-payload code, `emptyNodeIds`-style precedent; the toggle is
  client-initiated and never guesses). Unknown or non-readable target node → 404
  `files.notFound` (404 masquerade — liking must not disclose node existence). On accept 200:
  `{ "node_id": 90210, "liked": true }` — echo of the settled state (idempotent: re-liking a
  liked pair is a 200 no-op, `addLike` `changes: 0`, fileLikesStore §2.2).
- **Usage recording (register (a), §3.4):** on the transition into a NEW like (`liked=true` AND
  the store insert actually inserted, `changes: 1`), the service fires
  `usageService.recordEvent({ userId, nodeId, action: 'like' })` — fire-and-forget after the
  like row commits (the commit point; recording errors are logged, never fail the toggle,
  usageStore.md §2.5). Unlike records NOTHING (positive-weight signal only; `w_like` §3.4);
  re-liking an already-liked pair records nothing (idempotency guard = the same `changes:1`).

### 2.4.1 Error Codes

| HTTP | errorCode                          | Trigger                                             |
| ---- | ---------------------------------- | ---------------------------------------------------- |
| 400  | `serverErrors.files.invalidPath`   | Non-numeric `:nodeId`, missing/empty, or non-boolean `liked`. |
| 404  | `serverErrors.files.notFound`      | Node unknown or not readable by the requester (masquerade). |

No new `SERVER_ERROR_CODES` keys (locale mirrors untouched); all existing codes/en/ko strings apply.

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
- [ ] Viewer scoping: user B's GET does not contain A's liked ids (invariant 9)
