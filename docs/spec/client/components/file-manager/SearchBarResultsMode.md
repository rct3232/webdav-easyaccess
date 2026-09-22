# SearchBarResultsMode Spec

Target-contract spec.

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Results-mode header + section rendering for server-wide search: breadcrumb-row header `🔍 "query" · N results [Save as collection][✕]` and the two-section result list (name_matches with client highlights, semantic without). Companion of `useSearchResults` (state) and `FloatingSearchBar` (input). |
| Used in            | FileManager page shell (replaces the normal breadcrumb row while `mode === 'results'`)                                                                                                                                                                                                                   |
| Related components | FloatingSearchBar, FileList row components (result rows), useCollections/dialog host (save confirm), Breadcrumb (replaced surface)                                                                                                                                                                       |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/SearchBarResultsMode.js`
- **Test file:** `client/src/components/file-manager/__tests__/SearchBarResultsMode.test.js`
- **Decision:** spec/component name follows the plan's surface name ("results mode"); it is a header+sections chrome component, not a replacement of FloatingSearchBar's input.

### 2.2 Props

| Name                      | Type     | Required | Default | Description                                                                                                                                         |
| ------------------------- | -------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| query                     | string   | Y        | -       | Submitted query (rendered quoted)                                                                                                                   |
| counts                    | object   | N        | -       | `total` drives `N results`; truncation flags render silently                                                                                        |
| sections                  | object   | Y        | -       | `{ nameMatches, semantic }` prepared rows (highlight ranges attached; rows enriched to explorer entries by the host via `POST /api/files/metadata`) |
| canSaveToCollection       | boolean  | Y        | -       | **Button visibility rule (§4.6):** single `[Save as collection]` button; hidden (absent, no gray state) when semantic empty/unavailable             |
| onSave                    | function | N        | -       | Opens the save confirm flow (§2.4)                                                                                                                  |
| onExit                    | function | Y        | -       | `✕` → back to normal listing                                                                                                                        |
| recentQueries             | array    | N        | []      | Chips row beneath the header; each chip `⋮` menu: `re-search` / `Save as collection`                                                                |
| onChipSelect / onChipSave | fn       | N        | -       | `(chip) => void` re-run / save (`⋮ → save` = §4.6 chip rule)                                                                                        |
| onFilterChange            | function | Y        | -       | Typing while in results mode (inline re-filter of loaded results)                                                                                   |

### 2.3 Header Grammar

- `🔍 "query" · N results [Save as collection][✕]` — exactly ONE action button, no dropdown (§4.6). NL chat-parser (future) extends this same header with a structured-predicate tab — additive slot reserved, nothing renders now (§4.22).
- Desktop: replaces the breadcrumb row; mobile: renders above the list (no breadcrumb exists there). **Decision.**
- Section display rules: empty section renders nothing (no header, no "0 results" block); both empty ⇒ single `fileManager.searchNoResults` line + chips remain.

### 2.4 Save-to-Collection Flow (host contract)

- Click opens the confirm dialog (invariant 5) reused from the seed dialog surface (§4.5): editable name (default = query text verbatim, §4.10) + member preview + the §4.5 initial-batch publish copy line. Name-match rows NEVER enter the definition; saved set = semantic portion only (flattening: semantic-section snapshot + centroid from the replayed signature, §4.22).
- `result_ref` is stored opaquely by the host for the create request (client treats it as a black box, search.md Decision).

### 2.5 Dependencies

- **imports:** MUI chips/buttons/typography, useTranslation, row components; **no** services/gateway.

### 2.6 i18n Keys

- `fileManager.searchResultsCount` (`N results`), `fileManager.searchSaveCollection` (`Save as collection`), `fileManager.searchExit` (aria), `fileManager.searchNoResults`, `fileManager.searchChipMenu` (`re-search`/`Save`)

### 2.7 Verification Scenarios

- [ ] Header renders query, count from `counts.total`, single save button, exit button.
- [ ] `canSaveToCollection=false` ⇒ save button absent from DOM (both "empty section" and "unavailable" cases).
- [ ] Highlights render ONLY on name-section rows; semantic rows show score-free plain names.
- [ ] Chips render recent queries; `⋮` exposes re-search/Save.
- [ ] Typing updates `filterText` without a server call (assert callback, not fetch); Enter triggers re-submit via host.
- [ ] `✕` invokes `onExit` and normal breadcrumb/listing reappear (host state).

### 2.8 Edge Cases

- `counts.total` vs displayed rows after inline filter: header shows the SERVER count; filtered view shows the client subset (honesty rule — no count rewrite).
- Long query in narrow mobile width: header truncates the quoted query middle-style, buttons never wrap away.
