# actionJournalStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | The generic undo journal (`action_journal`) — common infrastructure, NOT ai-prefixed. Owns `commitChange` (the ONLY journaled write path: change + journal row in one TX under `lockManager`), the undo executor, the 30-day feed, and retention GC.                                                                                                                                                                         |
| Design owner | `docs/features/collections-platform.md` §4.11 (rules, subjects, retention, toast boundaries); the undo journal replaces proposal-inboxes — system acts silently, every act is journaled with an inverse, and the UI safety valve is undo, not pre-approval.                                                                                                                                                                  |
| Consumers    | collections domain (all silent/user acts), the batch worker (move/copy command rows — `services/batchOperationService.md` §5.4–§5.5), dashboard cleanup-suggestion accepts (`file` domain — `routes/dashboard.md` §2.4.2), and the admin AI governance surface (`settings` domain — curated config keys + the re-embed launcher, `routes/admin.md` §2.2.7); `sharing` and `permissions` remain enum-reserved with no writer. |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/store/actionJournalStore.js` (facade, no SQL)
- **Interface + factory:** `server/store/repositories/ActionJournalRepository.js`
- **Implementations:** `server/store/repositories/{sqlite,postgres}/ActionJournalRepository.{sqlite,postgres}.js`
- **Conformance (L2):** `server/store/repositories/__tests__/ActionJournalRepository.conformance.test.js`
- **Facade test:** `server/store/__tests__/actionJournalStore.test.js` (infra, not a domain store)
- **DDL source of truth:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql` — DDL row:
  `action_journal(id, domain, subject, subject_label, actor, action, payload JSONB,
chain_seq, status, created_at, undone_at, expires_at)`; `UNIQUE(domain,subject,chain_seq)`.

### 2.2 Schema contract

- `domain` TEXT + CHECK enum: `collection | batch | settings | permissions | file | sharing`.
- `subject` opaque TEXT, **no FK** — the journal intentionally outlives its subject for
  audit / restore-after-undo reasoning. Per-domain subject formats:

| Domain        | Subject format                                                   | Example row produced by                                                                                                                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collection`  | `collection:<id>`                                                | collectionsStore journaled mutators (auto-pin touch side effects ride these rows — no separate journal row)                                                                                                                                                                                                                                 |
| `batch`       | `batch:<jobId>`                                                  | batch worker `_processBulkJob` — ONE command row per move/copy job with succeeded items, item-level inverse list in the payload (`services/batchOperationService.md` §5.4); delete batches ride the trash restore surface instead                                                                                                           |
| `settings`    | `settings:<KEY>`; launcher uses `settings:ai-reembed`            | `PUT /api/admin/config` for the curated non-secret AI governance keys — inverse `{ op: 'set-setting', key, value }` restores the previous DB value (`null` ⇒ unset); the re-embed launcher adds one `action='ai-reembed'` row whose inverse `{ op: 'cancel-ai-jobs', jobIds }` cancels still-pending jobs. Secret keys are never journaled. |
| `file`        | `file:<nodeId>` or `file:suggestion-accept:<userId>:<timestamp>` | dashboard cleanup-suggestion accept command-unit rows (`routes/dashboard.md` §2.4.2); rename undo (single-node subject) ships with the rename surface — until then no writer produces it                                                                                                                                                    |
| `sharing`     | `sharing:<nodeId>`                                               | share-link create/cancel                                                                                                                                                                                                                                                                                                                    |
| `permissions` | (reserved)                                                       | enum reserved, no writer; grant-undo=revoke allowed silently, revoke-undo=grant is explicit-only (exposure expansion is always explicit)                                                                                                                                                                                                    |

- `status` TEXT + CHECK: `applied | undone | expired`.
- `payload` JSONB: `{ inverse, items?, atomic?, fingerprint?, note? }` — `inverse` is the
  domain-defined operation descriptor the registered undo executor applies; `items` is the
  per-item `[{..., fingerprint }]` list for command rows; `atomic:true` marks a
  composite command whose item list must be applied all-or-nothing (the properties
  save family); `fingerprint` guards staleness.
  Audit survives expiry because `domain/subject/subject_label/action/actor/chain_seq` stay.
- `chain_seq`: monotonic per `(domain, subject)` integer, assigned `COALESCE(MAX,0)+1`
  inside the commit TX. `actor` TEXT (user id; the literal `'system'` for silent evolution).
- `expires_at = created_at + JOURNAL_RETENTION_DAYS` (module constant, default 30 days).
  The 24h toast window is a UI/service rule, not stored state.

### 2.3 Main Methods — commit

| Method         | Signature                                                                         | Description                                                                                                                                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commitChange` | (domain, subject, meta, inverse, mutation) => Promise\<{ id, chainSeq, result }\> | THE only write path. `meta = { actor, action, subjectLabel? }`; `inverse` → the payload's `inverse` descriptor (callers pass `{ inverse: … , items?… }` for command rows); `mutation(tx)` runs the domain change on a tx-bound repository and its return value comes back as `result` (routes surface `{ ...result, undo: { actionId: id } }`). |

