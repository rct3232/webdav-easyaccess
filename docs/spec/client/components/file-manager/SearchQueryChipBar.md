# SearchQueryChipBar Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Results-mode chip strip that REPLACES the breadcrumb row while search results mode is active: one chip per committed chain term (oldest→newest left→right), breadcrumb-identical styling, hover/tap-revealed `Undo` affordance per chip, `Exit` on the single chip, and a right-edge `LibraryAdd` button (add-to-collection for the full snapshot). |
| Used in            | `FileManagerView` (breadcrumb region swap in results mode — `FileManagerView.md` §3)                                                                                                                                                                                                                                                                |
| Related components | `useSearchResults` (chain state, snapshots — the host owns all of it), `AddToCollectionMenu` (library-add target), `Breadcrumb` (styling precedent + suppressed row)                                                                                                                                                                                |
| Must be            | IO-free presentational component: renders from props, emits intents. It never fetches, never touches storage, never decides the chain.                                                                                                                                                                                                              |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/SearchQueryChipBar.js`
- **Test file:** `client/src/components/file-manager/__tests__/SearchQueryChipBar.test.js`

### 2.2 Props

| Name           | Type                            | Required | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| terms          | string[]                        | Y        | -       | COMMITTED chain terms, oldest→newest. One chip per entry; live (unsubmitted) text never renders as a chip.                                                                                                                                                                                                                                                                                                                |
| isMobile       | boolean                         | Y        | -       | Platform variant (reveal interaction + LibraryAdd slot placement).                                                                                                                                                                                                                                                                                                                                                        |
| onRevertToStep | (index: number) => void         | Y        | -       | Chip `i` (0-based, `i < terms.length - 1`) activated → host reverts the chain to the snapshot taken after that step. No server call happens in the revert path (snapshot restore inside `useSearchResults`).                                                                                                                                                                                                              |
| onExit         | () => void                      | Y        | -       | Single-chip `Exit` activated → host exits results mode (`exitResults`).                                                                                                                                                                                                                                                                                                                                                   |
| onLibraryAdd   | (anchorEl: HTMLElement) => void | N        | -       | `LibraryAdd` click → host opens `AddToCollectionMenu` targeting the FULL current snapshot (`AddToCollectionMenu.md` §2.2 nodeIds-set target mode). Absent ⇒ the button is not rendered (callback-withhold idiom).                                                                                                                                                                                                         |
| onSave         | () => void                      | N        | -       | Save affordance click → host saves the current results as a collection (the §2.6 boundary — `useSearchResults.md` §2.3 `saveFromResults`). Absent ⇒ the button is not rendered; the host computes the gate (`semantic_available:true` AND a non-empty semantic section — `routes/search.md` §2.4 field rules) plus the admin operator withhold, so the component renders the affordance exactly when the callback exists. |

### 2.3 Chip rendering and interaction

- **Strip position:** the breadcrumb row area; while results mode is active `Breadcrumb` is not rendered (`FileManagerView.md` §3). Horizontal scroll for long chains follows `Breadcrumb.md` §2.9 edge behavior.
- **Chip styling:** identical to breadcrumb items — same corner radius, same height, same separator chevrons between chips. Each chip's minimum width fits `돌아가기` + the undo icon (EN canonical `Undo`).
- **Reveal interaction:**
  - Desktop: hovering a chip replaces its content with the `Undo` label + undo icon; leaving restores the term text.
  - Mobile: first tap on a chip shows the `Undo` reveal; second tap activates it.
- **Activation:** clicking chip `i` (with `i < n`, `n = terms.length`) reverts the committed chain to the snapshot taken after step `i`; chips after it are discarded (their terms leave the strip). `onRevertToStep(i)` is the only emission.
- **Current chip (chip `n`, rendered when `n >= 2`):** plain term text, no affordance, no reveal.
- **Single chip (`n === 1`):** hover/tap reveals `종료` (EN canonical `Exit`) + close icon instead of `Undo`; activating calls `onExit` — results mode exits entirely.

### 2.4 LibraryAdd button

- **Desktop:** square button at the right edge of the chip strip, corner radius identical to the breadcrumb chips, `LibraryAdd` icon, aria-label `fileManager.searchLibraryAdd`.
- **Mobile:** occupies the breadcrumb expand-toggle slot; the expand toggle is not rendered in results mode (`FileManagerView.md` §3).
- **Action:** click calls `onLibraryAdd(anchorEl)`. The target is the FULL current snapshot node-id set (Zone A ∪ Zone B ∪ Zone C unique ids of the current chain step) — independent of the live filter text and of infinite-scroll paging. The host resolves the set; the component never sees rows.

### 2.4a Save affordance

- **Placement:** icon button at the right edge of the chip strip, before `LibraryAdd`; same 44px square / corner-radius idiom as `LibraryAdd`, `BookmarkAdd` icon, aria-label `fileManager.searchSaveCollection`.
- **Visibility:** rendered only when `onSave` is provided (absent-not-disabled — never rendered grayed). The save GATE is host-owned (`useSearchResults.md` §2.3): `semantic_available:true` AND a non-empty semantic section (`routes/search.md` §2.4 field rules), plus the admin operator withhold — unavailable or empty ⇒ the host passes no callback ⇒ the button is absent.
- **Action:** click calls `onSave()` with no arguments and no other emission.

### 2.5 Callback Signatures

| Callback       | When invoked                   | Arguments   |
| -------------- | ------------------------------ | ----------- |
| onRevertToStep | Revealed chip activated (n>=2) | (chipIndex) |
| onExit         | Revealed single chip activated | -           |
| onLibraryAdd   | LibraryAdd button click        | (anchorEl)  |
| onSave         | Save affordance click          | -           |

### 2.6 Dependencies

- **imports:** React, useState (reveal state only), useTranslation, MUI Box/Typography/IconButton, undo/close/LibraryAdd icons.
- **Forbidden:** services, gateways, `useSearchResults`, storage, router hooks.

### 2.7 Test seam (E2E ids)

- Strip container `data-testid="search-chip-bar"`; each chip `data-testid="search-chip"` (order = chain order); the revealed action renders inside the chip as `data-testid="search-chip-action"` (label `Undo`/`Exit`); the library button `data-testid="search-library-add"`; the save button `data-testid="search-chip-save"`.

### 2.8 i18n Keys

- `fileManager.searchChipUndo` (`Undo` / `돌아가기`), `fileManager.searchChipExit` (`Exit` / `종료`), `fileManager.searchLibraryAdd` (aria-label), `fileManager.searchSaveCollection` (`Save as collection` / `컬렉션으로 저장`)

### 2.9 Verification Scenarios

- [ ] `n` terms render `n` chips oldest→newest; live unsubmitted input text never appears.
- [ ] `n >= 2`: chip `i < n` reveals on hover (desktop) / tap-then-tap (mobile) and calls `onRevertToStep(i)` once on activation; chip `n` renders plain (no affordance).
- [ ] `n === 1`: reveal shows `Exit` + close icon; activation calls `onExit`, never `onRevertToStep`.
- [ ] LibraryAdd renders desktop at the strip's right edge / mobile in the expand-toggle slot; click emits `onLibraryAdd` with the anchor element and no other callback.
- [ ] The save affordance renders only when `onSave` is provided; click emits `onSave()` alone; without the callback it is absent from the DOM (never disabled).
- [ ] No fetch, storage or gateway call from any interaction (IO-free check).
- [ ] Chip and button styling reads the breadcrumb corner radius/height (class-level assertion, not pixel values).

### 2.10 Edge Cases

- Empty `terms` (results mode never enters with an empty chain — `useSearchResults` commits the first term at submit): renders nothing.
- Very long term text: chip truncates middle-style (`pixelMiddleTruncate`) while keeping the minimum reveal width.
- Repeated activations never call the server: every emission is a synchronous host intent; revert/exit are snapshot operations.
