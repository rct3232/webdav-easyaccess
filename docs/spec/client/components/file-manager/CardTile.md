# CardTile Spec (P-3 extraction)

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Shared card-tile shell extracted from `FileGridItem` (its JSX body): MUI `Card` + square media area (absolute More-action overlay) + optional content area + `CardContent` footer + processing overlay. Selection is shown by the light primary card background (no checkbox) — files and collections cards share this visual language. |
| Used in            | FileGridItem (delegation), CollectionCardItem (composition)                                                                                                                                                                                                                                                                             |
| Related components | FileGridItem, CollectionCardItem, ResponsiveCardGrid                                                                                                                                                                                                                                                                                    |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/CardTile.js`
- **Test file:** `client/src/components/file-manager/__tests__/GridCardPrimitives.test.js`

### 2.2 Props

| Name                | Type     | Required | Default        | Description                                                                                                                                                                                                                                                                                                               |
| ------------------- | -------- | -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| media               | node     | N        | null           | Content of the square media area (thumbnail/icon, or a 2×2 preview grid for collection cards).                                                                                                                                                                                                                            |
| content             | node     | N        | null           | Optional custom area rendered between the media box and the footer (full-width, own layout).                                                                                                                                                                                                                              |
| footer              | node     | N        | null           | Content of the `CardContent` area (file: truncated basename; collection: name + meta/chips).                                                                                                                                                                                                                              |
| footerRef           | ref      | N        | -              | Attached to the `CardContent` (FileGridItem's ResizeObserver width tracking).                                                                                                                                                                                                                                             |
| showMoreButton      | boolean  | N        | false          | Render the absolute ⋮ button overlay on the media area.                                                                                                                                                                                                                                                                   |
| onMoreActivate      | function | N        | -              | `(event) => void` — invoked on click/touchend; the tile calls `stopPropagation` (and mobile touch suppression) so the card click never fires.                                                                                                                                                                             |
| moreButtonTestId    | string   | N        | -              | `data-testid` for the More button (collections: `card-menu-button-<id>`; files render none — DOM unchanged).                                                                                                                                                                                                              |
| moreButtonAriaLabel | string   | N        | 'More actions' | Accessible name of the More button.                                                                                                                                                                                                                                                                                       |
| moreAction          | node     | N        | null           | Pre-built More overlay (absolute top-right inside the media box; CollectionCardItem composes its own IconButton; FileGridItem delegates).                                                                                                                                                                                 |
| cornerBadges        | node     | N        | null           | (M-4, corner-dot placement 2026-10-01) Top-right CORNER dots: one or more `TileCornerBadge` nodes — 16px icon in a translucent circular plate with a 2px `background.paper` ring, anchored `top: -6; right: -6; z-index: 3` OUTSIDE the media edge so the plate floats past the tile boundary (notification-dot idiom, the ring is the visual gap). The More action keeps its inner `top:4/right:4` seat below the dots; pointer-events preserved for real-button badges. |
| isSelected          | boolean  | N        | false          | Light primary background (alpha 0.12); hover deepens it (parity with the pre-extraction FileGridItem styles).                                                                                                                                                                                                             |
| isDropTarget        | boolean  | N        | false          | Primary border/background highlight (file drag-drop only; collections never pass it).                                                                                                                                                                                                                                     |
| isDragging          | boolean  | N        | false          | Opacity 0.5.                                                                                                                                                                                                                                                                                                              |
| isDisabled          | boolean  | N        | false          | `not-allowed` cursor, dimmed, no hover shadow.                                                                                                                                                                                                                                                                            |
| isProcessing        | boolean  | N        | false          | Renders the top-right processing overlay (`CircularProgress` + `renderProcessingIcon(processingType)`).                                                                                                                                                                                                                   |
| processingType      | string   | N        | -              | Overlay icon type (`move \| copy \| delete`).                                                                                                                                                                                                                                                                             |
| selectionMode       | boolean  | N        | false          | Pointer cursor policy (desktop `move` only outside selection mode).                                                                                                                                                                                                                                                       |
| isMobile            | boolean  | N        | false          | Mobile touch/user-select styles.                                                                                                                                                                                                                                                                                          |
| isHidden            | boolean  | N        | false          | Opacity 0.5 (hidden recent entries).                                                                                                                                                                                                                                                                                      |

### 2.3 Rules

- The tile renders the exact DOM the pre-extraction `FileGridItem` rendered (Card → media Box →
  more button → optional content → CardContent → processing overlay); `FileGridItem` is a thin
  delegation over it and its `React.memo` comparator stays externally identical — the
  regression anchor is `FileGridItem.test.js` passing UNCHANGED.
- No data fetching, no callbacks beyond `onMoreActivate`, no i18n imports (labels pass through
  props).

### 2.4 Verification Scenarios

- [ ] media/footer/content slots render in order; footer lives in a `CardContent` with the
      shared padding contract (`p:1, pt:0.5, pb:1`, `&:last-child` pb override).
- [ ] More button: hidden by default, absolute top-right, click and touchend call
      `onMoreActivate` with propagation stopped; `moreButtonTestId`/`moreButtonAriaLabel`
      applied.
- [ ] `isSelected` background parity; `isDropTarget` border parity; processing overlay.
- [ ] (M-4) `cornerBadges` renders at the media Box's TOP-RIGHT corner, ring-offset (-6) with z-index above `moreAction` (dots of the
      `moreAction`); null ⇒ zero DOM delta for file tiles; button badges stay clickable
      (`stopPropagation` is the consumer's contract, the tile itself never gates pointer events).
- [ ] Mobile styles (`userSelect: none`, `touchAction: manipulation`) applied when `isMobile`.
