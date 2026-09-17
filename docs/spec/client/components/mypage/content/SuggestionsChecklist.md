# SuggestionsChecklist Spec

Target-contract spec , §4.11 command-unit undo; the collections-platform feature doc §7 DEF-25).

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Cleanup/duplicate suggestions block as checkbox rows with a SINGLE accept control `선택 수락(N)` — checked rows → trash, command-unit undo. The checkbox IS the selection confirmation (no extra dialog); dismiss stays per-row. Renders in the `저장공간` dashboard; the inline row-chip variant of §4.17 belongs to file rows (separate surface). |
| Used in            | `CollectionDashboard` (suggestions block)                                                                                                                                                                                                                                                                                                           |
| Related components | CollectionDashboard, useUndoToast (host after accept), getFileIcon/getThumbnail (row glyphs)                                                                                                                                                                                                                                                        |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/SuggestionsChecklist.js`
- **Test file:** `client/src/components/mypage/content/__tests__/SuggestionsChecklist.test.js`

### 2.2 Props

| Name        | Type     | Required | Default | Description                                                                                                                                     |
| ----------- | -------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| suggestions | array    | Y        | -       | `file_suggestions` rows (snake_case: `id`, `node_id`, `kind`, `reason` JSONB, `created_at`, `expires_at`) + host-enriched node `name`/thumbnail |
| onAccept    | function | Y        | -       | `(nodeIds) => Promise<payload ∥ null>` — checked rows only; trash (not purge); undo toast from command `action_id` (§4.11)                      |
| onDismiss   | function | Y        | -       | `(suggestionId) => void` — per-row only; dismissed rows leave the list without a toast                                                          |
| loading     | boolean  | N        | false   | Skeleton rows                                                                                                                                   |

### 2.3 Contract Rules (Q4 — checkbox in ALL cases)

- Every row: checkbox + thumbnail + name + reason chip (`reason.kind`/`reason` text mapped via i18n; e.g. exact-dup / near-dup keeper pick / 30d-unopened / temp pattern).
- The ONLY accept control is `선택 수락(N)` above/below the list, `N` = live checked count, disabled at `N=0` (empty state shows the button absent, not disabled-with-zero).
- No per-file accept, no threshold-variant layouts, no bulk-accept-all (rejects per §4.16 Q4 wording).
- Accept executes `onAccept(checkedNodeIds)`; success → undo toast (`N개 휴지통으로 이동` + 되돌리기; checked count = inverse count, command row `subject` carries the item list). Absorbed failure → error, checkboxes retained.
- Expiry note: unaccepted suggestions expire with the retention job — footer line `만료 전까지 보관` only, no countdown per row.
- Keeper recommendation (chat on, §4.17/§4.19): pre-fills which row of a near-dup group is suggested-to-go; heuristic rows render identically when absent (zero-LLM variant §4.17).

### 2.4 Dependencies

- **imports:** MUI Checkbox/List/Button, useTranslation, file icon/thumbnail helpers; data arrives via props (dashboard controller loads through `explorerGateway` §2.6 seams — **Decision:** suggestions endpoints land with DEF-25; repository/getter names already reserved in `collectionsRepository.md` §2.3).

### 2.5 i18n Keys

- `mypage.suggestionsTitle`, `mypage.suggestionsAccept` (`선택 수락(N)`), `mypage.suggestionsDismiss`, `mypage.suggestionsReason*` (kind labels), `mypage.suggestionsEmpty`, `mypage.suggestionsExpiryNote`

### 2.6 Verification Scenarios

- [ ] Rows render with checkboxes unchecked initially; `선택 수락(N)` reflects checked count live.
- [ ] Accept sends ONLY checked nodeIds and clears the selection on success.
- [ ] Per-row dismiss removes the row without touching other rows or firing a toast.
- [ ] No accept control exists per row (single-control rule).
- [ ] `loading=true` renders skeletons; empty list renders `suggestionsEmpty` and no accept button.

### 2.7 Edge Cases

- Node trashed by owner between listing and accept: server `items_skipped`/reject lists surface via the accept result toast text (mixed outcome path).
- `expires_at` past render horizon: row simply absent (server filters) — no client expiry math.
