# actions routes Spec

Target-contract spec.

## 1. Overview

| Item       | Description                                                                      |
| ---------- | -------------------------------------------------------------------------------- |
| Mount path | `/api/actions`                                                                   |
| Role       | Undo journal read feed (30d) + undo execution (tip / cascade-confirm semantics). |

**Ownership boundary:** the journal is common infrastructure (NOT ai-prefixed). Writers go
exclusively through `commitChange(mutation, inverse)` (§4.11) — this router only reads and
undoes; it never accepts new rows. Undo flow referenced by every collection mutation's
`undo: { action_id }` pointer lives here ([collections.md](collections.md)).

Undo does NOT restore: spent LLM cost, already-received external exposure (grant-snapshot
undo restores future state only), or file content (trash/versions own that world).
Permanent delete (`archived→영구삭제`, empty-trash) has NO undo row by contract
(invariant 10, trash-parity) — such ids return 404 from this feed.

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
- `setupModeGuardInstance` at mount (see §2.1)

### 2.4 Request/Response Spec

**Wire casing (CODING_STYLE.md Express Patterns):** responses snake_case; request bodies camelCase
(`confirmCascade`). Route param `:id` is the numeric `action_id`.

**Journal domains enum (§5):** `collection | batch | settings | permissions | tags |
file | sharing`. **v1 writers = `collection` only** (all silent/merge/settings-adjacent
acts, §4.11). `batch` and `settings` arrive with later journal subscribers (DEF-25), `file`/`sharing` with the
P4 admin-config subscription; `file`/`sharing`/`tags`/`permissions` are enum-reserved
with no writer yet (the `permissions` asymmetry note applies: grant-undo = revoke is
exposure-reduction and may be silent; revoke-undo = grant is exposure-expansion and is
explicit-only, rule 2).

- **GET /:** Query `domain?` (must be one of the enum values; 400
  `actions.invalidDomain`). Window is fixed: rows `created_at >= now − 30d`, newest
  first, cap 200 (no cursor — personal scale; §4.11 dashboard feed). Rows included:
  `actor = requester id`, plus `actor = 'system'` rows whose subject resolves to a
  collection the requester owns (silent system acts are undoable by their victim-user
  via digest/feed surfaces). `payload` (the inverse blob) is NEVER serialized. 200:

```json
{
  "actions": [
    {
      "action_id": 995,
      "domain": "collection",
      "subject": "collection:17",
      "subject_label": "유럽 여행",
      "actor": 4,
      "action": "merge",
      "status": "applied",
      "chain_seq": 12,
      "is_tip": true,
      "undo_available": true,
      "created_at": "2026-09-16T03:00:00Z",
      "undone_at": null,
      "expires_at": "2026-10-16T03:00:00Z"
    }
  ]
}
```

Field rules: `actor` is a numeric user id or the string `"system"`;
`status`: `applied | undone | expired`; `subject_label` is the render-safe display
label captured at commit time (never re-resolved — rows outlive subjects for audit);
`undo_available` = `status='applied'` (payload not yet NULLed); `is_tip` = highest
`chain_seq` among `status='applied'` rows for the same `subject` (lets the client plan
the cascade dialog without a round trip). The ≤24h **toast** window is a client
surface rule (§4.11) — this API does not shorten availability at 24h.
Retention note: rows survive 30d; at expiry `payload` is NULLed and `status` flips to
`expired` (audit keeps "what happened" without storage growth) — expired rows stay
visible in the feed until their 30d listing horizon passes.

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
  mixed results in the 200 body (the `11개 되돌림, 1개는 변경되어 건너뜀` toast copy
  consumes these counts).
- **Expired** (`status='expired'`, payload NULLed): 409 `serverErrors.actions.expired`.
- **Already undone**: 409 `serverErrors.actions.alreadyUndone`.

200 response:

```json
{
  "action_id": 995,
  "status": "undone",
  "undone_at": "2026-09-17T10:00:00Z",
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

### 2.4.2 Decisions (micro-details the plan left open)

- **Decision:** not-visible rows 404 (masquerade) instead of 403 — journal ids leak
  nothing about other users' activity.
- **Decision:** cascade undo is re-posted with `confirmCascade: true` (409 + params
  first) instead of a dedicated `?force` flag or a two-phase token — the dialog counts
  come straight from `params.laterChanges`.
- **Decision:** feed is capped at 200 rows newest-first without a cursor (30d personal
  scale; mirrors the collections no-pagination stance).
- **Decision:** `is_tip` is computed per-subject among `applied` rows only — a row after
  an already-undone successor is still a tip (undo-of-undo is out of scope §4.11).
- **Decision:** system-origin rows are journaled with `actor='system'` and scoped to the
  affected owner at commit time; this router trusts that scoping for feed visibility.

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md),
  [collections.md](collections.md) (mutation `undo.action_id` pointers),
  `docs/features/collections-platform.md` §4.11/§5, CODING_STYLE.md Express Patterns/§7 (DEF-25, DEF-25).

### 2.6 Integration Test Scenarios

- [ ] Feed returns the requester's collection-domain rows (30d, newest first) with
      `subject_label`, `status`, `chain_seq`, `undone_at`; no `payload` in any response
- [ ] `domain=file` (enum-valid, zero writers in v1) → 200 empty list; `domain=nope` →
      400 `actions.invalidDomain`
- [ ] Another user's action id → 404 on GET visibility and on undo
- [ ] Tip undo → 200, row `status='undone'` + `undone_at`, effect reversed; second undo
      → 409 `actions.alreadyUndone`
- [ ] Non-tip undo → 409 `cascadeConfirmRequired` with `params.laterChanges = 2`,
      nothing changed; re-post with `confirmCascade:true` → 200, target + both later
      rows undone (`cascade_undone` lists them)
- [ ] Subject mutated out from under the inverse → 409 `fingerprintMismatch`, row stays
      `applied`
- [ ] Command row with item list, one item changed → 200 with
      `items_undone: 11, items_skipped: 1` (mixed-result report path)
- [ ] Expired row (payload NULLed) → 409 `actions.expired`
- [ ] Permanent-delete contract: archived→purged collection leaves no undoable row —
      referenced id 404s
- [ ] Setup-mode: mount returns the guard response while setup incomplete
