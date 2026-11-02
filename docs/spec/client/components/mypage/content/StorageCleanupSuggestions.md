# StorageCleanupSuggestions Spec

Target-contract spec (storage cleanup suggestions; `storageRepository.md`, `StorageDashboard.md`).

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role               | Cleanup/duplicate suggestions block as checkbox rows with a SINGLE accept control `Accept selected (N)` — checked rows → trash, command-unit undo. The checkbox IS the selection confirmation (no extra dialog); dismiss stays per-row. Renders in the `Storage` dashboard; the inline row-chip variant belongs to file rows (separate surface). |
| Used in            | `StorageDashboard` (cleanup suggestions block, anchor `storage-suggestions`)                                                                                                                                                                                                                                                                     |
| Related components | StorageDashboard, useUndoToast (host after accept), getFileIcon/getThumbnail (row glyphs)                                                                                                                                                                                                                                                        |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/StorageCleanupSuggestions.js`
- **Test file:** `client/src/components/mypage/content/__tests__/StorageCleanupSuggestions.test.js`

### 2.2 Props

| Name        | Type     | Required | Default | Description                                                                                                                                                                                           |
| ----------- | -------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| suggestions | array    | Y        | -       | `storage_suggestions` rows (snake_case: `id`, `node_id`, `kind`, `reason` JSONB, `created_at`, `expires_at`) + host-provided `path`/`size_bytes` (the dashboard read supplies them — no second fetch) |
| onAccept    | function | Y        | -       | `(nodeIds) => Promise<payload ∥ null>` — checked rows only; trash (not purge); undo toast from command `action_id`                                                                                    |
| onDismiss   | function | Y        | -       | `(suggestionId) => void` — per-row only, rendered for rows carrying an `id`; dismissed rows leave the list without a toast                                                                            |
| loading     | boolean  | N        | false   | Skeleton rows                                                                                                                                                                                         |

### 2.3 Contract Rules (checkbox in ALL cases)

- Every row: checkbox (`data-testid="suggestion-checkbox"`) + thumbnail + name + reason chip (`reason.kind`/`reason` text mapped via i18n; e.g. exact-dup / near-dup keeper pick / 30d-unopened / temp pattern).
- Near-dup rows carrying `reason.keep` render the keeper label `Keep: <name> · <basis label>`
  (basename only — never the keeper's full path) plus an accessible `Why this keeper?`
  disclosure (`aria-expanded` + `aria-controls`) that expands the DETAIL: the raw
  `relative_score` labeled group-relative and one bar per factor (`activity`, `quality`,
  `name`, `centrality`), also labeled group-relative. Raw activity counts/timestamps are
  never rendered. A row WITHOUT `reason.keep` renders no keeper label and no disclosure
  (legacy rows — no backfill).
- The ONLY accept control is `Accept selected (N)` above/below the list
  (`data-testid="suggestions-accept"`), `N` = live checked count, disabled at `N=0` (empty
  state shows the button absent, not disabled-with-zero).
- No per-file accept, no threshold-variant layouts, no bulk-accept-all.
- Accept executes `onAccept(checkedNodeIds)`; success → undo toast (`Moved N items to Trash` + Undo; checked count = inverse count, command row `subject` carries the item list). Absorbed failure → error, checkboxes retained.
- Dismiss control: `data-testid="suggestion-dismiss-<id>"` for rows carrying `id` when the
  host passes `onDismiss`; absorbed failure keeps the row, success removes it silently.
- Expiry note: unaccepted suggestions expire with the retention job — footer line `kept until expiry` only, no countdown per row.
- Keeper recommendation (chat on): pre-fills which row of a near-dup group is suggested-to-go; heuristic rows render identically when absent (zero-LLM variant).

### 2.4 Dependencies

- **imports:** MUI Checkbox/List/Button, useTranslation, file icon/thumbnail helpers; data arrives via props (the dashboard loads through `explorerGateway.getStorageHygiene()` — `storageRepository.md` §2.3).

### 2.5 i18n Keys

- `mypage.suggestionsTitle`, `mypage.suggestionsAccept` (`Accept selected (N)`), `mypage.suggestionsDismiss`, `mypage.suggestionsReason*` (kind labels), `mypage.suggestionsEmpty`, `mypage.suggestionsExpiryNote`
- Keeper exposure: `mypage.suggestionsKeep` (`Keep: {{name}} · {{basis}}`), `mypage.suggestionsKeepWhy` (`Why this keeper?`), `mypage.suggestionsKeepScore` (group-relative score), `mypage.suggestionsKeepFactor` (group-relative factor label), `mypage.suggestionsKeepBasis.*` (`Activity`, `Resolution`, `Size`, `Name`, `Centrality`, `Mixed`, `None`) — `en`/`ko` mirrors mandatory.

### 2.6 Verification Scenarios

- [ ] Rows render with checkboxes unchecked initially; `Accept selected (N)` reflects checked count live.
- [ ] Accept sends ONLY checked nodeIds and clears the selection on success.
- [ ] Per-row dismiss removes the row without touching other rows or firing a toast.
- [ ] No accept control exists per row (single-control rule).
- [ ] `loading=true` renders skeletons; empty list renders `suggestionsEmpty` and no accept button.
- [ ] The expiry footer appears only when at least one row carries a non-null `expires_at`.
- [ ] A near-dup row with `reason.keep` shows `Keep: <name> · <basis>`; the `Why this keeper?`
      disclosure is collapsed initially and expands the group-relative score + factor bars;
      a row without `keep` shows neither; `en`/`ko` keys mirror.

### 2.7 Edge Cases

- Node trashed by owner between listing and accept: the server `rejected_not_owned`/`skipped` lists surface via the accept result handling (mixed outcome path).
- `expires_at` past render horizon: row simply absent (server filters) — no client expiry math.
- **Persisted rows (the norm):** every checklist row is a `storage_suggestions` row carrying an
  `id`, `created_at` and `expires_at` (`storageRepository.md` §2.2 — plus host-provided
  `path`, `size_bytes` and `reason` with `keep_node_id`). The dismiss control renders only
  when the row carries an `id` AND the host passes `onDismiss` (the `Storage` dashboard
  passes it). The expiry footer renders only when at least one listed row carries a non-null
  `expires_at` (retention `0` ⇒ rows list without `expires_at`, no footer). Rows equal to a
  group's `keep_node_id` are never listed (server guarantee).
