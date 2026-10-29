# actions routes Spec

Target-contract spec.

## 1. Overview

| Item       | Description                                                                      |
| ---------- | -------------------------------------------------------------------------------- |
| Mount path | `/api/actions`                                                                   |
| Role       | Undo journal read feed (30d) + undo execution (tip / cascade-confirm semantics). |

**Ownership boundary:** the journal is common infrastructure (NOT ai-prefixed). Writers go
exclusively through `commitChange(mutation, inverse)` — this router only reads and
undoes; it never accepts new rows. Undo flow referenced by every collection mutation's
`undo: { action_id }` pointer lives here ([collections.md](collections.md)).

Undo does NOT restore: spent LLM cost, already-received external exposure (grant-snapshot
undo restores future state only), or file content (trash/versions own that world).
Permanent delete (`archived→permanent delete`, empty-trash) has NO undo row by contract
(trash-parity: permanent delete is unrecoverable) — such ids return 404 from this feed.

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/actions/routes.js`
- **Service:** `server/domains/actions/service.js` (feed scoping; `undoAction(actionId,
{ confirmCascade })` executes inverses fingerprint-guarded inside one TX via
  `lockManager`, reusing the journal writer's discipline)
- **Test file:** `server/domains/actions/__tests__/actions.test.js`

**Mount:** `server/index.js` registers the router **after** the app-level migrationGate
and with `setupModeGuardInstance` (coverage invariant, ARCHITECTURE §1.3):
`app.use('/api/actions', setupModeGuardInstance, require('./domains/actions/routes'))`.

### 2.2 Route List (sync with api.md)

| Method | Path        | Auth  | Description                                          |
| ------ | ----------- | ----- | ---------------------------------------------------- |
| GET    | `/`         | Token | 30-day feed, newest first, optional `domain` filter. |
| POST   | `/:id/undo` | Token | Undo one journal row (tip free / cascade-confirm).   |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser` (per-router)
- **No admin gate on this router**: every collections-mutating
  endpoint is server-gated against ADMIN requesters (operator rule), so ADMIN actors have no
  journal rows to list — the collections-domain feed is EMPTY BY CONSTRUCTION for admins.
  File-surface usage recording (download/preview/search-hit) for admins is unchanged.
- `setupModeGuardInstance` at mount (see §2.1)

### 2.4 Request/Response Spec

**Wire casing (CODING_STYLE.md Express Patterns):** responses snake_case; request bodies camelCase
(`confirmCascade`). Route param `:id` is the numeric `action_id`.

**Journal domains enum:** `collection | batch | settings | permissions | file | sharing`. **Writers = `collection`** (all silent/merge/settings-adjacent
acts), **`batch`** (the batch worker's move/copy command rows —
`services/batchOperationService.md` §5.4; their undo pointer also travels on the bulk-job
terminal poll result, `routes/files.md`), **and `file`** (the dashboard cleanup-suggestion
accept command — one `action='cleanup-accept'` row per accepted batch,
`subject='file:suggestion-accept:<userId>:<timestamp>'`, item-level
`{ op: 'restore-from-trash' }` inverses — `routes/dashboard.md` §2.4). `settings`/`sharing`/
`permissions` are enum-reserved with no writer yet. The `permissions` asymmetry applies:
grant-undo = revoke is exposure-reduction and may be silent; revoke-undo = grant is
exposure-expansion and is explicit-only.

- **GET /:** Query `domain?` (must be one of the enum values; 400
  `actions.invalidDomain`). Window is fixed: rows `created_at >= now − 30d`, newest
  first, cap 200, no cursor.
  Rows included: `actor = requester id`, plus `actor = 'system'` rows whose subject
  resolves to a collection the requester owns. `payload` (the inverse blob) is NEVER
  serialized. 200:

