# dashboard routes Spec

Contract spec for the user dashboard `Storage`: the hygiene read surfaces plus the persisted
cleanup-suggestion lifecycle (accept → journaled command, dismiss, expiry).

## 1. Overview

| Item       | Description                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/dashboard`                                                                                                                                                     |
| Role       | Storage-dashboard server surface: hygiene/suggestions read (one GET, persists pending rows as part of the read) + cleanup accept (POST) + suggestion dismiss (POST). |

**Ownership boundary:** this router is a thin CONSUMER — it composes existing surfaces and
adds no new state machines beyond the `file_suggestions` row lifecycle. Dups/suggestions
delegate to `domains/ai/dupFinderService` (hash-first, LLM-free), to
`domains/ai/nearDupFinderService` (the §4.17 vector variant — `nearDupFinderService.md`) and
to the persisted-row generator (`dashboardService.md` §2.5, `store/fileSuggestionsStore.md`);
the trash card delegates to the `FileNodeRepository` subtree trash read
(`store/fileNodesStore.md`); the accept action delegates to the files-domain trash core
(`fileService.deleteNode`) and journals its command via `actionJournalStore`; the dismiss
action delegates to `fileSuggestionsStore`. The journal feed, collections status and grants
blocks ride the EXISTING `/api/actions`, `/api/collections`, `/api/collections/:id/grants`
mounts — nothing here duplicates them.

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

| Method | Path                   | Auth  | Description                                                                                                                      |
| ------ | ---------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`                    | Token | One-shot dashboard read: dup summary + persisted suggestion rows + trash summary; materializes pending rows as part of the read. |
| POST   | `/suggestions/accept`  | Token | Accept selected rows → trash as ONE journaled command (owner-only, per-node result, undo pointer).                               |
| POST   | `/suggestions/dismiss` | Token | Dismiss one persisted suggestion row (`pending → dismissed`).                                                                    |

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
      "id": 3012,
      "node_id": 90211,
      "kind": "exact_dup",
      "path": "/alice/photos/beach copy.jpg",
      "size_bytes": 2359296,
      "reason": { "kind": "exact_dup", "keep_node_id": 90210 },
      "created_at": "2025-10-20T03:00:00Z",
      "expires_at": "2025-11-19T03:00:00Z"
    },
    {
      "id": 3015,
      "node_id": 90321,
      "kind": "near_dup",
      "path": "/alice/docs/report v2.pdf",
      "size_bytes": 1048576,
      "reason": { "kind": "near_dup", "keep_node_id": 90320, "score": 0.962 },
      "created_at": "2025-10-20T03:00:00Z",
      "expires_at": "2025-11-19T03:00:00Z"
    },
    {
      "id": 3019,
      "node_id": 90410,
      "kind": "stale_screenshot",
      "path": "/alice/photos/Screenshot_2026-09-01_12-30.png",
      "size_bytes": 358400,
      "reason": { "kind": "stale_screenshot", "pattern": "screenshot", "age_days": 49 },
      "created_at": "2025-10-20T03:00:00Z",
      "expires_at": "2025-11-19T03:00:00Z"
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
- `suggestions`: PERSISTED `file_suggestions` rows (`store/fileSuggestionsStore.md`) — the
  read materializes pending rows first (`dashboardService.md` §2.5: the rule variant from the
  hash pass + filename/temp/screenshot/installer patterns, the vector variant from the near-dup
  pass at the ACTIVE profile `θ_dup` with hash-twin members excluded and the short-document
  cosine exception), then lists the user's `pending`, unexpired rows. Row shape: `id`,
  `node_id`, `kind`, `path`, `size_bytes`, `reason` (the stored JSONB, snake_case verbatim),
  `created_at`, `expires_at`. `kind: 'exact_dup'`/`'near_dup'` carry `keep_node_id` = smallest
  node id in the group (deterministic keep rule); the keeper is never listed as a row —
  only group members beyond it persist. Rule kinds (`'temp_pattern'`, `'stale_screenshot'`,
  `'old_installer'`) suggest the row's own file and carry `reason.pattern`/`reason.age_days`.
  Rows sort by KIND RANK — exact rows first, near-dup rows after, rule-pattern rows
  last — insertion order (`id`) within the rank (stable under append-only re-reads).
  The vector generator leg runs ONLY when
  `nearDupFinderService` is available (active embed model with a finite profile `θ_dup`);
  an embed-unconfigured deployment lists rule/exact rows and nothing else
  (§4.12 absent-not-disabled). `expires_at` is `created_at + AI_SUGGESTION_RETENTION_DAYS`
  (`0` ⇒ `null` = never expires); a row past `expires_at` is absent from the list (server-side
  filter) — the client performs no expiry math.
- `duplicates`/`near_duplicates`/`trash` summaries remain COMPUTED hygiene reads (the card
  counts describe duplicate reality, the `suggestions` list describes actionable persisted
  rows — the two may differ when rows were dismissed); recomputation is idempotent and
  read-side.
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
  "skipped": [],
  "undo": { "action_id": 1204 }
}
```

**Accept is one journaled command** (docs/features/collections-platform.md §4.11/§4.17): the
trashed nodes and the `pending → accepted` flips of their suggestion rows land in ONE
`action_journal` command row (`domain='file'`,
`subject='file:suggestion-accept:<userId>:<timestamp>'`, `action='cleanup-accept'`,
`actor=<userId>`; payload `{ inverse: { op: 'restore-from-trash' }, items: [ { nodeId,
deletedAt, suggestionIds } ] }` — checked count = inverse count, per-item fingerprint = the
captured `deletedAt`). The response carries `undo: { action_id }` (the toast contract,
`store/actionJournalStore.md` §2.3); undo executes through the generic
`POST /api/actions/:id/undo` and restores each still-trashed, fingerprint-matching node via
the trash core (skips are per item; mixed results allowed). See `dashboardService.md` §2.6
for the undo executor contract. The row flip covers exactly the `pending` rows whose node was
trashed; a trashed node without a pending row contributes an item with an empty
`suggestionIds` list (the file undo still applies).

- **POST /suggestions/dismiss:** Body `{ suggestionId }` (one persisted row). 200 on the
  `pending → dismissed` flip of the requester's own row; unknown id, another user's row or a
  non-pending target → 404 `serverErrors.dashboard.suggestionNotFound` (single code — no
  existence leak); missing/non-numeric/≤0 `suggestionId` → 400
  `serverErrors.dashboard.invalidSuggestionId`. Dismissed rows leave the list; the kind is
  never re-inserted for the same node while a non-expired row of it exists
  (`store/fileSuggestionsStore.md` §2.2). No toast, no journal row (self-reversing UI
  preference, not a file mutation). 200:

```json
{ "id": 90211, "state": "dismissed" }
```

### 2.4.1 Error Codes (SERVER_ERROR_CODES style)

| HTTP | errorCode                                    | Trigger                                                                                |
| ---- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| 400  | `serverErrors.dashboard.emptyNodeIds`        | Missing/empty/non-array/over-cap (200) `nodeIds`.                                      |
| 400  | `serverErrors.dashboard.invalidSuggestionId` | Missing/non-numeric/≤0 `suggestionId` (dismiss).                                       |
| 404  | `serverErrors.dashboard.suggestionNotFound`  | Dismiss target unknown, not the requester's, or not `pending`.                         |
| 403  | `serverErrors.collections.forbidden`         | ADMIN requester — operator-rule gate (`requireNonAdmin`); dashboard is non-admin-only. |

All errors follow the shared envelope (`errorCode` + optional `params`,
[shared-contracts.md](../../../shared-contracts.md)); client locale mirror mandatory.

### 2.4.2 Contract clarifications

- One GET feeds the hygiene cards and the suggestion list; the client maps it to the blocks
  in `CollectionDashboard.md` §2.3.
- Route path `/api/dashboard` (singular).
- The near-dup block rides the SAME payload: `near_duplicates` (summary, present only when the
  vector leg is available) + `near_dup` rows appended to `suggestions` — no second endpoint.
  The suggestion array is the persisted pending set (exact rows, near-dup rows, rule-pattern
  rows), so "cleanup suggestions count" on the card equals `suggestions.length` with no client
  math; the card summaries (`duplicates`/`near_duplicates`) stay computed.
- GET never errors on empty storage (zeros, not 404s) — and never errors on AI absence
  (§4.12): the near-dup block degrades to omission and the vector generator leg contributes
  no rows.
- Accept and its undo ride the command-journal contract (`store/actionJournalStore.md`
  §2.2/§2.4): `domain='file'`, subject `file:suggestion-accept:<userId>:<timestamp>`
  (multi-node command rows carry the accept-command subject format; single-node file subjects
  stay `file:<nodeId>` for the rename family), `action='cleanup-accept'`. Undo executes via
  the generic `POST /api/actions/:id/undo` (actor visibility), never through a dashboard
  route.
- The 30-days-unopened + low-score keeper adjudication is NOT in the suggestion payload;
  near-dup keepers follow the deterministic smallest-node-id rule (§4.17 keeper selection is
  a chat-side surface).

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md),
  [dupFinderService.md](../services/dupFinderService.md),
  [dashboardService.md](../services/dashboardService.md),
  [fileSuggestionsStore.md](../store/fileSuggestionsStore.md),
  [actionJournalStore.md](../store/actionJournalStore.md),
  [fileNodesStore.md](../store/fileNodesStore.md), [actions.md](actions.md) (feed stays there),
  `docs/features/collections-platform.md` §4.16/§4.17.

### 2.6 Integration Test Scenarios

- [ ] Unauthenticated → 401 on all three routes; setup-mode mount returns the guard response
- [ ] GET returns snake_case-only fields; two hashed copies + one unique + two NULL-hash
      identical rows → `group_count 1`, one suggestion row (the higher node_id, `keep_node_id`
      = lower), NULL rows appear in NO count and NO row; every listed row carries `id`,
      `created_at` and `expires_at` (or `expires_at: null` under retention `0`)
- [ ] The GET is idempotent: a second read materializes zero new rows and returns deep-equal
      suggestions (pending rows + computed summaries) on unchanged data
- [ ] Directories, trashed nodes and other users' identical content never appear
- [ ] Trash summary counts subtree-wide trashed files (incl. children of trashed folders)
      with `oldest_deleted_at` and the resolved `retention_days`
- [ ] Accept: own live nodes → `trashed`, node actually in trash afterwards, the matching
      pending rows flip to `accepted` and are absent from the next GET; foreign/unknown/
      already-trashed ids → `rejected_not_owned`; response carries `undo.action_id`; ONE
      `action_journal` command row (`domain='file'`, item count = `trashed.length`);
      `{ nodeIds: [] }` / missing / >200 → 400 `dashboard.emptyNodeIds` with ZERO new
      journal rows
- [ ] Undo (via `POST /api/actions/:id/undo`): trashed nodes return to live, their rows flip
      back to `pending` and re-list; a node already restored by hand is per-item SKIPPED
      (mixed-result undo), the command row still flips to `undone`
- [ ] Dismiss: own pending row → `{ id, state: 'dismissed' }`, row absent from the next GET
      and never re-inserted for the same node+kind; foreign/unknown/non-pending → 404
      `dashboard.suggestionNotFound`; `{ suggestionId: 0 }` / missing → 400
      `dashboard.invalidSuggestionId`; admin requester → 403 on the new route as well
- [ ] Rule variants: temp-pattern / stale-screenshot / old-installer files list one row each
      (`reason.pattern` + `age_days`), fresh or non-matching files none; every rule kind ships
      with NO embed model configured
- [ ] Near-dup integration: with an active embed model + pooled embeddings above `θ_dup`,
      the payload gains `near_duplicates` and `near_dup` rows (hash-twin nodes never
      in near-dup rows; ≤1-sentence enriched files never list a `near_dup` row); without an
      active embed model the payload has NO `near_duplicates` key, no `near_dup` row is
      materialized and GET stays 200 (§4.12 absent-not-disabled)
