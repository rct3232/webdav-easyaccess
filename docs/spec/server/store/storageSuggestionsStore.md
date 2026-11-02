# storageSuggestionsStore Spec

Store surface for the PERSISTED cleanup/duplicate suggestions of
`docs/features/storage-management.md` — the `storage_suggestions` table (001 DDL,
columns binding). The consumer contract lives in
[routes/storage.md](../routes/storage.md) and
[storageService.md](../services/storageService.md); this spec owns the persistence
shape only.

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| Role         | Persisted per-user suggestion rows produced by the storage generator pass: ids for dismissal, `expires_at` for the retention job, state transitions (`pending → accepted                                                                                                                                                          | dismissed | expired`, `accepted → pending`on undo) and the JSONB`reason` payload the checklist renders. |
| Boundaries   | No decision logic here — candidates come from `dupFinderService` (hash-first exact dups), `nearDupFinderService` (vector near-dups at the profile `θ_dup`) and the rule-variant matchers (`storageService.md` §2.5). The repository is the ONLY place with SQL over `storage_suggestions`; the facade contains no dialect branch. |
| Design owner | `docs/features/storage-management.md` (proposal lifecycle and rendering surface).                                                                                                                                                                                                                                                 |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Facade:** `server/store/storageSuggestionsStore.js` (thin dialect dispatch on
  `storage.getExecutor()`, no SQL)
- **Interface + factory:** `server/store/repositories/StorageSuggestionsRepository.js`
- **Shared row mapper:** `server/store/repositories/storageSuggestionsShared.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/StorageSuggestionsRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/StorageSuggestionsRepository.conformance.test.js`
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql` — row:
  `storage_suggestions(id BIGSERIAL PK, user_id → users ON DELETE CASCADE, node_id → file_nodes
ON DELETE CASCADE, kind TEXT, reason JSONB, state TEXT DEFAULT 'pending', created_at,
expires_at)`; index `storage_suggestions_user_state_idx (user_id, state)`. NO DDL change is
  permitted (§6 DDL policy); the table ships no CHECK constraints, so the enum discipline is
  repository-side (this spec §2.2).

### 2.2 Domain contract

Domain row (repository boundary; SQL snake_case → camel — `repository-contract.md` rule 2):

```
{ id: number,
  userId: number,
  nodeId: number,
  kind: 'exact_dup' | 'near_dup' | 'temp_pattern' | 'stale_screenshot' | 'old_installer',
  reason: Object,                       // parsed JSONB — see below
  state: 'pending' | 'accepted' | 'dismissed' | 'expired',
  createdAt: string,                    // ISO 8601
  expiresAt: string | null }            // ISO 8601; null = never expires
```

- **`kind`** values are the generator vocabulary (`storageService.md` §2.5): the two dup
  kinds plus the three LLM-free rule kinds. The DB imposes no CHECK; the repository is the
  only writer and the route serializes the value verbatim.
- **`state` machine** (the repository enforces every transition in its WHERE clause):
  `pending → accepted` (accept command, journal TX), `pending → dismissed` (dismiss),
  `pending → expired` (retention pass + generator reconcile), `accepted → pending`
  (undo, journal TX — the suggestion resurfaces after undo; ALSO the generator's re-pend:
  an accepted row whose node is a live current candidate again — restored through the trash
  UI without the journal undo — flips back to `pending` in the materialize pass).
  `dismissed` and `expired` rows are terminal (audit trail); dismissed kinds are NEVER
  re-inserted for the same node (generator dedupe §2.4).
- **`reason` JSONB keys are snake_case verbatim** — the wire serializes them unchanged
  (`routes/storage.md` §2.4): `{ kind, keep_node_id?, score?, keep?, pattern?, age_days? }`.
  `keep_node_id` on dup rows records the group keeper (exact: smallest node id; near-dup:
  highest keeper composite, tie ⇒ smallest node id — `storageService.md` §2.5.1);
  `keep` is the near-dup keeper-exposure block (additive on new/re-materialized rows only);
  `pattern`/`age_days` on rule rows carry the matched family and file age.

### 2.3 Main methods (facade = repository surface, executor-bound unless `Tx`)

| Method                                          | Signature                                    | Contract                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insert`                                        | `(row) => Promise<{ id }>`                   | `row = { userId, nodeId, kind, reason, expiresAt? }`; `state='pending'`, `created_at = now`, `expires_at` bound from the caller's computed ISO value or `NULL` (retention `0` = off). FK violations map through `mapDatabaseError`.                        |
| `listPending(userId)`                           | `=> Promise<domainRow[]>`                    | All `state='pending'` rows of the user, `ORDER BY id`. No expiry math here — the consumer applies the `expiresAt` filter and the kind-rank listing order (`routes/storage.md` §2.4, `storageService.md` §2.2).                                             |
| `listKeys(userId)`                              | `=> Promise<Array<{ nodeId, kind, state }>>` | Full per-user history projection for the generator's dedupe/reconcile pass (bounded read, personal scale).                                                                                                                                                 |
| `dismiss(userId, id)`                           | `=> Promise<{ changes }>`                    | `UPDATE … SET state='dismissed' WHERE id=? AND user_id=? AND state='pending'` — cross-user and non-pending targets report `changes: 0` (the route maps to 404).                                                                                            |
| `listIdsByNodesTx(tx, userId, nodeIds, state)`  | `=> Promise<Array<{ id, nodeId, kind }>>`    | Caller-owned TX (or the executor itself — facade-dispatch precedent): the row ids for the accept/undo node set under the expected `state` (fingerprint pre-read; `kind` included for candidate-set matching).                                              |
| `flipStatesTx(tx, { ids, fromState, toState })` | `=> Promise<{ changes }>`                    | Caller-owned TX (or the executor): state flip restricted to the id set AND the expected `fromState` (rows flipped by a concurrent command simply do not match — the count reports what actually moved).                                                    |
| `updateReason(userId, id, reason)`              | `=> Promise<{ changes }>`                    | Reason-only refresh of a PENDING row: `UPDATE … SET reason=? WHERE id=? AND user_id=? AND state='pending'`. ID, `created_at`, `expires_at` and state are untouched; 0 = unknown/foreign/non-pending (the generator only refreshes rows it already listed). |
| `expireStale({ now, limit })`                   | `=> Promise<{ changes, ids }>`               | Bounded retention pass: select up to `limit` `pending` ids with `expires_at < now` (NULL never expires), flip them to `expired`. `ids` feeds the run report.                                                                                               |

