# nearDupFinderService Spec

Target-contract spec (vector variant of the hygiene items). Design owner sections:
`docs/features/storage-management.md`.

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role       | Vector near-duplicate finder — the §4.17 vector variant over the canonical pooled embeddings of the ACTIVE embed model. Read-only compute; feeds the Storage-dashboard `near_duplicates` block and the `near_dup` suggestion rows. Exact duplicates are NEVER detected here — hash-first (`dupFinderService.md`) owns them, and hash-twin nodes are removed from the vector pass entirely (cosine-1.0 detection is redundant). |
| Boundaries | No persistence (proposals ride `storage_suggestions` — a separate store/route surface; this service computes groups on demand). No LLM call (embeddings are precomputed canonical rows). Files only; requester's OWN root subtree (hygiene is self-storage — same scope rule as `dupFinderService.md` §1).                                                                                                                     |
| Threshold  | `θ_dup` is read from the ACTIVE embed model's manifest profile (`presets.js` `profile.thetaDup` — EG2 0.955, `llmPresets.md` §2.2/§2.3). Never hardcoded at call sites. Model absent / profile without a finite `thetaDup` / no scoped canonical rows ⇒ `available: false` (absent section, never an error — §4.12 AI-absence-is-data).                                                                                        |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/domains/ai/nearDupFinderService.js`
- **Test file:** `server/domains/ai/__tests__/nearDupFinderService.test.js`

### 2.2 Main functions

| Function                                                         | Returns                                               | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `findNearDuplicateGroups(userId)`                                | `{ available, groups[], groupCount, duplicateCount }` | Own-root subtree LIVE file rows (`fileNodesStore.listSubtreeCacheRows` — directories/trashed excluded by the store read, `dupFinderService.md` §2.2 scope). **Hash-first precedence:** nodes sharing a non-NULL `content_hash` with ≥ 1 other scoped file are removed from the vector candidate set BEFORE grouping — an exact-dup member never appears in near-dup output. Grouping = connected components over candidate pairs with cosine ≥ `θ_dup`; edges come from the vectorStore seam (`TextVectorJs` engine bound to the active model id; per-node `neighbors(own vector)` with the self id and non-candidates excluded ENGINE-side — a node never matches itself). Scores are f64 `vectorMath.cosineSimilarity` over canonical TEXT rows (exact≡oracle convention, `vectorStore.md` §2.6); POOLED rows only, no chunk rows. Group = `{ score (best pairwise cosine), nodeIds[] (asc), filePaths[] (aligned), sizeBytes[] (aligned), pairScores[] }` where `pairScores` lists EVERY member pair (both edge and transitive/non-edge pairs) as `{ nodeA, nodeB, score }` with `nodeA < nodeB`, ascending `nodeA` then `nodeB`. The service computes membership only — it exposes no keeper; keeper selection (quality composite, `storageService.md` §2.5) is a consumer concern and `pairScores` is the centrality input it needs. Groups ordered by best `score` desc, tie by smallest node id asc; capped at `MAX_NEAR_DUP_GROUPS` (50 — operational constant, `routes/storage.md` §2.4). `duplicateCount` = Σ members across the RETURNED groups (mirrors the exact-dup counting). No `reclaimableBytes` — near-dup members differ in bytes, nothing is reclaimable by identity. |
| `createNearDupFinderService(deps)` + `getNearDupFinderService()` | factory + shared default instance                     | DI seams `{ fileNodesStore, embeddingsStore, llmModelsStore, presets }` resolved lazily (searchService precedent); tests inject fakes, production resolves the shared stores/presets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

- Empty/degraded result: no active embed model (`llmModelsStore.getActiveByRole('embed')` → null),
  or the resolved preset profile has no finite `thetaDup`, or the scoped canonical pooled set has
  fewer than 2 rows ⇒ `{ available: false, groups: [], groupCount: 0, duplicateCount: 0 }`.
  With embeddings present and no pair ≥ `θ_dup` ⇒ `available: true` with empty groups (zeros, not
  absence — the distinction is honest state, §4.12).
- Pure READ — idempotent: two consecutive calls on unchanged data return deep-equal results.
- No route of its own; consumed by [storageService](storageService.md) via the mounted
  `GET /api/storage`.

### 2.3 Errors & transactions

- Read-only; store errors map through the repository layer unchanged. AI absence is never
  an error (§4.12): the degraded `available: false` shape is data.

### 2.4 Dependencies

- `fileNodesStore.getUserRootNode` + `listSubtreeCacheRows` (ACL scope —
  `docs/spec/server/store/fileNodesStore.md`)
- `llmModelsStore.getActiveByRole('embed')` (active model row = the space key)
- `embeddingsStore.listAll(modelId)` (canonical pooled TEXT rows,
  `docs/spec/server/store/embeddingsStore.md`)
- `presets.getPresetByFamilyRole(model.provider, 'embed')` → `profile.thetaDup`
  (`docs/spec/server/infrastructure/llmPresets.md` §2.2a)
- `domains/ai/vectorStore/TextVectorJs` + `vectorMath` (sanctioned scoring path,
  `docs/spec/server/infrastructure/vectorStore.md` §2.2/§2.6)

### 2.5 Verification Scenarios

- [ ] Threshold band: a pair at cosine ≥ `θ_dup` forms a group; a pair just below `θ_dup`
      does not (test vectors constructed relative to the profile constant, never a hardcoded
      threshold — grep)
- [ ] Hash-first: an equal-`content_hash` pair (even cosine 1.0) never surfaces as near-dup;
      a hash-twin member cannot drag a non-twin node into a near-dup group
- [ ] Self-exclusion: a node never matches itself; a single-embedding corpus yields no groups
- [ ] ACL: another user's node with an identical vector never appears in the requester's groups
- [ ] No active embed model / profile without `thetaDup` / empty canonical set ⇒
      `available: false`, zeros, no throw
- [ ] Idempotent: second call deep-equals the first; `MAX_NEAR_DUP_GROUPS` cap enforced
- [ ] `pairScores` carries every member pair of a group (including transitive pairs below
      `θ_dup`), is order-stable, and its edge scores agree with the `neighbors`-derived
      `score`/membership used for grouping
