# useSearchResults Spec

Target-contract spec.

## 1. Overview

| Item                     | Description                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Search **results-mode** controller: distinguishes typing (client inline filter, unchanged) from Enter-submit (server `POST /api/search`), owns the two-section result state (`name_matches` + `semantic`), query chips, highlight ranges, and the save-to-collection visibility rule. |
| Used by components/pages | `FileManager` page shell (results-mode overlay), `SearchBarResultsMode`, `FloatingSearchBar` (submit hook)                                                                                                                                                                            |
| Does not own             | Listing inline filter outside results mode (`useExplorerSession`), collection creation IO (`useCollections`/gateway), toast/undo (`useUndoToast`), semantic scoring/dedup (server `search.md`)                                                                                        |

---

## 2. Implementation Spec

### 2.1 File Path

- **Scope:** Page-local — **Source:** `client/src/pages/FileManager/hooks/useSearchResults.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useSearchResults.test.js`
- **Decision:** spec in `docs/spec/client/hooks/` (useRecentFile placement precedent).

### 2.2 Input Parameters

| Name       | Type     | Required | Description                                                               |
| ---------- | -------- | -------- | ------------------------------------------------------------------------- |
| showError  | function | Y        | User-visible error feedback                                               |
| gateway    | object   | N        | `runSearch` + `createCollection` seams (`explorerGateway` §2.6)           |
| onUndoable | function | N        | Forwards save-to-collection `undo.action_id` to the undo-toast controller |

### 2.3 Return Value / State

| Key                     | Type                                       | Meaning                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mode                    | `'filter' \| 'results'`                    | `results` only after Enter/icon submit; ✕ or empty input returns `filter`                                                                                                               |
| submittedQuery          | string \| null                             | The query that produced the loaded result set                                                                                                                                           |
| filterText              | string                                     | Typing while in `results`: re-filters the LOADED results inline (same substring rule as the listing filter); Enter re-queries                                                           |
| nameMatches             | Array<{ node_id, name, highlights }>       | Section 1 rows + client-side computed highlight ranges (pure helper `utils/searchHighlight.js`)                                                                                         |
| semantic                | Array<{ node_id, name, score }>            | Section 2 rows, already de-duplicated server-side; no highlights (§4.6)                                                                                                                 |
| counts / resultRef      | object / string                            | `counts` for the header `N개 결과`; `result_ref` kept opaque (§4.22)                                                                                                                    |
| displaySections         | `'both' \| 'name' \| 'semantic' \| 'none'` | Pure display rule: empty section is not rendered (no empty headers)                                                                                                                     |
| canSaveToCollection     | boolean                                    | **Visibility rule (§4.6):** `semantic_available === true` AND `semantic.length > 0`; false ⇒ the `[컬렉션으로 저장]` button is HIDDEN (absent, not disabled)                            |
| recentQueries           | Array<{ id, query, resultRef? }>           | Chips of recent queries (max 8, newest first; **Decision:** `sessionStorage`, cleared on logout)                                                                                        |
| submitSearch            | `(query) => Promise<void>`                 | Trims, guards 1–200 chars client-side (mirrors server 400s), calls `runSearch`, enters `results`                                                                                        |
| exitResults             | `() => void`                               | Clears result state, keeps filter text behavior normal                                                                                                                                  |
| saveResultsToCollection | `(name) => Promise<payload ∥ null>`        | Confirm dialog is host-rendered; creates `origin='search'` from the semantic snapshot only (§4.6/§4.22 flattening — name-match rows never enter the definition); success → `onUndoable` |
| saveChipQuery           | `(chip) => Promise<void>`                  | `⋮ → save` on a chip: re-runs that query (always-replay Q7) then enters the same save flow                                                                                              |

### 2.4 Dependencies

- **Must route IO through:** `explorerGateway` §2.6 (`runSearch`, `createCollection`).
- **May use:** pure helpers only for filter/highlight math (`searchHighlight.js` — **Decision:** its util spec is added at implementation time; ranges are computed client-side, the server never returns markup offsets).
- **Must not use:** `fetch`, `sessionStorage` directly (**Decision:** recent-query persistence goes through a tiny browser-storage adapter seam inside the gateway layer, not this hook).

### 2.5 Side Effects

- Server call ONLY on submit (typing never calls the API — §4.6 two-stage rule).
- `usage_events(search_hit)` logging is a server side effect of the response; the client does nothing extra.
- Results-mode entries/exits do not touch the explorer listing state (`useFileManager` unaffected).

### 2.6 Error Handling

- `runSearch` → `null` (transport/5xx): `showError` (`serverErrors.search.fail`), stay in prior mode.
- 400 cases are pre-guarded client-side; if still returned, map `serverErrors.search.queryRequired/queryTooLong` via error envelope.
- `semantic_available:false` with `semantic_unavailable_reason` is a SUCCESS payload — render section 1 only, hide the save button; never an error toast (§4.12).

### 2.7 Verification Scenarios

- [ ] Typing never calls `runSearch`; Enter does.
- [ ] Typing in results mode filters loaded rows inline; Enter re-queries.
- [ ] `canSaveToCollection` false when semantic empty OR `semantic_available` false; true otherwise.
- [ ] Highlight ranges appear only on `nameMatches` rows; semantic rows carry `score`, no highlights.
- [ ] `exitResults` returns to `filter` mode and clears result state.
- [ ] Save creates exactly one collection with the semantic-only definition payload; success triggers `onUndoable`.
- [ ] Absorbed search failure produces `showError` and leaves the previous result set intact.

### 2.8 Edge Cases

- Dedup: a node in both server sections arrives only under `name_matches` (server contract) — client must not re-add it.
- `counts.name_truncated:true` / `semantic_capped_segments:true`: render as-is, no client warnings (§4.6 display honesty).
- Identical query re-submitted: chip not duplicated (normalized query dedup).
