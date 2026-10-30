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

| Name                | Type     | Required | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | -------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| suggestions         | array    | Y        | -       | The pending `GET /merge-suggestions` rows in server order (score desc). `suggestions[0]` is the card body; `suggestions.slice(1)` are the footer accordion rows. Each row carries `suggestion_id`, `a_id/a_name` (survivor), `b_id/b_name` (absorbed), `overlap_count`, `merged_count`, `score`, `a_preview_items`/`b_preview_items` (collection-card previews), optional `recommendation`; the legacy `overlap_sample`/`a_unique_sample`/`b_unique_sample` fields remain in the payload but are NOT rendered by the detail. |
| onAction            | function | Y        | -       | `(suggestionId, action) => void`; `action` is `'merge' \| 'keep-separate' \| 'later'`. The card dispatches the clicked row's `suggestion_id`; the host resolves the pair and calls `mergePair` / `rejectMergeSuggestion` / `dismissMergeSuggestion`. The card closes its detail panel before dispatching.                                                                                                                                                                                                                    |
| thumbnailMap        | object   | N        | null    | Host-owned `Map<nodeId, url>` of already-loaded preview thumbnails (the shared collection-card preview cache); a preview id without an entry renders its file-type icon.                                                                                                                                                                                                                                                                                                                                                     |
| onRequestThumbnails | function | N        | -       | Called with the A/B `preview_items` node ids when a detail panel opens (`(nodeIds) => void`); absent ⇒ preview cells simply stay icon/placeholder.                                                                                                                                                                                                                                                                                                                                                                           |

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
- Buttons: icon-only `[Later(Snooze, gray)] [Keep separate(Block, gray)]
[Merge(MergeType, primary)]` in that order on EVERY item, with no button background or
  border. Each icon dispatches that item's id; the i18n label is both the aria-label and the
  tooltip. The first item keeps `merge-accept`/`merge-keep-separate`/`merge-later`; expanded
  items use `merge-row-<action>-<suggestion_id>`.
- Body/footer structure: each item is a summary line + its actions (the hover/tap/keyboard
  target is the text block); the footer is a separate full-width strip after the list.
- No thumbnail strip and no expand button: samples live in the detail panel (desktop hover /
  mobile tap). The body carries `role="button"`, `tabIndex=0`, `aria-expanded` and an
  Enter/Space keyboard path so the detail stays reachable without hover.
- Mobile: each item is a column — summary text on top, the three icon actions at the
  bottom. Desktop: summary left, actions right. Footer below the list.
- `recommendation` is never rendered on the collapsed card; its `reason` is the detail
  panel's one-line reason (§2.5).

### 2.4 Pending Accordion (footer)

- Renders only when `suggestions.length > 1`. The footer is centered TEXT (no chip, no badge),
  `role="button"`, `tabIndex=0`, `aria-expanded`, data-testid `merge-more-toggle`, and toggles
  the accordion on click or Enter/Space. Copy = `fileManager.mergeMore` with the count of
  remaining rows.
- Expanded accordion (`merge-suggestion-list`) lists ALL suggestions in server order,
  including the first item, as rows with the same question/count/actions UI. The list has a
  viewport-bounded `maxHeight` (`40vh` desktop / `50vh` mobile) with vertical scroll, so the
  first item scrolls with the rest. On mobile, `50vh` lets the common two-row set fit
  without clipping the second row at the footer; longer sets still scroll. When expanded,
  the list reserves bottom padding so the last row is never flush with or covered by the
  footer. The footer stays BELOW the scroll list at the bottom of the card.
- Row interaction: desktop click is a NO-OP (hover opens the detail); mobile tap opens the
  detail. A row's text block is keyboard-focusable and Enter/Space opens the detail. No
  active-pair selection state exists.

### 2.5 Detail Panel (non-modal)

- Opens on desktop hover with 200ms intent, or on mobile tap. There is NO expand button. The
  panel is rendered in a MUI Popper portal anchored to the hovered/tapped ITEM (never to the
  card), immediately below it (or immediately above it when the lower viewport half cannot
  fit). The portal sits outside the accordion and card, so the panel may extend beyond their
  scroll/clip bounds; it is never detached from the item or positioned at card level. It adds
  NO full-screen backdrop and does not follow the mouse. Item actions stay clickable.
- Close behavior: 300ms hover-out grace, cancelled by pointer enter on the panel; Esc;
  outside pointer-down; the panel's close button (`merge-detail-close`).
- Content: the title only (`mergeQuestion`, `merge-detail-title`), then two collection-card
  preview panels in B(absorbed) → A(survivor) order (`merge-detail-tiles`):
  - left = `b_preview_items` 2×2 preview (`merge-detail-preview-b`,
    cells `merge-preview-b-<node_id>`);
  - arrow = `merge-detail-arrow`;
  - right = `a_preview_items` 2×2 preview (`merge-detail-preview-a`,
    cells `merge-preview-a-<node_id>`).
    The previews match the collection list cards: up to 4 newest-added members, newest-first,
    **NO filename labels**, thumbnail when `thumbnailMap` has the node id, otherwise the
    same `getFileIcon(type, mime, name)` icon as the card, and the Collections glyph fallback
    when a side has no preview items. Each side's preview CONTAINER uses the grid-view media
    theme: `grey.100` background, `divider` 1px border, and the theme radius. The individual
    cells stay transparent with no per-cell border/background, matching the collection card
    media area. Unique/shared comparison tiles are retired from the detail. Mobile keeps the
    same horizontal B → A direction.
