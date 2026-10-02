# dashboard routes Spec

Contract spec written with T0.10 (user dashboard `Storage` v1; `AI_FEATURE_PLAN.md` §4.16, A7 decision 2026-09-22 — P0 ships hygiene read surfaces + the suggestion accept only; no LLM/vector blocks).

## 1. Overview

| Item       | Description                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------- |
| Mount path | `/api/dashboard`                                                                                  |
| Role       | Storage-dashboard server surface: hygiene/suggestions read (one GET) + cleanup accept (one POST). |

**Ownership boundary:** this router is a thin CONSUMER — it composes existing surfaces and
adds no new state machines. Dups/suggestions delegate to `domains/ai/dupFinderService`
(hash-first, LLM-free); the trash card delegates to the `FileNodeRepository` subtree trash
read (`store/fileNodesStore.md`); the accept action delegates to the files-domain trash core
(`fileService.deleteNode`). The journal feed, collections status and grants blocks of §4.16
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
- **Actor restriction (operator rule, owner pivot 2026-10-01):** BOTH routes (GET `/` and POST
  `/suggestions/accept`) respond **403 `serverErrors.collections.forbidden`** when the requester is
  an ADMIN — the Storage dashboard is a non-admin-only personal-storage surface (§4.16).
- `setupModeGuardInstance` at mount (see §2.1)

### 2.4 Request/Response Spec

**Wire casing (CODING_STYLE.md Express Patterns, binding):** responses snake_case; request
bodies camelCase (`nodeIds`). Timestamps ISO-8601 UTC strings.

- **GET /:** No query. Scope is always the requester's OWN root subtree (§4.16 hygiene is
  self-storage — same scope rule as `dupFinderService.md` §1). 200:

```json
{
  "duplicates": { "group_count": 2, "duplicate_count": 5, "reclaimable_bytes": 4718592 },
  "suggestions": [
    {
      "node_id": 90211,
      "kind": "exact_dup",
      "path": "/alice/photos/beach copy.jpg",
      "size_bytes": 2359296,
      "reason": { "kind": "exact_dup", "keep_node_id": 90210 }
    }
  ],
  "trash": {
    "item_count": 3,
    "total_bytes": 98765,
    "oldest_deleted_at": "2026-09-01T03:00:00Z",
    "retention_days": 30
  }
}
```

Field rules:

- `duplicates` is the `summarizeExactDuplicates` projection (`dupFinderService.md` §2.2) —
  **NULL `content_hash` rows never contribute** (register (b) property, enforced by the
  service; asserted consumer-side in tests).
- `suggestions`: P0 computes the §4.17 rule variant from the SAME exact-dup pass — one row
  per duplicate-group member beyond the kept one. `kind` is `exact_dup` (the only P0 kind;
  persisted `file_suggestions` kinds ride T3.3). `keep_node_id` = smallest node id in the
  group (deterministic keep rule — **Decision:** P0 has no keeper-adjudicator (chat role),
  so stability beats cleverness; the user can still check the kept row's siblings).
  **Computed rows carry NO `id`/`expires_at`** — the list is recomputed per read, so there
  is nothing to dismiss and nothing to expire (**Decision:** the §4.16 "expire with the
  retention job" wording applies to persisted `file_suggestions` rows only, T3.3).
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

**Decision (register: P0 scope):** NO journal row — `action_journal` writers are
collections-only until P3.5/T3.3 (PLAN T0.7; `store/actionJournalStore.md` §1). The
§4.16/§4.17 command-unit undo row for suggestion accept ships with the T3.3
`file_suggestions` route spec; until then the trash-restore UX IS the undo path, and the
dashboard renders a report toast (no Undo button) after accept.

### 2.4.1 Error Codes (SERVER_ERROR_CODES style)

| HTTP | errorCode                             | Trigger                                           |
| ---- | ------------------------------------- | ------------------------------------------------- |
| 400  | `serverErrors.dashboard.emptyNodeIds` | Missing/empty/non-array/over-cap (200) `nodeIds`. |
| 403  | `serverErrors.collections.forbidden`  | ADMIN requester — operator-rule gate (`requireNonAdmin`, owner pivot 2026-10-01); dashboard is non-admin-only. |

All errors follow the shared envelope (`errorCode` + optional `params`,
[shared-contracts.md](../../../shared-contracts.md)); client locale mirror mandatory.

### 2.4.2 Decisions (micro-details the plan left open)

- **Decision:** one GET feeds hygiene cards + suggestion list (single dup pass, one
  round trip); the client maps it to the blocks in `CollectionDashboard.md` §2.3.
- **Decision:** route path `/api/dashboard` (singular, `/api/search` precedent — the
  dashboard is a personal surface, not a collection).
- **Decision:** the near-dup / 30d-unopened / temp-pattern §4.17 rules are NOT in the P0
  payload (they need vectors T1.7 or persisted rules T3.3); the suggestions array is
  exactly the exact-dup rows so "cleanup suggestions count" on the card equals
  `suggestions.length` with no client math.
- **Decision:** GET never errors on empty storage (zeros, not 404s) — the dashboard is a
  pull-overview; missing user root is a legitimate zero state.

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md),
  [dupFinderService.md](../services/dupFinderService.md),
  [dashboardService.md](../services/dashboardService.md),
  [fileNodesStore.md](../store/fileNodesStore.md), [actions.md](actions.md) (feed stays there),
  `docs/features/collections-platform.md` §4.16, `AI_FEATURE_PLAN.md` §4.16/§4.17.

### 2.6 Integration Test Scenarios

- [ ] Unauthenticated → 401 on both routes; setup-mode mount returns the guard response
- [ ] GET returns snake_case-only fields; two hashed copies + one unique + two NULL-hash
      identical rows → `group_count 1`, one suggestion row (the higher node_id, `keep_node_id`
      = lower), NULL rows appear in NO count and NO row (register (b) consumer-side)
- [ ] Directories, trashed nodes and other users' identical content never appear
- [ ] Trash summary counts subtree-wide trashed files (incl. children of trashed folders)
      with `oldest_deleted_at` and the resolved `retention_days`
- [ ] Accept: own live nodes → `trashed`, node actually in trash afterwards; foreign/unknown/
      already-trashed ids → `rejected_not_owned`; nothing journaled (zero new
      `action_journal` rows); `{ nodeIds: [] }` / missing / >200 → 400 `dashboard.emptyNodeIds`