```json
{
  "actions": [
    {
      "action_id": 995,
      "domain": "collection",
      "subject": "collection:17",
      "subject_label": "Europe trip",
      "actor": 4,
      "action": "merge",
      "status": "applied",
      "chain_seq": 12,
      "is_tip": true,
      "undo_available": true,
      "created_at": "2025-09-16T03:00:00Z",
      "undone_at": null,
      "expires_at": "2025-10-16T03:00:00Z"
    }
  ]
}
```

Field rules: `actor` is a numeric user id or the string `"system"`;
`status`: `applied | undone | expired`; `subject_label` is the render-safe display
label captured at commit time, never re-resolved (rows outlive subjects for audit) —
every collection-domain writer captures the
label; member-op rows carry the collection name so the dashboard feed renders them
without re-resolution (`store/collectionsStore.md` §2.1 capture table);
`undo_available` = `status='applied'` (payload not yet NULLed); `is_tip` = highest
`chain_seq` among `status='applied'` rows for the same `subject` — computed SERVER-SIDE
over the subject's FULL chain across every actor, never from the feed's requester-visible
subset: granted editors write journaled member ops onto the owner's `collection:<id>`
subject, so a feed can legitimately omit the chain tip while the subject's true tip
exists in another actor's rows. The per-row check is `countLaterChanges(domain, subject,
chainSeq) === 0` (store §2.4) — the same per-subject applied-chain guard the undo
executor applies, so the displayed flag and the undo outcome never disagree. The ≤24h
**toast**
window is a client surface rule — this API does not shorten availability at 24h.
Retention: rows survive 30d; at expiry `payload` is NULLed and `status` flips to
`expired` — expired rows stay visible in the feed until their 30d listing horizon passes.

- **POST /:id/undo:** Body optional `{ confirmCascade?: true }`.
- **Tip undo** (`is_tip` for its subject): executes free — inverse applied in one TX,
  row → `status='undone'`, `undone_at=now`. 200.
- **Non-tip undo** (older change on a moved chain): without `confirmCascade:true` →
  **409** `serverErrors.actions.cascadeConfirmRequired` with
  `params: { laterChanges: <count of later applied rows that would also be undone> }`
  — nothing is executed. With `confirmCascade:true`: the target AND every later
  applied row of the same subject are undone (all inverses, oldest-last order), each
  fingerprint-guarded. 200.
- **Fingerprint guard:** each inverse checks the subject's current state against the
  captured fingerprint. A single-inverse command that mismatches is **refused**:
  409 `serverErrors.actions.fingerprintMismatch`, row stays `applied`. A
  command-unit row carrying an item-level inverse list applies per item and reports
  mixed results in the 200 body (the `11 undone, 1 skipped (state changed since)` toast copy
  consumes these counts).
- **Expired** (`status='expired'`, payload NULLed): 409 `serverErrors.actions.expired`.
- **Already undone**: 409 `serverErrors.actions.alreadyUndone`.

200 response:

```json
{
  "action_id": 995,
  "status": "undone",
  "undone_at": "2025-09-17T10:00:00Z",
  "cascade_undone": [996, 997],
  "items_undone": 11,
  "items_skipped": 1
}
```

`cascade_undone` lists the additional `action_id`s flipped by a cascade (empty/absent
for tip undos); `items_undone`/`items_skipped` are command-row counts (≥1 / ≥0).

### 2.4.1 Error Codes (SERVER_ERROR_CODES style)

| HTTP | errorCode                                     | Trigger                                                                                  |
| ---- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 400  | `serverErrors.actions.invalidDomain`          | `domain` filter outside the enum.                                                        |
| 404  | `serverErrors.actions.notFound`               | Unknown id — or a row not visible to the requester (masquerade; ids are not enumerable). |
| 409  | `serverErrors.actions.cascadeConfirmRequired` | Non-tip undo without `confirmCascade`.                                                   |
| 409  | `serverErrors.actions.fingerprintMismatch`    | Subject changed; refusal reason.                                                         |
| 409  | `serverErrors.actions.expired`                | Payload NULLed at retention expiry.                                                      |
| 409  | `serverErrors.actions.alreadyUndone`          | Row already in `undone` status.                                                          |

All errors follow the shared envelope (`errorCode` + optional `params`,
[shared-contracts.md](../../../shared-contracts.md)); client locale mirror mandatory.

### 2.4.2 Contract clarifications

- Not-visible rows 404 (masquerade), never 403.
- Cascade undo is re-posted with `confirmCascade: true` (409 + `params` first).
- Feed is capped at 200 rows newest-first without a cursor.
- `is_tip` is computed per-subject among `applied` rows only — a row after
  an already-undone successor is still a tip (no undo-of-undo). The computation
  reads the subject's whole applied chain (every actor), independent of which
  rows the requester's feed may show.
- System-origin rows are journaled with `actor='system'` and scoped to the
  affected owner at commit time; this router trusts that scoping for feed visibility.
- Batch command rows carry per-job subjects (`batch:<jobId>`): one accepted batch is one
  row, so its chain is single-row and the row is always its subject's tip — the cascade
  confirm path exists for the domain but is unreachable in normal operation (the store
  mechanics stay domain-generic). Their undo applies the item-level inverse list:
  fingerprint-mismatched items skip, mixed counts surface in the 200 body
  (`items_undone`/`items_skipped`).
- `file`-domain rows are the dashboard cleanup-accept command family
  (`routes/dashboard.md` §2.4.2): one row per accept with a per-command timestamped subject,
  so the row is normally its subject's tip (the cascade path exists but is unreachable in
  normal operation). Their item-level inverse restores still-matching trashed nodes through the
  trash core and flips the captured suggestion rows `accepted → pending`; per-item
  fingerprint skips surface as `items_skipped`. Single-node rename-family subjects
  (`file:<nodeId>`) have no writer yet.

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md),
  [collections.md](collections.md) (mutation `undo.action_id` pointers),
  `docs/features/collections-platform.md` §4.11, CODING_STYLE.md Express Patterns.

### 2.6 Integration Test Scenarios

- [ ] Feed returns the requester's collection-domain rows (30d, newest first) with
      `subject_label`, `status`, `chain_seq`, `undone_at`; no `payload` in any response
- [ ] A journaled batch command row (`domain='batch'`, `subject='batch:<jobId>'`) lists for its
      actor with `undo_available: true`; its undo applies the item-level inverses
      (`services/batchOperationService.md` §5.5 — exercised end-to-end in the files batch
      integration suite)
- [ ] `domain=file` lists the requester's cleanup-accept command rows
      (`action='cleanup-accept'`, `subject='file:suggestion-accept:<userId>:<timestamp>'`);
      undo restores the still-matching trashed nodes and flips their suggestion rows
      `accepted → pending` (per-item skips allowed); a requester with no accepts gets 200
      empty; `domain=nope` → 400 `actions.invalidDomain`
- [ ] Another user's action id → 404 on GET visibility and on undo
- [ ] Tip undo → 200, row `status='undone'` + `undone_at`, effect reversed; second undo
      → 409 `actions.alreadyUndone`
- [ ] Non-tip undo → 409 `cascadeConfirmRequired` with `params.laterChanges = 2`,
      nothing changed; re-post with `confirmCascade:true` → 200, target + both later
      rows undone (`cascade_undone` lists them)
- [ ] Subject mutated out from under the inverse → 409 `fingerprintMismatch`, row stays
      `applied`
- [ ] Two-actor `is_tip`: an applied row another actor wrote onto the requester-owned
      subject keeps the requester's older row `is_tip:false` (and the other actor's own
      feed shows that row as the tip); undo of the older row answers 409
      `cascadeConfirmRequired` with `laterChanges` counting the invisible-actor rows —
      the displayed flag and the guard always agree
- [ ] Command row with item list, one item changed → 200 with
      `items_undone: 11, items_skipped: 1` (mixed-result report path)
- [ ] Expired row (payload NULLed) → 409 `actions.expired`
- [ ] Permanent-delete contract: archived→purged collection leaves no undoable row —
      referenced id 404s
- [ ] Setup-mode: mount returns the guard response while setup incomplete
