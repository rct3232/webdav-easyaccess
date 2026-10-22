# dashboard routes Spec

Contract spec for the user dashboard `Storage` v1: P0 ships the hygiene read surfaces and the suggestion accept only — no LLM/vector blocks.

## 1. Overview

| Item       | Description                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------- |
| Mount path | `/api/dashboard`                                                                                  |
| Role       | Storage-dashboard server surface: hygiene/suggestions read (one GET) + cleanup accept (one POST). |

**Ownership boundary:** this router is a thin CONSUMER — it composes existing surfaces and
adds no new state machines. Dups/suggestions delegate to `domains/ai/dupFinderService`
(hash-first, LLM-free) and to `domains/ai/nearDupFinderService` (the §4.17 vector variant —
`nearDupFinderService.md`); the trash card delegates to the `FileNodeRepository` subtree trash
read (`store/fileNodesStore.md`); the accept action delegates to the files-domain trash core
(`fileService.deleteNode`). The journal feed, collections status and grants blocks
ride the EXISTING `/api/actions`, `/api/collections`, `/api/collections/:id/grants` mounts —
nothing here duplicates them.

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/dashboard/routes.js`
- **Service:** `server/domains/dashboard/service.js` (see
  [dashboardService.md](../services/dashboardService.md); bare string codes translated by
  route-level `ERROR_MAP`/`mapServiceError`)
- **Test file:** `server/domains/dashboard/__tests__/dashboard.test.js`

**Mount:** `server/index.js` registers the router **after** the app-level migrationGate and
with `setupModeGuardInstance` (coverage invariant, ARCHITECTURE §1.3):
`app.use('/api/dashboard', setupModeGuardInstance, require('./domains/dashboard/routes'))`.

### 2.2 Route List (sync with api.md)

| Method | Path                  | Auth  | Description                                                             |
| ------ | --------------------- | ----- | ----------------------------------------------------------------------- |
| GET    | `/`                   | Token | One-shot dashboard read: dup summary + suggestion rows + trash summary. |
| POST   | `/suggestions/accept` | Token | Accept selected suggestion rows → trash (owner-only, per-node result).  |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`, `requireNonAdmin` (per-router, in that order; domain layout per recentFiles precedent)
- **Actor restriction (operator rule):** BOTH routes (GET `/` and POST `/suggestions/accept`)
  respond **403 `serverErrors.collections.forbidden`** when the requester is an
  ADMIN — the Storage dashboard is a non-admin-only personal-storage surface.
- `setupModeGuardInstance` at mount (see §2.1)

### 2.4 Request/Response Spec

**Wire casing (CODING_STYLE.md Express Patterns, binding):** responses snake_case; request
bodies camelCase (`nodeIds`). Timestamps ISO-8601 UTC strings.

- **GET /:** No query. Scope is always the requester's OWN root subtree (dashboard hygiene is
  self-storage — same scope rule as `dupFinderService.md` §1). 200:

```json
{
  "duplicates": { "group_count": 2, "duplicate_count": 5, "reclaimable_bytes": 4718592 },
  "near_duplicates": { "group_count": 1, "duplicate_count": 2 },
  "suggestions": [
    {
      "node_id": 90211,
      "kind": "exact_dup",
      "path": "/alice/photos/beach copy.jpg",
      "size_bytes": 2359296,
      "reason": { "kind": "exact_dup", "keep_node_id": 90210 }
    },
    {
      "node_id": 90321,
      "kind": "near_dup",
      "path": "/alice/docs/report v2.pdf",
      "size_bytes": 1048576,
      "reason": { "kind": "near_dup", "keep_node_id": 90320 }
    }
  ],
  "trash": {
    "item_count": 3,
    "total_bytes": 98765,
    "oldest_deleted_at": "2025-09-01T03:00:00Z",
    "retention_days": 30
  }
}
```

Field rules:

- `duplicates` is the `summarizeExactDuplicates` projection (`dupFinderService.md` §2.2) —
  **NULL `content_hash` rows never contribute** (enforced by the service).
- `near_duplicates` is the vector near-dup summary (`nearDupFinderService.md` §2.2):
  `group_count`/`duplicate_count` over connected near-dup groups at the ACTIVE embed model's
  profile `θ_dup`. Present ONLY when the vector leg is available (active embed model with a
  finite profile `θ_dup` and scoped canonical pooled rows); when the leg is unavailable the key
  is OMITTED entirely (absent section, never an error — §4.12). Hash-twin nodes (equal non-NULL
  `content_hash`) NEVER appear here — exact dups own them.