`commitChange` mechanics (in order):

1. `lockManager.acquireLock('journal:' + domain + ':' + subject)` — serializes `chain_seq`
   assignment per subject across processes. `subject` may be a **resolver**
   `((mutationResult) => string)` for create-flows whose subject id only exists after the
   mutation: the lock is then taken on the constant `journal:<domain>:new` (creates cannot
   contend on a not-yet-existing subject) and the resolver is evaluated inside the TX
   before the chain read; a fresh subject's chain starts at 1.
2. `executor.transaction(tx)`: `await mutation(tx)` → read `MAX(chain_seq)` for
   `(domain,subject)` → INSERT the journal row (`status='applied'`, `expires_at`) —
   ONE TX; any throw rolls BOTH back. `chain_seq = MAX(chain_seq)+1` over ALL rows of the
   subject (undone rows keep consuming their slot — the chain never reuses numbers).
   Command rows whose item-level work already committed under its own transaction boundaries
   (the batch worker) pass a no-op `mutation`; the payload's `items` list is the inverse
   record.
3. Release lock; return `{ id, chainSeq, result }`. Routes surface `undo: { actionId: id }`
   in the mutation response (toast contract).

### 2.4 Main Methods — undo

| Method                 | Signature                                                            | Description                                                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getAction`            | (actionId) => Promise\<row \| null\>                                 | Domain row `{ id, domain, subject, subjectLabel, actor, action, payload, chainSeq, status, createdAt, undoneAt, expiresAt }`.                                                                                                                                                     |
| `countLaterChanges`    | (domain, subject, chainSeq) => Promise\<number\>                     | Count of `applied` rows on the subject with `chain_seq > given` — the cascade-confirm dialog's "N later changes will also be undone"; also the feed's per-subject `is_tip` source (`routes/actions.md` §2.4: the flag is computed over every actor's chain, not the feed subset). |
| `undoAction`           | (actionId, { cascade }?) => Promise\<UndoResult \| CascadeRequired\> | Tip-undo = free. Non-tip without `cascade:true` → returns `{ code: 'journal_cascade_required', laterCount }` (service maps to the confirm dialog).                                                                                                                                |
| `registerUndoExecutor` | (domain, handler) => void                                            | Handler: `async ({ row, tx }) => ItemOutcome[]` — applies `payload.inverse` (or the per-item list) via the domain's own commitTX-style write, fingerprint-guarded per item.                                                                                                       |
| `purgeSubject`         | (domain, subject) => Promise\<{ changes }\>                          | The ONLY sanctioned DELETE of journal rows — called by permanent-delete flows (permanent delete-from-archive is unrecoverable: collection purge wipes its subject's rows).                                                                                                        |

`undoAction` mechanics: under the same subject lock, in ONE TX —

1. Load row(s) (`FOR UPDATE` on PG; serialized on sqlite). Guards, each a **typed result**
   (the executor TX wrapper maps thrown values through `mapDatabaseError`, so guard
   failures cannot be thrown literals — they return the code object the caller maps to the
   confirm dialog / error toast): `{ code: 'journal_not_found' }`,
   `{ code: 'journal_already_undone' }`, `{ code: 'journal_expired' }` (payload NULLed,
   undo impossible after expiry).
2. Tip check: target must have `MAX(chain_seq)` among `applied` rows of the subject; else
   `journal_cascade_required` unless `cascade:true`, in which case rows `tip..target` are
   undone newest-first (LIFO) as one operation.
3. Dispatch to the domain's registered executor. Per-item fingerprint mismatch ⇒ that item
   is SKIPPED, not failed (mixed results allowed: `11 undone, 1 skipped (state changed since)`).
   An ATOMIC command row (`payload.atomic === true`) is the exception: any non-applied
   item throws the fingerprint refusal, aborting the whole undo TX so every earlier
   item unwinds and the row stays `applied`; a fully applied item list returns its
   outcomes normally.
   Registered executors: `collection` → `domains/actions/service.js`; `batch` →
   `domains/files/services/batchOperationService.js` §5.5; `file` →
   `domains/dashboard/suggestionUndoService.js` §2.6 (cleanup-accept
   `restore-from-trash`; both register at module load); `settings` →
   `domains/admin/services/settingsJournalService.js` (`set-setting` restores/unset the
   previous value and invalidates the config-resolver cache; `cancel-ai-jobs` calls the
   tx-bound `cancelPendingTx` and reports per-id applied/skipped). A domain row whose
   executor is missing throws — the undo aborts and the row stays `applied`.
4. Flip each row `status='undone'`, `undone_at=now()`. The undo itself is NOT journaled
   (no undo-of-undo; status flip is the record).

`UndoResult`: `{ undone: number, skipped: [{ index?, reason: 'changed' }], undoneIds: number[] }` —
`undoneIds` lists the journal row ids flipped by THIS undo pass
(target first, then cascade rows tip..target): `GET /api/actions`-adjacent undo responses
surface the extra ids as `cascade_undone` (`routes/actions.md` §2.4) without a second read.
Undo NEVER restores: spent LLM cost, already-received external exposure, file content
(trash/versions own that world).

### 2.5 Main Methods — feed & retention

| Method              | Signature                                          | Description                                                                                                                                                                              |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listFeed`          | ({ actor, domain?, limit? }?) => Promise\<row[]\>  | `GET /api/actions` 30-day dashboard feed: `status != 'expired' OR created_at >= now-30d` rows, `created_at DESC`; payload may be NULL (expired) — UI renders from the surviving columns. |
| `listBySubject`     | (domain, subject, { limit? }?) => Promise\<row[]\> | Chain view (newest first) for cascade listings.                                                                                                                                          |
| `expireJournalRows` | (now?) => Promise\<{ changes }\>                   | GC pass (maintenanceScheduler): `applied` rows past `expires_at` → `payload=NULL, status='expired'`. Rows SURVIVE; storage does not grow. `undone` rows keep their payload.              |

