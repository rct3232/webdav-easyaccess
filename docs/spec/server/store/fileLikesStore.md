# fileLikesStore Spec

## 1. Overview

| Item      | Description                                                                                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role      | Per-user likes on files — table `file_likes(user_id, node_id, created_at)`. Viewer-scoped only: the heart reflects the CURRENT VIEWER'S own like; other users' like states/counts/aggregates are never exposed (invariant 9). |
| Precedent | Direct twin of `recentFilesStore` (per-user normalized table, stable node_ids, PK-pair uniqueness, `node_id → file_nodes` FK) — see `docs/spec/server/store/recentFilesStore.md`.                                             |
| Journal   | NONE. Like is self-reversing trivial state — no toast, no `action_journal` row (§4.11 undo-availability matrix "like / 방문 / 정렬 조작").                                                                                    |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/fileLikesStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/FileLikesRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/FileLikesRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/FileLikesRepository.conformance.test.js`
- **Facade test:** `server/domains/collections/__tests__/fileLikesStore.test.js` (recentFiles precedent: tests live with the owning domain)
- **DDL source of truth:** `server/store/postgresql/ddl/002_collections.sql` (table block per §5: `file_likes(user_id, node_id→CASCADE, created_at, PK(pair))`)

### 2.2 Main Methods

| Method             | Signature                                         | Description                                                                                     |
| ------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `isLiked`          | (userId, nodeId) => Promise\<boolean\>            | Single probe.                                                                                   |
| `listLikedNodeIds` | (userId) => Promise\<nodeId[]\>                   | All liked node ids of the viewer (hot-set for split triggers / quality gate, §3.3).             |
| `filterLiked`      | (userId, nodeIds) => Promise\<nodeId[]\>          | Intersection — list-view enrichment (heart state per row, `for-nodes` surfaces).                |
| `addLike`          | (userId, nodeId) => Promise\<{ changes }\>        | Idempotent INSERT ON CONFLICT DO NOTHING on the PK pair; re-like is a no-op, NOT an error.      |
| `removeLike`       | (userId, nodeId) => Promise\<{ changes }\>        | DELETE by pair; unliked removal → `changes: 0`.                                                 |
| `setLiked`         | (userId, nodeId, liked) => Promise\<{ changes }\> | Convenience toggle (add/remove dispatch) for the context-menu / properties-header heart (§3.3). |

**Deliberately absent:** any cross-user aggregation (`countLikesByNode`, `listLikers`) —
invariant 9 forbids surfacing other users' like states anywhere, shared views included;
the store exposes no query that could leak them.

### 2.3 Storage Semantics

- PK `(user_id, node_id)`; `node_id` FK `ON DELETE CASCADE` (recent_files DDL precedent —
  purged node ⇒ like row cascades away).
- `created_at` is set on insert only (no upsert-time bump — unlike `recent_files` there is
  no recency ordering; ordering, when needed, is by `created_at DESC` client-side).
- Trashed nodes: rows SURVIVE trash (FK targets the node row, not blob state); likes on a
  trashed file stay hidden with the file and re-appear on restore. Purge cascades.
- Activity rollup: `node_activity.likes` is refreshed by the nightly usage rollup (T0.6,
  usage-service scope) — this store is not involved.

### 2.4 Transaction Boundaries

- One single-statement TX per call; no `commitChange`, no `lockManager` (pair-level
  idempotency is enforced by the PK itself — concurrent duplicate adds resolve to one row).

### 2.5 Error contracts

- Reads → `false` / `[]` for missing data (never throw).
- Writes → `{ changes }`; unknown-node inserts fail on the FK and surface as
  `mapDatabaseError`-mapped errors (route-level `serverErrors.collections.*` mapping).
- No dialect branching outside the repository twins.

### 2.6 Dependencies

- `storage.getExecutor()` + `FileLikesRepository` (+ twins). No journal/lock dependencies.

### 2.7 Verification Scenarios

- [ ] `addLike` twice → one row, second call `changes: 0`, no error
- [ ] `setLiked(false)` on an unliked pair → `changes: 0`; `isLiked` false
- [ ] `filterLiked` preserves nothing outside the viewer's own likes (viewer scoping, invariant 9)
- [ ] Node purge (`deleteNodeTree`) cascades the like row away; trashing does NOT remove it
- [ ] Like toggle emits no `action_journal` row (assert journal count unchanged)
- [ ] L2 conformance on real sqlite AND real PostgreSQL: PK pair prevents duplicate likes under concurrent inserts; FK cascade parity; `{userId,nodeId}` pair round-trip shapes (number ids, ISO `createdAt`)
