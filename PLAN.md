# WP-C Integration Plan (search zones, chip chain, accordion listing)

## Objective

Wire the docs-locked search results rework into the client: rewritten `useSearchResults`
chain/snapshot hook, zone composition, `SearchQueryChipBar`, accordion zones in
`FileManagerView`, shell wiring in `FileManager`, `AddToCollectionMenu` set-target mode,
i18n updates, `SearchBarResultsMode` deletion. TDD (RED first per AGENTS §2.1).

## Tasks (dependency graph)

| # | Task | Depends | Verification |
| --- | --- | --- | --- |
| T1 | locales: +5 keys (en+ko), -6 dead keys | — | jest locale readers green |
| T2 | `utils/localStorage.js`: get/setSearchZonesCollapsed ('wea.searchZonesCollapsed') | — | unit test |
| T3 | `explorerGateway.loadNodesMetadata` chunking ≤100 + onChunk + flag passthrough | — | gateway/fileService unit tests |
| T4 | rewrite `useSearchResults` (chain/snapshots/zones/enrichment/recents) | T3 | useSearchResults.test.js rewrite |
| T5 | `SearchQueryChipBar` component + test | — | component test + i18n mirror |
| T6 | `AddToCollectionMenu` targetNodeIds set-mode | — | component test |
| T7 | `FileManagerView` chip-bar swap + accordion zones + skeleton | T5 | view test rewrite |
| T8 | `FileManager` shell: hook inputs, FAB morph, exit-on-nav, union selection, library-add, llmConfigured | T2..T7 | pages/FileManager.test.js rewrite |
| T9 | delete SearchBarResultsMode.js + test; grep dead usages | T7 | full suite |
| T10 | gates: targeted jest, full `npm run test:ci`, eslint+prettier, docsStatePurity | all | all green |

## Scope

- Client only (server WP-S merged; metadata flags pass through `getFilesMetadata` raw — verify + pin).
- No E2E changes (WP-E), no new endpoints.

## Success criteria

- All client suites green with `--maxWorkers=1`; lint/prettier clean on touched files.
- Testids present: search-chip-bar, search-chip, search-chip-undo, search-chip-exit,
  search-chip-action, search-library-add, search-zone-header-a|b|c, search-zone-toggle-*,
  search-zone-skeleton, server-search-row-<id>.
