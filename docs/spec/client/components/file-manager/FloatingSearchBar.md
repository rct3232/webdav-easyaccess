# FloatingSearchBar Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Floating search pill fixed to the left of the FAB. On focus (or while results mode is active) the FAB spot morphs into a 56px ghost search button that IS the submit action; the pill's start icon collapses into the input area. Unified behavior for mobile and desktop: always visible, no toggle. |
| Used in            | FileManager                                                                                                                                                                                                                                                                                           |
| Related components | FAB (morph partner — the FAB becomes controlled-mount), `useSearchResults` (mode state owner; this bar only emits intents), `SearchQueryChipBar` (results-mode companion surface), `MemberStateBadges.js` (icon-overlay precedent)                                                                    |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FloatingSearchBar.js`
- **Companion:** `client/src/components/file-manager/SearchActionButton.js` (the fab-slot ghost submit button rendered by this bar; shared FAB gradient fills live in `client/src/components/file-manager/fabGradient.js`)
- **Test file:** `client/src/components/file-manager/__tests__/FloatingSearchBar.test.js` (+ `__tests__/SearchActionButton.test.js`)

### 2.2 Props

| Name              | Type     | Required | Default                    | Description                                                                                                                                                                                                                  |
| ----------------- | -------- | -------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| searchQuery       | string   | Y        | -                          | Search input value (shared with the explorer session filter text)                                                                                                                                                            |
| setSearchQuery    | function | Y        | -                          | Set search query                                                                                                                                                                                                             |
| isMobile          | boolean  | Y        | -                          | Mobile layout (affects width)                                                                                                                                                                                                |
| placeholder       | string   | N        | t('nav.searchPlaceholder') | Placeholder text (i18n)                                                                                                                                                                                                      |
| fabVisible        | boolean  | N        | true                       | When false, search bar expands to occupy FAB space. In FileManager this mirrors actual FAB presence (FAB self-reports via `onVisibilityChange`), not an enumerated condition                                                 |
| onSubmitQuery     | function | N        | -                          | `(query: string) => void` submit intent: the 56px search button click and Enter both invoke it. Absent ⇒ no server-wide search surface (share-link mode)                                                                     |
| resultsModeActive | boolean  | N        | false                      | Pure visual state: the search button stays mounted with the `Add` icon overlay, and blur no longer collapses. The bar renders; it never decides the mode.                                                                    |
| isPending         | boolean  | N        | false                      | A search submit is in flight: the button glyph runs the orbit animation (§2.5)                                                                                                                                               |
| llmConfigured     | boolean  | N        | false                      | AI-platform flag (settings/public flags surface, read through the existing client repository seam by the host): selects the button glyph composite (§2.5)                                                                    |
| onExpandedChange  | function | N        | -                          | `(isExpanded: boolean) => void` morph-truth signal for the host (drives the FAB controlled-mount swap): true while the fab slot is owned by the search button; always false when `onSubmitQuery` is absent (share-link mode) |

### 2.3 Callback Signatures

| Callback         | When invoked                                                    | Arguments             |
| ---------------- | --------------------------------------------------------------- | --------------------- |
| setSearchQuery   | Input change; `''` also from the ✕ press (the host exit signal) | (string)              |
| onSubmitQuery    | Search-button click / Enter                                     | (query text)          |
| onExpandedChange | Morph truth change (focus, results mode, text, submit surface)  | (isExpanded: boolean) |

### 2.4 Layout

- **Position:** `position: fixed`, bottom-aligned with FAB; the pill itself stays in place through the whole morph.
- **Widths/offsets (unchanged constants):** Desktop: `width: 300px`, `right: offset + FAB_SIZE + GAP` (116px); Mobile: `left: offset`, `right: offset + FAB_SIZE + GAP` (84px). Height 56.
- **When !fabVisible:** search bar expands to occupy FAB space: `right: offset` (16px mobile, 48px desktop) with `transition: right 0.25s ease-out`.
- **Bottom offset:** Same as FAB (16px mobile, 48px desktop)
- **Z-index:** 1045 (below FAB 1050)
- **Safe area:** `paddingBottom: env(safe-area-inset-bottom)` for iOS
- **Test seam:** outer container exposes `data-testid="floating-search-bar"` for visibility/expansion assertions.

### 2.5 FAB ↔ search-button morph

- **Trigger:** input focus, non-empty text, or results mode active — the component's `expanded` visual state. On collapse (blur with empty text in browse mode, or §2.7 ✕ paths) the swap reverses; collapse is gated on empty text AND browse mode.
- **Swap mechanics:** the FAB element is replaced IN ITS EXACT spot by the search button — a 56px circle at the same position (`SearchActionButton.js`, rendered by this bar; the FAB receives its hide signal through the host via `onExpandedChange`). The transition is a 2-phase fade/scale (FAB fades/scales out, button fades/scales in) and reverses on collapse. The FAB becomes controlled-mount: it stays mounted while it animates out instead of unmounting instantly (`FAB.js` mounts it through the morph). The button only exists while the submit surface exists (`onSubmitQuery` present).
- **Users without write permission:** the FAB is absent; the search button occupies the same spot on focus (`FAB.md` §2.6 self-hide).
- **Button visual (ghost):** 2px border `#52c597` + frosted translucent fill matching the pill interior (`rgba(255,255,255,0.5)` + blur); hover = the original FAB gradient fill.
- **Start-icon collapse/expand:** the pill's `SearchIcon` start adornment fades out on focus and the input area grows into that space (smooth width/opacity transition). On blur with empty text (and browse mode) the icon returns.
- **Test seams:** `search-start-icon` (collapsing adornment box — width/opacity), `search-action-button` (the fab-slot button), `search-glyph` (composite svg root), `search-action-glyph-cloud|search|wand|add|orbit` (composite parts — `SearchGlyphIcon.js`, the knockout-stroke shared component; the Zone B/C results headers use plain `Cloud`/`AutoAwesome` icons instead).

