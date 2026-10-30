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
- Buttons: `[Merge(primary)] [Keep separate(ghost)] [Later(text)]` on EVERY item, each
  dispatching that item's id. The first item keeps `merge-accept`/`merge-keep-separate`/
  `merge-later`; expanded items use `merge-row-<action>-<suggestion_id>`.
- Body/footer structure: each item is a summary line + its actions (the hover/tap/keyboard
  target is the text block); the footer is a separate full-width strip after the list.
- No thumbnail strip and no expand button: samples live in the detail panel (desktop hover /
  mobile tap). The body carries `role="button"`, `tabIndex=0`, `aria-expanded` and an
  Enter/Space keyboard path so the detail stays reachable without hover.
- Mobile: each item is a column — summary text on top, the three action buttons at the
  bottom. Desktop: summary left, actions right. Footer below the list.
- `recommendation` is never rendered on the collapsed card; its `reason` is the inline
  detail's one-line reason (§2.5).

### 2.4 Pending Accordion (footer)

- Renders only when `suggestions.length > 1`. The footer is centered TEXT (no chip, no badge),
  `role="button"`, `tabIndex=0`, `aria-expanded`, data-testid `merge-more-toggle`, and toggles
  the accordion on click or Enter/Space. Copy = `fileManager.mergeMore` with the count of
  remaining rows.
- Expanded accordion (`merge-suggestion-list`) lists ALL suggestions in server order,
  including the first item, as rows with the same question/count/actions UI. The list has a
  viewport-bounded `maxHeight` (never taller than the collection-list area) with vertical
  scroll, so the first item scrolls with the rest. The footer stays BELOW the scroll list at
  the bottom of the card.
- Row interaction: desktop click is a NO-OP (hover opens the detail); mobile tap opens the
  detail. A row's text block is keyboard-focusable and Enter/Space opens the detail. No
  active-pair selection state exists.

### 2.5 Detail Panel (non-modal)

- Opens on desktop hover with 200ms intent, or on mobile tap. There is NO expand button. The
  panel is rendered INLINE inside the accordion, immediately below the hovered/tapped item
  (or immediately above it when the lower viewport half cannot fit). It never portals outside
  the accordion, adds NO full-screen backdrop, and does not follow the mouse. Item actions
  stay clickable.
- Close behavior: 300ms hover-out grace, cancelled by pointer enter on the panel; Esc;
  outside pointer-down; the panel's close button (`merge-detail-close`).
- Content: the title only (`mergeQuestion`, `merge-detail-title`), then two large sample
  panels in B(absorbed) → A(survivor) order (`merge-detail-tiles`):
  - left = `b_unique_sample` tiles (`merge-unique-b-<node_id>`, name caption);
  - arrow = `merge-detail-arrow`;
  - right = `a_unique_sample` tiles (`merge-unique-a-<node_id>`, name caption).
    Shared members are represented by the reason/counts, not by a third tile column.
    Thumbnails come from `thumbnailMap`; unloaded samples stay placeholders (zero fabrication).
    Tiles use `aspect-ratio: 1` at roughly three quarters of the previous fill size; mobile
    keeps the same horizontal B → A direction.
- Bottom one-line reason (`merge-detail-reason`, single line with ellipsis): use
  `recommendation.reason` verbatim when present (arbiter band only), else the deterministic
  counts sentence from `overlap_count`/`merged_count` (`fileManager.mergeReason`, e.g.
  `41 of 58 files are shared; merging keeps them in one collection.`). No LLM call ever
  generates this sentence.
- The panel contains a close control only. It has NO action buttons: `Merge` / `Keep
separate` / `Later` live on every item and dispatch that item's id with the same `onAction`
  contract.

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
- [ ] Every item carries distinct `Merge`/`Keep separate`/`Later` actions that dispatch
      `onAction` with that row's `suggestion_id`; no dialog opens.
- [ ] `suggestions.length > 1` renders the centered footer text (no chip/badge), with
      `role="button"` + `aria-expanded`; expanding lists ALL rows in a viewport-bounded
      scrollable accordion, keeps the footer below the list, and shifts the collection grid
      down. The first row scrolls with the list.
- [ ] `suggestions.length === 0` ⇒ component tree contains no card DOM node.
- [ ] Desktop hover opens the detail panel after 200ms; leaving keeps it open for 300ms;
      pointer enter on the panel cancels the close; Esc/outside/close button closes.
- [ ] Mobile tap on the card body or an accordion row opens the detail; desktop accordion-row
      click is a no-op; Enter/Space opens from a focused body/row.
- [ ] Detail is inline immediately above/below the hovered row (never outside the accordion),
      shows only the title, then horizontal B-unique → arrow → A-unique tiles, then a bottom
      one-line reason; `recommendation.reason` wins when present, otherwise the deterministic
      counts sentence.
- [ ] Detail has no action buttons; the row's own actions remain clickable while it is open.
- [ ] `onRequestThumbnails` fires with the displayed sample node ids when a detail opens.
- [ ] E2E/BDD selector anchors (`data-testid`): `merge-proposal-card`, `merge-card-body`,
      `merge-card-actions`, `merge-more-toggle`, `merge-suggestion-list`,
      `merge-suggestion-row-<suggestion_id>`, `merge-detail-panel`, `merge-detail-title`,
      `merge-detail-tiles`, `merge-detail-arrow`, `merge-detail-reason`, `merge-detail-close`,
      `merge-unique-a-<node_id>`, `merge-unique-b-<node_id>`,
      `merge-accept`, `merge-keep-separate`, `merge-later`,
      `merge-row-accept-<suggestion_id>`, `merge-row-keep-separate-<suggestion_id>`,
      `merge-row-later-<suggestion_id>`.

### 2.11 Edge Cases

- Pair disappearing server-side (merged in another tab): next action absorbs a 404/409 into an
  error toast + slot refresh.
- `merged_count === overlap_count` (full containment is pre-filtered server-side; still
  renderable): grammar unchanged, reason sentence remains counts-derived.
- A detail panel open on a row that the host removes is closed by the suggestions-change
  effect; the next pending row becomes `suggestions[0]`.
- Sample arrays are capped server-side (8 shared / 4 per unique side); the card renders the
  capped view and never fabricates a remainder.