`Tx` methods take the caller-owned transaction (the `commitChange`/`undoAction` TX of
[actionJournalStore.md](actionJournalStore.md) §2.3/§2.4) — same shape as
`ActionJournalRepository`.

### 2.4 Repository rules

1. **No SQL outside the twins** (`repository-contract.md` §2.2 rule 3); the facade maps nothing but
   the dialect dispatch (no `getBackend()` branch).
2. **Dedupe is application-side**: the table has no unique constraint beyond the PK and the
   DDL chain may not be ALTERed, so the generator runs its read-dedupe-insert under
   `lockManager.acquireLock('storage-suggestions-generate:' + userId)` (`waitMs: 0`) — a
   concurrent pass skips generation and reads existing rows (degrade, never double-insert);
   the single-replica sqlite TX and the lock cover multi-replica PG.
3. **Timestamps** are bound as ISO strings computed by the caller (the generator owns the
   clock seam); `created_at` uses the DB default (`CURRENT_TIMESTAMP`/`NOW()` — journal
   precedent) only in the no-argument path. The twins return both columns as ISO strings.
4. **JSONB**: PG native object round-trip; sqlite TEXT `JSON.stringify`/`parseJsonColumn`
   (shared-mapper pattern of `actionJournalShared.js`).
5. Reads missing → `null`/`[]`; writes never upsert (insert-only + state flips). Trashing a
   node is a soft delete (`deleted_at`): rows SURVIVE it and the generator reconciles
   rows whose nodes left the candidate/live set to `expired` (`storageService.md` §2.5).
   Hard node deletes cascade rows away; the accept command row in `action_journal` carries
   the audit regardless.

### 2.5 Dependencies

- `storage.getExecutor()` + `StorageSuggestionsRepository` (+ twins)
- Consumer: `domains/storage` service/routes; the undo flip runs inside the
  `action_journal` TX (`domains/storage/suggestionUndoService.js`,
  `storageService.md` §2.6)

### 2.6 Verification Scenarios

- [ ] insert returns the generated id; reason round-trips as a parsed object on both dialects
- [ ] `updateReason` rewrites the JSONB of a pending row only (id/created_at/expires_at/state
      stable); non-pending/foreign ids report `changes: 0`
- [ ] `listPending` excludes `accepted`/`dismissed`/`expired` rows and orders by id
- [ ] `dismiss` is pending-only and user-scoped (other user's id → `changes: 0`)
- [ ] `listIdsByNodesTx` + `flipStatesTx` inside one TX: accept flips exactly the pending
      ids of the node set; a second flip attempt with `fromState='pending'` changes 0
- [ ] undo flip `accepted → pending` restores listing eligibility for exactly the command's ids
- [ ] `expireStale` flips only `pending` rows with `expires_at < now` (NULL exempt), honors
      `limit`, returns ids; second run is a no-op (idempotent)
- [ ] FK enforcement: unknown `node_id`/`user_id` rejects through `mapDatabaseError`
- [ ] hard node delete cascades the rows away; trashing does NOT (soft delete)
- [ ] L2 conformance on sqlite AND real PostgreSQL (`test:pg:adapters`): JSONB-vs-TEXT
      payload parity, ISO timestamp parity, `changes` counts, TX-bound flip visibility
- [ ] Grep: no SQL outside the twins; facade has no `getBackend()` branch