### 2.6 Button icon states

| State                                        | Glyph                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `llmConfigured=false`                        | knockout composite: filled cloud cut along a STROKE-style magnifier (circle + handle) at the cloud's top-right                                                                                                                                                                                                                                                                                               |
| `llmConfigured=true`                         | knockout composite: cloud cut along the mirrored wand-stars cluster (AutoAwesome sparkle geometry, `scaleX(-1)`)                                                                                                                                                                                                                                                                                             |
| `isPending=true` (either flag)               | the composite stays intact; the overlay AND its knockout cut travel together along a counter-clockwise circle that starts and ends at the overlay's home spot (its 3-o'clock point, radius 4.5u) while the cloud stays still — the piercing reads throughout the sweep; the glyph stays upright; the svg overflows its viewBox at the top of the sweep; no animation-state E2E assertions, final states only |
| results mode, input text empty               | the same composite plus a stroke `Add` plus knocked into the cloud's top-left                                                                                                                                                                                                                                                                                                                                |
| results mode, input text empty, button click | no-op — the button keeps its enabled visual state and fires nothing                                                                                                                                                                                                                                                                                                                                          |
| results mode, input text non-empty, click    | chain submit (`onSubmitQuery`)                                                                                                                                                                                                                                                                                                                                                                               |

**Composite geometry:** one `SvgIcon` (viewBox 0 0 24 24): the filled cloud path carries an SVG `<mask>` whose black stroke geometry (overlay lines widened by clearance) cuts the cloud along the overlay's line shape; the overlay strokes render on top — over cloud the line sits inside its gap, over background it renders as a plain line. No plate circles, no outer ring on the magnifier. Each mounted instance generates its mask id from `useId` (button + headers never collide). Shared component `SearchGlyphIcon.js` (props `llmConfigured`, `showAdd`, `orbit`).

### 2.7 Submit and end-cluster

