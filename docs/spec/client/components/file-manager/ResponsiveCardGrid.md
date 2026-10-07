# ResponsiveCardGrid Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Shared responsive card-grid container extracted from `FileGrid` (§2.6 layout) — the single grid surface used by the file grid and the collections list cards. Renders full-width span children (cluster headers, merge slot, load-more sentinel) alongside card cells. |
| Used in            | FileGrid, CollectionsListView (list mode)                                                                                                                                                                                                                              |
| Related components | FileGridItem, CollectionCardItem, CardTile                                                                                                                                                                                                                             |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/ResponsiveCardGrid.js`
- **Test file:** `client/src/components/file-manager/__tests__/GridCardPrimitives.test.js`

### 2.2 Components

- `ResponsiveCardGrid` (default export): the grid container `Box`.
- `CardGridSpan` (named export): a full-width child (`gridColumn: '1 / -1'`) for rows that must
  break the column flow — cluster group headers, the merge-card slot, the load-more sentinel.
  Forwards a `ref` (FileGrid passes its `loadMoreRef`).

### 2.3 Props

| Name     | Type   | Required | Description                                                                                 |
| -------- | ------ | -------- | ------------------------------------------------------------------------------------------- |
| children | node   | Y        | Grid cells (card items) and `CardGridSpan` children, interleaved in DOM order.              |
| sx       | object | N        | Style overrides merged over the base grid styles (gap/columns stay the file-grid defaults). |
| ref      | ref    | N        | Forwarded container ref.                                                                    |

### 2.4 Layout (contract with FileGrid.md §2.6)

- **Container:** `Box` with `display: 'grid'`, `position: 'relative'`, `minHeight: 'auto'`.
- **Breakpoints:** identical to the extracted FileGrid container: `xs: repeat(2, 1fr)`,
  `sm: repeat(3, 1fr)`, `md: repeat(4, 1fr)`, `lg: repeat(6, 1fr)`,
  `xl: repeat(auto-fill, minmax(150px, 1fr))`; gap `1.5` at xs, `2` from md.
- Collections cards use the same container → grid parity with files.
- `CardGridSpan` children span the full row regardless of column count.

### 2.5 Rules

- Pure layout: no data logic, no IO, no callbacks. Children are host-provided nodes.
- Extracting it must not change FileGrid's rendered DOM (regression anchor:
  `FileGrid.test.js` passes UNCHANGED).
- Full-width children contract: cluster headers, the merge-card slot and the load-more sentinel
  render as `CardGridSpan` children — the container itself adds no extra wrappers.

### 2.6 Verification Scenarios

- [ ] Renders children inside a CSS-grid Box with the breakpoint columns.
- [ ] `CardGridSpan` renders a full-span row and attaches the forwarded ref.
- [ ] `sx` overrides merge without dropping the base display/gap styles.