`status='expired'` applies ONLY to never-undone rows — a row is terminal once `undone`.

### 2.6 Error contracts

- Reads: missing → `null` / `[]`.
- `commitChange` propagates whatever `mutation(tx)` throws (the TX unwinds, no row lands);
  lock timeout surfaces as `LOCK_TIMEOUT` (lockManager contract).
- Undo guard failures are typed results (`{ code: 'journal_not_found' |
'journal_already_undone' | 'journal_expired' }` — the service maps them to
  `serverErrors.journal.*`); a handler THROW (not a fingerprint skip) aborts the whole
  cascade TX — partial failure is only expressible via item outcomes.
- No FKs exist, so subject deletion never errors here; `purgeSubject` is explicit.

### 2.7 Dependencies

- `storage.getExecutor()` + `ActionJournalRepository` (+ twins)
- `infrastructure/lockManager` (subject serialization)
- GC caller: `infrastructure/maintenanceScheduler`

### 2.8 Verification Scenarios

- [ ] commit + mutation atomicity: forced journal-insert failure rolls the domain change back; throwing mutation leaves zero rows (both dialects)
- [ ] `chain_seq` monotonic per subject and gapless under sequential commits; concurrent commits to the SAME subject serialize via the lock (no duplicate `(domain,subject,chain_seq)` — L2 asserts the UNIQUE)
- [ ] two different subjects commit concurrently without blocking each other's chain
- [ ] tip undo: `applied → undone`, `undone_at` set, inverse applied exactly once; `getAction` status observable
- [ ] non-tip undo without cascade → `journal_cascade_required` with correct `laterCount`; with `cascade:true` → rows undone LIFO from tip down to target, one `undone` flip each
- [ ] fingerprint mismatch → item skipped (`reason:'changed'`), other items still undone, TX commits
- [ ] atomic command row (`payload.atomic:true`): all items apply → single undo pass;
      one mismatched item → the whole undo refuses (fingerprintMismatch), no item
      stays applied, and the row remains `applied`
- [ ] expired row (`payload=NULL`) → `undoAction` → `journal_expired`
- [ ] rows outlive their subject: delete the collection row directly, `getAction` still returns the journal row (NO FK)
- [ ] `purgeSubject` removes all rows of `(collection, 'collection:<id>')` and nothing else
- [ ] `expireJournalRows`: applied+past-expiry → `payload NULL, status='expired'`, row count unchanged; undone rows keep payload; `listFeed` still lists the expired row's `action`/`subject_label`
- [ ] `commitChange` returns `{ id, chainSeq }` matching the stored row (toast `undo.actionId` contract)
- [ ] L2 conformance (real sqlite + real PostgreSQL, `test:ci:pg:adapters`): `UNIQUE(domain,subject,chain_seq)`, JSONB-vs-TEXT payload round-trip parity, `MAX(chain_seq)` read-your-writes inside the TX, timestamp column parity (`created_at/undone_at/expires_at` ISO strings), `FOR UPDATE` (PG) vs serialized (sqlite) undo-guard behavior
- [ ] Grep: no SQL outside the repository twins; facade has no `getBackend()` branch