- Bottom footer (`merge-detail-footer`): a shared-file strip followed by the one-line reason
  (`merge-detail-reason`).
  - Shared strip (`merge-detail-shared-strip`): up to **3** shared-file tiles from
    `overlap_sample` (`merge-shared-<node_id>`), each a 24×24 mini tile with the same
    grid-view theme; when `overlap_count` exceeds the shown tiles, a `+N` caption
    (`merge-shared-more`) uses the TOTAL `overlap_count` (e.g. 7 shared → 3 tiles + `+4`,
    10 shared → 3 tiles + `+7`). No filenames are rendered on the mini tiles; thumbnails
    come from `thumbnailMap` with the generic file icon fallback.
  - Desktop: `[shared strip] [reason]` form ONE centered group; the strip and reason are
    centered together as a unit, with the reason ellipsizing when needed.
  - Mobile: two rows — the shared strip is centered on its row and the reason is centered
    on the row below.
  - No shared files ⇒ no strip; the reason keeps the row/full width.
  - Reason copy uses `recommendation.reason` verbatim when present (arbiter band only), else
    the deterministic counts sentence from `overlap_count`/`merged_count`
    (`fileManager.mergeReason`, e.g.
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

- **imports:** MUI Box/Card/IconButton/Paper/Popper/Tooltip/Typography, icons
  `Block`/`MergeType`/`Snooze`/`Close`/`ArrowForward`, `CollectionPreviewGrid` (shared with
  the collection cards), `useTranslation`, `utils/koParticleUtils.js` (pure particle picker),
  `hooks/useResponsive` (mobile tap vs desktop hover); **no** gateway/service imports
  (callbacks only — thumbnails arrive via `thumbnailMap`/`onRequestThumbnails` props).

### 2.9 i18n Keys

- `fileManager.mergeQuestion`, `fileManager.mergeOverlapCount`, `fileManager.mergeAfter`,
  `fileManager.mergeMore` (footer text), `fileManager.mergeAccept` (`Merge`),
  `fileManager.mergeKeepSeparate` (`Keep separate`), `fileManager.mergeLater` (`Later`),
  `fileManager.mergeReason` (deterministic counts sentence), `fileManager.mergeDetailsAria`
  (body/row keyboard label), `fileManager.mergePreview` (A/B preview group aria labels only),
  `fileManager.mergeSharedFiles` (shared strip aria label), `fileManager.mergeClose` (panel
  close aria)

### 2.10 Verification Scenarios

- [ ] One card for a non-empty set; top row is score-desc first; the same DOM node is reused
      when the set shrinks (no key remount).
- [ ] Every item carries the icon-only `Later(Snooze, gray) → Keep separate(Block, gray) →
Merge(MergeType, primary)` actions in that order, with no background/border; each
      dispatches `onAction` with that row's `suggestion_id`; no dialog opens.
- [ ] `suggestions.length > 1` renders the centered footer text (no chip/badge), with
      `role="button"` + `aria-expanded`; expanding lists ALL rows in a viewport-bounded
      scrollable accordion (`40vh` desktop / `50vh` mobile), keeps the footer below the
      list, and shifts the collection grid down. The first row scrolls with the list; a
      two-row mobile set clears the footer without requiring a scroll.
- [ ] `suggestions.length === 0` ⇒ component tree contains no card DOM node.
- [ ] Desktop hover opens the detail panel after 200ms; leaving keeps it open for 300ms;
      pointer enter on the panel cancels the close; Esc/outside/close button closes.
- [ ] Mobile tap on the card body or an accordion row opens the detail; desktop accordion-row
      click is a no-op; Enter/Space opens from a focused body/row.
- [ ] Detail is a portaled overlay anchored immediately above/below the hovered row; it may
      extend beyond the accordion/card clip but never becomes a card-level/detached panel.
      It shows only the title, then horizontal B-preview → arrow → A-preview 2×2 grids,
      then a bottom one-line reason; `recommendation.reason` wins when present, otherwise
      the deterministic counts sentence.
- [ ] Detail footer shows at most 3 shared tiles plus `+N` from `overlap_count`; desktop
      centers the strip+reason as one group, mobile centers the strip and reason on separate
      rows; no strip when the pair has no shared files.
- [ ] Expanded accordion keeps the last row clear of the footer when scrolled to the end.
- [ ] Detail has no action buttons; the row's own actions remain clickable while it is open.
- [ ] `onRequestThumbnails` fires with the A/B `preview_items` and shared `overlap_sample`
      node ids when a detail opens.
- [ ] E2E/BDD selector anchors (`data-testid`): `merge-proposal-card`, `merge-card-body`,
      `merge-card-actions`, `merge-more-toggle`, `merge-suggestion-list`,
      `merge-suggestion-row-<suggestion_id>`, `merge-detail-panel`, `merge-detail-title`,
      `merge-detail-tiles`, `merge-detail-preview-a`, `merge-detail-preview-b`,
      `merge-detail-arrow`, `merge-detail-footer`, `merge-detail-shared-strip`,
      `merge-detail-reason`, `merge-detail-close`,
      `merge-preview-a-<node_id>`, `merge-preview-b-<node_id>`,
      `merge-preview-a-empty`, `merge-preview-b-empty`,
      `merge-shared-<node_id>`, `merge-shared-more`,
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
