# MergeProposalCard Spec

Target-contract spec.

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | The ONLY proposal UI in the product: one sticky card between the collections toolbar and the collection list (never stacked, never an inbox). The card body presents the top score-desc pending pair; a centered footer expands an accordion of the remaining pending pairs; desktop hover / mobile tap opens a non-modal detail panel with the real sample tiles. `Merge` executes immediately (the card IS the confirmation). |
| Used in            | `CollectionsListView` merge slot (host fetches `suggestions` via `useCollections`)                                                                                                                                                                                                                                                                                                                                              |
| Related components | CollectionsListView, useUndoToast (host side-effect after `Merge`), MUI Popper (non-modal detail panel)                                                                                                                                                                                                                                                                                                                         |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/MergeProposalCard.js`
- **Test file:** `client/src/components/file-manager/__tests__/MergeProposalCard.test.js`

### 2.2 Props

| Name                | Type     | Required | Default | Description                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | -------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| suggestions         | array    | Y        | -       | The pending `GET /merge-suggestions` rows in server order (score desc). `suggestions[0]` is the card body; `suggestions.slice(1)` are the footer accordion rows. Each row carries `suggestion_id`, `a_id/a_name` (survivor), `b_id/b_name` (absorbed), `overlap_count`, `merged_count`, `score`, `overlap_sample`, `a_unique_sample`/`b_unique_sample`, optional `recommendation`. |
| onAction            | function | Y        | -       | `(suggestionId, action) => void`; `action` is `'merge' \| 'keep-separate' \| 'later'`. The card dispatches the clicked row's `suggestion_id`; the host resolves the pair and calls `mergePair` / `rejectMergeSuggestion` / `dismissMergeSuggestion`. The card closes its detail panel before dispatching.                                                                          |
| thumbnailMap        | object   | N        | null    | Host-owned `Map<nodeId, url>` of already-loaded sample thumbnails (the shared preview cache); a sample id without an entry renders a placeholder tile.                                                                                                                                                                                                                             |
| onRequestThumbnails | function | N        | -       | Called with the displayed sample node ids when a detail panel opens (`(nodeIds) => void`); absent ⇒ tiles simply stay placeholders.                                                                                                                                                                                                                                                |

The host never remounts the card with a `key` and never keeps a cursor — the top row is
always `suggestions[0]`, so resolving the top pair promotes the next pending pair
automatically. The prop contract is exactly the four rows above; there are no per-row
selection callbacks.

### 2.3 Card Body (collapsed)

- `"Merge "<absorbed>" into "<survivor>"? · N overlapping files · M after merge"` — the pair
  executes as `onAction(suggestion_id, 'merge')` where `a_id` is the SURVIVOR (§2.2/§2.6), so
  the line maps `survivor = a_name`, `absorbed = b_name` verbatim (`overlap_count`,
  `merged_count` likewise). `a_name`, `b_name`, `overlap_count`, `merged_count` verbatim
  (ko particle handling is a pure i18n formatter — a client-side particle picker; en copy is
  phrased without particles).
- Buttons: `[Merge(primary)] [Keep separate(ghost)] [Later(text)]`, each dispatching the
  top row's id (`merge-accept`, `merge-keep-separate`, `merge-later`).
- Body/footer structure: the body is the summary line (the hover/tap/keyboard target); the
  footer is a separate full-width strip.
- No thumbnail strip and no expand button: samples live in the detail panel (desktop hover /
  mobile tap). The body carries `role="button"`, `tabIndex=0`, `aria-expanded` and an
  Enter/Space keyboard path so the detail stays reachable without hover.
- Mobile: the CardContent is a column — summary text on top, the three action buttons at the
  bottom, footer below. Desktop: summary left, actions right, footer below.
- `recommendation` is never rendered on the collapsed card; its `reason` is the detail
  panel's one-line reason (§2.5).

### 2.4 Pending Accordion (footer)

- Renders only when `suggestions.length > 1`. The footer is centered TEXT (no chip, no badge),
  `role="button"`, `tabIndex=0`, `aria-expanded`, data-testid `merge-more-toggle`, and toggles
  the accordion on click or Enter/Space. Copy = `fileManager.mergeMore` with the count of
  remaining rows.
- Expanded accordion (`merge-suggestion-list`) lists `suggestions.slice(1)` in server order as
  rows (`merge-suggestion-row-<suggestion_id>`), each showing the same question/count grammar.
  The list has `maxHeight: 40vh` with vertical scroll. Expansion is in normal flow inside the
  sticky region, so it pushes the collection grid down.
- Row interaction: desktop click is a NO-OP (hover opens the detail); mobile tap opens the
  detail. A row is keyboard-focusable and Enter/Space opens the detail. No active pair
  selection state exists.

### 2.5 Detail Panel (non-modal)

- Opens on desktop hover with 200ms intent, or on mobile tap. There is NO expand button. The
  panel is a MUI `Popper` anchored to the card for the top row and to the accordion row for
  lower rows; `flip` + `preventOverflow` move lower-row panels above when the viewport is
  tight. It is rendered below the sticky region, covers the collection list, and adds NO
  full-screen backdrop and NO mouse-follow positioning. Card actions stay clickable.
- Close behavior: 300ms hover-out grace, cancelled by pointer enter on the panel; Esc;
  outside pointer-down; the panel's close button (`merge-detail-close`).
- Content: the title only (`mergeQuestion`, `merge-detail-title`), then two large sample
  panels in B(absorbed) → A(survivor) order (`merge-detail-tiles`):
  - left = `b_unique_sample` tiles (`merge-unique-b-<node_id>`, name caption);
  - arrow = `merge-detail-arrow`;
  - right = `a_unique_sample` tiles (`merge-unique-a-<node_id>`, name caption).
    Shared members are represented by the reason/counts, not by a third tile column.
    Thumbnails come from `thumbnailMap`; unloaded samples stay placeholders (zero fabrication).
    Tiles fill their panel (`aspect-ratio: 1`) with no 300px ceiling; mobile stacks B above A.
- Bottom one-line reason (`merge-detail-reason`, single line with ellipsis): use
  `recommendation.reason` verbatim when present (arbiter band only), else the deterministic
  counts sentence from `overlap_count`/`merged_count` (`fileManager.mergeReason`, e.g.
  `41 of 58 files are shared; merging keeps them in one collection.`). No LLM call ever
  generates this sentence.
- The panel contains its own `Merge` / `Keep separate` / `Later` actions
  (`merge-detail-accept`, `merge-detail-keep-separate`, `merge-detail-later`), dispatching the
  displayed row's id with the same `onAction` contract and closing the panel.

### 2.6 Zero-Footprint Rule

- `suggestions.length === 0` ⇒ the component returns `null` (no card, no spacing, no collapsed
  hint). No sidebar/tree chips for merges.
- The host builds the card ONLY when the pending set is non-empty; the `CollectionsListView`
  slot itself then has no sticky wrapper in the empty case.

### 2.7 Post-`Action` Flow (host contract, restated for observability)

- `merge` mutation returns `undo: { action_id }` ⇒ `useUndoToast.showUndoToast`
  (`Merge executed`-class label + Undo); list + card slot refresh (the merged row leaves the
  pending set; survivor keeps its name unless `name_locked` — server rule).
- Absorbed failure ⇒ error toast, card stays, no undo affordance.
- `later`/`keep-separate` responses carry no `undo` pointer (proposal-state transitions are
  non-journaled); the host refreshes so the resolved row drops out and `suggestions[0]` becomes
  the next pending pair.
- The card is never remounted by a `key`; the same DOM node survives suggestion-set changes.

### 2.8 Dependencies

- **imports:** MUI Card/CardContent/Button/Box/Paper/Popper/IconButton/Typography,
  `useTranslation`, `utils/koParticleUtils.js` (pure particle picker), `hooks/useResponsive`
  (mobile tap vs desktop hover); **no** gateway/service imports (callbacks only — thumbnails
  arrive via `thumbnailMap`/`onRequestThumbnails` props).

### 2.9 i18n Keys

- `fileManager.mergeQuestion`, `fileManager.mergeOverlapCount`, `fileManager.mergeAfter`,
  `fileManager.mergeMore` (footer text), `fileManager.mergeAccept` (`Merge`),
  `fileManager.mergeKeepSeparate` (`Keep separate`), `fileManager.mergeLater` (`Later`),
  `fileManager.mergeReason` (deterministic counts sentence), `fileManager.mergeDetailsAria`
  (body/row keyboard label), `fileManager.mergeShared` / `fileManager.mergeUnique` (detail tile
  group aria labels only), `fileManager.mergeClose` (panel close aria)

### 2.10 Verification Scenarios

- [ ] One card for a non-empty set; top row is score-desc first; the same DOM node is reused
      when the set shrinks (no key remount).
- [ ] Distinct `Merge`/`Keep separate`/`Later` actions dispatch `onAction` with the top row's
      `suggestion_id` and the matching action string; no dialog opens.
- [ ] `suggestions.length > 1` renders the centered footer text (no chip/badge), with
      `role="button"` + `aria-expanded`; expanding lists the remaining rows in a 40vh
      scrollable accordion and the collection grid shifts down.
- [ ] `suggestions.length === 0` ⇒ component tree contains no card DOM node.
- [ ] Desktop hover opens the detail panel after 200ms; leaving keeps it open for 300ms;
      pointer enter on the panel cancels the close; Esc/outside/close button closes.
- [ ] Mobile tap on the card body or an accordion row opens the detail; desktop accordion-row
      click is a no-op; Enter/Space opens from a focused body/row.
- [ ] Detail shows only the title, then B-unique → arrow → A-unique large tiles, then a
      bottom one-line reason; `recommendation.reason` wins when present, otherwise the
      deterministic counts sentence.
- [ ] Detail actions dispatch the displayed row's id and close the panel; card actions remain
      clickable while the panel is open.
- [ ] `onRequestThumbnails` fires with the displayed sample node ids when a detail opens.
- [ ] E2E/BDD selector anchors (`data-testid`): `merge-proposal-card`, `merge-card-body`,
      `merge-card-actions`, `merge-more-toggle`, `merge-suggestion-list`,
      `merge-suggestion-row-<suggestion_id>`, `merge-detail-panel`, `merge-detail-title`,
      `merge-detail-tiles`, `merge-detail-arrow`, `merge-detail-reason`, `merge-detail-close`,
      `merge-unique-a-<node_id>`, `merge-unique-b-<node_id>`,
      `merge-accept`, `merge-keep-separate`, `merge-later`, `merge-detail-accept`,
      `merge-detail-keep-separate`, `merge-detail-later`.

### 2.11 Edge Cases

- Pair disappearing server-side (merged in another tab): next action absorbs a 404/409 into an
  error toast + slot refresh.
- `merged_count === overlap_count` (full containment is pre-filtered server-side; still
  renderable): grammar unchanged, reason sentence remains counts-derived.
- A detail panel open on a row that the host removes is closed by the suggestions-change
  effect; the next pending row becomes `suggestions[0]`.
- Sample arrays are capped server-side (8 shared / 4 per unique side); the card renders the
  capped view and never fabricates a remainder.