- `suggestions`: P0 computes the LLM-free rule-based suggestion variant from the SAME exact-dup pass — one row
  per duplicate-group member beyond the kept one — and the vector pass appends the same shape for
  near-dup groups (`kind: 'near_dup'`, per-member `size_bytes`, `keep_node_id` = smallest node id
  in the group, groups ordered by best cosine desc capped at the finder's `MAX_NEAR_DUP_GROUPS`;
  exact rows first, near-dup rows after). `kind: 'exact_dup'` remains the rule-variant kind of
  the hash pass; persisted `file_suggestions` kinds are out of P0 scope. `keep_node_id` =
  smallest node id in the group (deterministic keep rule; P0 has no keeper-adjudicator
  (chat role) — the user can still check the kept row's siblings).
  **Computed rows carry NO `id`/`expires_at`** — the list is recomputed per read, so there is
  nothing to dismiss and nothing to expire; the "expire with the retention job" rule
  applies to persisted `file_suggestions` rows only.
- `trash`: `item_count`/`total_bytes` = every trashed FILE row under the requester's root
  (subtree-wide, incl. children of trashed folders — trash marking marks the whole subtree),
  bytes summed from `filecache.size`; `oldest_deleted_at` drives the client countdown;
  `retention_days` = `TRASH_RETENTION_DAYS` resolved exactly like gcService Tier 3 (config
  resolver → default `30`; `0` = retention off — client renders "no automatic purge").
  Empty trash ⇒ `{ item_count: 0, total_bytes: 0, oldest_deleted_at: null, retention_days: n }`.
- No user root ⇒ `duplicates`/`suggestions` zero/empty, `trash` zeros (no error — the
  dashboard renders absent blocks per "zero/absent renders nothing").

- **POST /suggestions/accept:** Body `{ nodeIds: [ … ] }` (1–200, else 400
  `serverErrors.dashboard.emptyNodeIds`). Per node: requester must OWN the node
  (owner-root closure via `ownerNodeResolver`) — anything else (granted, foreign, unknown,
  already trashed) lands in `rejected_not_owned`; a trash-core failure lands in `skipped`.
  Accepted nodes move to TRASH (never purge). 200:

```json
{
  "trashed": [90211],
  "rejected_not_owned": [90299],
  "skipped": []
}
```

**Accept is not journaled** — `action_journal` writers are collections-only
(`store/actionJournalStore.md` §1). The accept response
carries no `undo` pointer: the trash-restore UX IS the undo path, and the client renders a
report toast (no Undo button) after accept. A command-unit undo row for
suggestion accept is out of P0 scope.

### 2.4.1 Error Codes (SERVER_ERROR_CODES style)

| HTTP | errorCode                             | Trigger                                                                                |
| ---- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| 400  | `serverErrors.dashboard.emptyNodeIds` | Missing/empty/non-array/over-cap (200) `nodeIds`.                                      |
| 403  | `serverErrors.collections.forbidden`  | ADMIN requester — operator-rule gate (`requireNonAdmin`); dashboard is non-admin-only. |

All errors follow the shared envelope (`errorCode` + optional `params`,
[shared-contracts.md](../../../shared-contracts.md)); client locale mirror mandatory.

### 2.4.2 Contract clarifications

- One GET feeds the hygiene cards and the suggestion list; the client maps it to the blocks
  in `CollectionDashboard.md` §2.3.
- Route path `/api/dashboard` (singular).
- The near-dup block rides the SAME payload: `near_duplicates` (summary, present only when the
  vector leg is available) + `near_dup` rows appended to `suggestions` — no second endpoint.
  The 30d-unopened / temp-pattern cleanup rules remain NOT in the payload; the suggestion array
  is exactly the exact-dup rows plus the near-dup rows, so "cleanup suggestions count" on the
  card equals `suggestions.length` with no client math.
- GET never errors on empty storage (zeros, not 404s) — and never errors on AI absence
  (§4.12): the near-dup block degrades to omission.

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md),
  [dupFinderService.md](../services/dupFinderService.md),
  [dashboardService.md](../services/dashboardService.md),
  [fileNodesStore.md](../store/fileNodesStore.md), [actions.md](actions.md) (feed stays there),
  `docs/features/collections-platform.md` §4.16.

### 2.6 Integration Test Scenarios

- [ ] Unauthenticated → 401 on both routes; setup-mode mount returns the guard response
- [ ] GET returns snake_case-only fields; two hashed copies + one unique + two NULL-hash
      identical rows → `group_count 1`, one suggestion row (the higher node_id, `keep_node_id`
      = lower), NULL rows appear in NO count and NO row
- [ ] Directories, trashed nodes and other users' identical content never appear
- [ ] Trash summary counts subtree-wide trashed files (incl. children of trashed folders)
      with `oldest_deleted_at` and the resolved `retention_days`
- [ ] Accept: own live nodes → `trashed`, node actually in trash afterwards; foreign/unknown/
      already-trashed ids → `rejected_not_owned`; nothing journaled (zero new
      `action_journal` rows); `{ nodeIds: [] }` / missing / >200 → 400 `dashboard.emptyNodeIds`
- [ ] Near-dup integration: with an active embed model + pooled embeddings above `θ_dup`,
      the payload gains `near_duplicates` and `near_dup` suggestion rows (hash-twin nodes never
      in near-dup rows); without one the payload has NO `near_duplicates` key and GET stays 200
