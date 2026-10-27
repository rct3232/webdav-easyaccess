# MergeProposalCard Spec

Target-contract spec.

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | The ONLY proposal UI in the product: one card atop the collection list (never stacked, never an inbox) presenting a pending merge pair with the collapsed one-line grammar (§2.3); `+N more` cycles the pending set; `Merge` executes immediately (the card IS the confirmation). |
| Used in            | `CollectionsListView` merge slot (host fetches `suggestions` via `useCollections`)                                                                                                                                                                                                |
| Related components | CollectionsListView, useUndoToast (host side-effect after `Merge`), BaseDialog-ish overlay for compare mode                                                                                                                                                                       |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/MergeProposalCard.js`
- **Test file:** `client/src/components/file-manager/__tests__/MergeProposalCard.test.js`

### 2.2 Props

| Name                | Type     | Required | Default | Description                                                                                                                                                                                                  |
| ------------------- | -------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| suggestion          | object   | Y        | -       | One `GET /merge-suggestions` row (`suggestion_id`, `a_id/a_name`, `b_id/b_name`, `overlap_count`, `merged_count`, `score`, `overlap_sample`, `a_unique_sample`/`b_unique_sample`, optional `recommendation`) |
| remainingCount      | number   | N        | 0       | Other pending rows ⇒ renders `+N more` cycle chip                                                                                                                                                            |
| onCycle             | function | N        | -       | `+N more` chip click → host advances the displayed row (order = server `score` desc)                                                                                                                         |
| onMerge             | function | Y        | -       | `Merge` click → host executes `mergeCollections(a_id, b_id)`; no dialog here (the card is the confirmation)                                                                                                  |
| onKeepSeparate      | function | Y        | -       | `Keep separate` → host `rejectMerge` (permanent pair suppression); host refresh re-reads the pending set                                                                                                     |
| onLater             | function | Y        | -       | `Later` → host `dismissMerge` (server pass re-raises once after 2 weeks, then 30d sleep); host refresh re-reads the pending set                                                                              |
| thumbnailMap        | object   | N        | null    | Host-owned `Map<nodeId, url>` of already-loaded sample thumbnails (the shared preview cache); a sample id without an entry renders a placeholder tile                                                        |
| onRequestThumbnails | function | N        | -       | Strip-visible effect asks the host to batch-load the displayed sample ids (`(nodeIds) => void`); absent ⇒ tiles simply stay placeholders                                                                     |

### 2.3 Grammar (collapsed, 68px, one line)

- `"Merge "<absorbed>" into "<survivor>"? · N overlapping files · M after merge"` — the pair
  executes as `onMerge(a_id, b_id)` where `a_id` is the SURVIVOR (§2.2/§2.6), so the line maps
  `survivor = a_name`, `absorbed = b_name` verbatim (`overlap_count`, `merged_count` likewise).
  `a_name`, `b_name`, `overlap_count`, `merged_count` verbatim (ko particle handling is a pure i18n formatter — a client-side particle picker; en copy is phrased without particles).
- Overlapping-member **thumbnail strip** below/right of the line: strip is the expand toggle.
  Tiles render `thumbnailMap` URLs for the `overlap_sample` node ids (max 8 shown), a media
  placeholder for samples without a loaded URL — nothing invented.
- Buttons: `[Merge(primary)] [Keep separate(ghost)] [Later(text)]`.
- `recommendation` (arbiter, chat configured): verdict + one-line reason rendered as a prefilled recommendation row; **absent (chat off / no band pair) ⇒ row omitted, card unchanged** (advise only; user still presses Merge).

### 2.4 Expanded Compare Overlay

- Strip click → two-column compare overlay (`A` | `B`, unique + shared member lists), **≤300px**,
  rendered OVER the list (the list is not shifted/collapsed).
- The overlay renders the suggestion row's REAL sample data: shared column = `overlap_sample`
  thumbnail tiles (`{ a_node_id, b_node_id }`, host `thumbnailMap` URLs, placeholders while
  unloaded), each side's column head shows that side's name; `a_unique_sample` /
  `b_unique_sample` (`{ node_id, name }`, ≤4 each) list under their side with names. The full
  counts stay the authoritative grammar (samples are capped views — the overlay never claims
  completeness beyond them; a truncated remainder is not rendered, not fabricated).
- Esc/outside-click collapses back to the 68px card.

### 2.5 Zero-Footprint Rule

- `suggestions.length === 0` ⇒ the slot renders NOTHING (no card, no spacing, no collapsed hint). No sidebar/tree chips for merges.
- The host builds the card ONLY when the pending set is non-empty; the slot itself then has no wrapper markup of its own in the empty case.

### 2.6 Post-`Merge` Flow (host contract, restated for observability)

- Mutation returns `undo: { action_id }` ⇒ `useUndoToast.showUndoToast` (`Merge executed`-class label + Undo); list + card slot refresh (the merged row leaves the pending set; survivor keeps its name unless `name_locked` — server rule).
- Absorbed failure ⇒ error toast, card stays, no undo affordance.
- `Later`/`Keep separate` responses carry no `undo` pointer (proposal-state transitions are non-journaled); the host refreshes so the resolved card drops out and the cycle chip accounts for the shrunken set.

### 2.7 Dependencies

- **imports:** MUI Card/Chip/Button/Box, `useTranslation`, `utils/koParticleUtils.js` (pure particle picker); **no** gateway/service imports (callbacks only — thumbnails arrive via `thumbnailMap`/`onRequestThumbnails` props).

### 2.8 i18n Keys

- `fileManager.mergeQuestion`, `fileManager.mergeOverlapCount`, `fileManager.mergeAfter`, `fileManager.mergeMore` (`+N more`), `fileManager.mergeAccept` (`Merge`), `fileManager.mergeKeepSeparate` (`Keep separate`), `fileManager.mergeLater` (`Later`), `fileManager.mergeRecommendation`, `fileManager.mergeShared`, `fileManager.mergeUnique`, `fileManager.mergeClose` (overlay column labels + close aria)

### 2.9 Verification Scenarios

- [ ] Collapsed card height 68px, single line + strip + 3 buttons present.
- [ ] `remainingCount > 0` shows `+N more`; `onCycle` invoked on chip click.
- [ ] `Merge` calls `onMerge` with the pair ids and opens NO dialog.
- [ ] `Keep separate`/`Later` call reject/dismiss respectively (distinct semantics asserted via callback identity).
- [ ] Empty suggestions ⇒ component tree contains no card DOM node.
- [ ] No `recommendation` field ⇒ no recommendation row rendered (absent, not placeholder).
- [ ] Strip click opens the overlay rendering the row's `overlap_sample` tiles and BOTH sides'
      unique-sample names (real sample rows); Esc/outside-click closes it.
- [ ] `onRequestThumbnails` fires with the displayed sample node ids on strip mount.
- [ ] E2E/BDD selector anchors (`data-testid`): `merge-proposal-card`, `merge-cycle-chip`,
      `merge-strip`, `merge-compare-overlay`, `merge-compare-close`,
      `merge-sample-tile-<a_node_id>`, `merge-unique-a-<node_id>`, `merge-unique-b-<node_id>`,
      `merge-accept`, `merge-keep-separate`, `merge-later`, `merge-recommendation`.

### 2.10 Edge Cases

- Pair disappearing server-side (merged in another tab): next `Merge` absorbs a 404/409 into an error toast + slot refresh.
- `merged_count === overlap_count` (full containment is pre-filtered server-side; still renderable): grammar unchanged.
