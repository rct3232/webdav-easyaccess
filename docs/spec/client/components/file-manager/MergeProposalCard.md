# MergeProposalCard Spec

Target-contract spec (docs-first; AI_FEATURE_PLAN §4.4/§4.9c/§4.11/§4.19 merge-arbiter; PLAN §7 T3.1/T3.1b).

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | The ONLY proposal UI in the product: one card atop the collection list (never stacked, never an inbox) presenting a pending merge pair with the §4.4 grammar; `외 N건` cycles the pending set; `병합` executes immediately (the card IS the confirmation). |
| Used in            | `CollectionsListView` merge slot (host fetches `suggestions` via `useCollections`)                                                                                                                                                                         |
| Related components | CollectionsListView, useUndoToast (host side-effect after `병합`), BaseDialog-ish overlay for compare mode                                                                                                                                                 |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/MergeProposalCard.js`
- **Test file:** `client/src/components/file-manager/__tests__/MergeProposalCard.test.js`

### 2.2 Props

| Name           | Type     | Required | Default | Description                                                                                                                                           |
| -------------- | -------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| suggestion     | object   | Y        | -       | One `GET /merge-suggestions` row (`suggestion_id`, `a_id/a_name`, `b_id/b_name`, `overlap_count`, `merged_count`, `score`, optional `recommendation`) |
| remainingCount | number   | N        | 0       | Other pending rows ⇒ renders `외 N건` cycle chip                                                                                                      |
| onCycle        | function | N        | -       | `외 N건` chip click → host advances the displayed row (order = server `score` desc)                                                                   |
| onMerge        | function | Y        | -       | `병합` click → host executes `mergeCollections(a_id, b_id)`; no dialog here (§4.4)                                                                    |
| onKeepSeparate | function | Y        | -       | `따로 둡니다` → host `rejectMerge` (permanent pair suppression)                                                                                       |
| onLater        | function | Y        | -       | `나중에` → host `dismissMerge` (server pass re-raises once after 2 weeks, then 30d sleep)                                                             |

### 2.3 Grammar (collapsed, 68px, one line)

- `"A"을(를) "B"에 병합할까요? · N개 파일이 겹칩니다 · 병합 후 M개` — `a_name`, `b_name`, `overlap_count`, `merged_count` verbatim (ko particle handling is a pure i18n formatter; **Decision:** client-side particle picker, en copy rephrases without particles).
- Overlapping-member **thumbnail strip** below/right of the line: strip is the expand toggle.
- Buttons: `[병합(primary)] [따로 둡니다(ghost)] [나중에(text)]`.
- `recommendation` (arbiter, chat configured): verdict + one-line reason rendered as a prefilled recommendation row; **absent (chat off / no band pair) ⇒ row omitted, card unchanged** (§4.19 — advise only; user still presses 병합).

### 2.4 Expanded Compare Overlay

- Strip click → two-column compare overlay (`A` | `B`, unique + shared member lists), **≤300px**, rendered OVER the list (the list is not shifted/collapsed).
- **Decision:** overlay data needs `overlap_sample: [{ a_node_id, b_node_id }]` + side-unique samples on the suggestion row (T3.1 server payload extension; the route spec currently ships counts only). Until shipped, the strip and overlay render skeleton rows — count grammar stays authoritative (zero fabrication).
- Esc/outside-click collapses back to the 68px card.

### 2.5 Zero-Footprint Rule

- `suggestions.length === 0` ⇒ the slot renders NOTHING (no card, no spacing, no collapsed hint). No sidebar/tree chips for merges (§4.4 rejection).

### 2.6 Post-`병합` Flow (host contract, restated for observability)

- Mutation returns `undo: { action_id }` ⇒ `useUndoToast.showUndoToast` (`머지를 실행했습니다`-class label + 되돌리기); list + card slot refresh (the merged row leaves the pending set; survivor keeps its name unless `name_locked` — server rule).
- Absorbed failure ⇒ error toast, card stays, no undo affordance.

### 2.7 Dependencies

- **imports:** MUI Card/Chip/Button/Box, `useTranslation`, thumbnail URL helper; **no** gateway imports (callbacks only).

### 2.8 i18n Keys

- `fileManager.mergeQuestion`, `fileManager.mergeOverlapCount`, `fileManager.mergeAfter`, `fileManager.mergeMore` (`외 N건`), `fileManager.mergeAccept` (`병합`), `fileManager.mergeKeepSeparate` (`따로 둡니다`), `fileManager.mergeLater` (`나중에`), `fileManager.mergeRecommendation`

### 2.9 Verification Scenarios

- [ ] Collapsed card height 68px, single line + strip + 3 buttons present.
- [ ] `remainingCount > 0` shows `외 N건`; `onCycle` invoked on chip click.
- [ ] `병합` calls `onMerge` with the pair ids and opens NO dialog.
- [ ] `따로 둡니다`/`나중에` call reject/dismiss respectively (distinct semantics asserted via callback identity).
- [ ] Empty suggestions ⇒ component tree contains no card DOM node.
- [ ] No `recommendation` field ⇒ no recommendation row rendered (absent, not placeholder).

### 2.10 Edge Cases

- Pair disappearing server-side (merged in another tab): next `병합` absorbs a 404/409 into an error toast + slot refresh.
- `merged_count === overlap_count` (full containment is pre-filtered §4.9c; still renderable): grammar unchanged.