- **No submit control inside the pill.** The 56px circle IS the submit action; Enter in the input also submits (`onSubmitQuery(current text)`).
- **Native clear affordance suppressed:** the browser-native cancel button/decoration of the `type="search"` input is hidden via CSS; the custom ✕ is the single clear affordance.
- **Typing unchanged:** every keystroke routes through `setSearchQuery` only — no server call.
- **Input resets:** a successful commit clears the field (the term moves to the chip strip — `useSearchResults.md` §2.3 `onCommit`), and every results-mode exit resets it (shell exit seam). The field is therefore empty whenever results render or after leaving them.
- **Close (✕) adornment:** rendered while text is non-empty. Pressing ✕ clears the text AND blurs the input (focus removed):
  - browse mode → collapse back to browse visuals (icon returns, FAB returns);
  - results mode → the clear+blur exits results mode (the ✕ press is one of the host exit triggers — `useSearchResults.md` §2.3 `exitResults`) and returns to browse.
- **Share-link mode:** `onSubmitQuery` is not passed and submit stays disabled (server-wide search is an authenticated-explorer feature; unauthenticated share visitors keep the disabled submit as today).
- **Escape key:** no behavior (not required).

### 2.8 Keyboard and touch behavior

- Enter (desktop and mobile soft keyboard) submits through `onSubmitQuery`; it never blurs-and-submits anything else.
- Blur fires only from focus loss; the bar does not decide mode transitions beyond emitting the clear (§2.7) — results-mode entry/exit lives in `useSearchResults`.
- Touch: the 56px button is a standard IconButton target; no long-press semantics.

### 2.9 Styling

- **Outline:** AppBar/FAB-style layered radial + linear gradient border (same palette as FAB) via CSS mask (gradient only on border, interior cut out)
- **Pill shape:** `borderRadius: 9999px`
- **Interior:** Matte frosted glass `rgba(255,255,255,0.5)` with `backdrop-filter: blur(12px)`

### 2.10 Dependencies

- **imports:** React, useTranslation, MUI TextField, InputAdornment, IconButton, Box; Search, Close; the submit-button glyph comes from `SearchActionButton`/`SearchGlyphIcon` (custom knockout SvgIcon).
- **Reference implementation:** `client/src/components/file-manager/FloatingSearchBar.js`

### 2.11 i18n Keys

- `nav.searchPlaceholder` – search placeholder

### 2.12 Scroll Padding Coordination

- FileManager scroll container uses `padding-bottom` equal to floating area height (offset + FAB_SIZE) + safe-area when FloatingSearchBar is visible, so the last list item can scroll up above the search bar. See `FLOATING_BOTTOM_HEIGHT_MOBILE` / `FLOATING_BOTTOM_HEIGHT_DESKTOP` in `constants/fileManager.js`.

### 2.13 Verification Scenarios

- [ ] Renders search input with placeholder; setSearchQuery called on input change with no fetch.
- [ ] Focus morphs the FAB spot into the ghost search button (final states asserted, not the animation); blur-with-empty-text in browse mode restores the FAB.
- [ ] Enter and the 56px button click each call `onSubmitQuery` once with the current value; typing alone never calls it.
- [ ] Without `onSubmitQuery` (share link), button/Enter are inert/disabled.
- [ ] `resultsModeActive` changes visuals only — no behavior branch reads it besides the mount/blur rules in §2.5/§2.7.
- [ ] ✕ with non-empty text: clears text AND removes focus; in results mode it exits results mode (host effect).
- [ ] Results mode + empty text: button shows the `Add` overlay and click is a no-op (no `onSubmitQuery` call).
- [ ] `llmConfigured` switches the overlay variant; `isPending` keeps the composite intact with the overlay orbiting (cloud testid present in both states).
- [ ] Desktop: fixed 300px width; Mobile: full width between left margin and FAB area; `!fabVisible` expansion unchanged (`floating-search-bar` test seam).

### 2.14 Edge Cases

- FAB hidden for any reason (selection mode, no write permission, read-only views such as recent/shared/trash, parent unmount): search bar expands to occupy FAB space (right: offset); on focus the search button still renders in that same spot. The expansion is driven by the FAB's self-reported visibility, so it can never drift out of sync with the FAB.
- Initial state in FileManager: `fabVisible` starts false (FAB not yet mounted); the bar animates back to the FAB-adjacent position when the FAB mounts.
- Results mode + focus lost with text present: the button stays mounted with the `Add` overlay (collapse is gated on empty text AND browse mode).
- Share link mode: shown whenever FileManager file list is visible.
