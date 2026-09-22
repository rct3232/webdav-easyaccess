# dupFinderService Spec

Contract spec written with T0.9 (LLM-free hygiene items; `AI_FEATURE_PLAN.md` §4.17 rule
variant, §2.2/PoC E2 ruling, PLAN T0.1/T0.9 register (b)). Design owner sections:
§4.16/§4.17, `collections-platform.md` §4.17.

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Exact-duplicate finder — HASH-FIRST (`filecache.content_hash` group-by). Cosine-1.0 vector detection is REDUNDANT (PoC E2 ruling) and the vector near-dup path is T1.7 (P1), not here. Read-only compute; feeds the §4.16 hygiene cards and the §4.17 rule-variant suggestions.                                                                                 |
| Boundaries | No persistence (proposals/rows ride `file_suggestions` — store/route specs land with the T3.3 docs step; this service computes groups on demand). No LLM, no vectors. Files only; requester's OWN root subtree (§4.16 hygiene is self-storage: the §4.17 accept action moves files to the owner's trash, and the reclaimable-GB number is the user's capacity). |
| Hard rule  | **`content_hash IS NULL` rows NEVER form a dup group** (T0.1/register (b): pre-backfill coverage gap is accepted; NULL ≠ a hash of anything, grouping on NULL would invent duplicates).                                                                                                                                                                         |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/domains/ai/dupFinderService.js`
- **Test file:** `server/domains/ai/__tests__/dupFinderService.test.js`
- **Module-location decision:** no spec pins a path (the §4.17 contract-spec pointer defers
  the store/route specs to T3.3); the AI-domain hygiene family (`domains/ai/`, same as the
  near-dup T1.7 and tag pipeline T1.8) is the placement adjudicated here. NEW file only —
  zero overlap with the T0.11 `domains/ai/{routes,searchService}.js` surface.

### 2.2 Main functions

| Function                           | Returns                                                      | Contract                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `findExactDuplicateGroups(userId)` | `{ groups[], groupCount, duplicateCount, reclaimableBytes }` | Own-root subtree LIVE file nodes with non-NULL `content_hash` (`fileNodesStore.listSubtreeCacheRows`); group by hash; groups of size ≥ 2 only, ordered by (smallest nodeId) asc; group = `{ contentHash, sizeBytes, nodeIds[] (asc), filePaths[] }`. `sizeBytes` = per-node `filecache.size` (0 when absent). `reclaimableBytes = Σ sizeBytes × (count − 1)` (keep one). |
| `summarizeExactDuplicates(userId)` | `{ groupCount, duplicateCount, reclaimableBytes }`           | The §4.16 hygiene-card projection of the same compute (no per-group detail).                                                                                                                                                                                                                                                                                             |

- Pure READ — idempotent by nature; two consecutive calls on unchanged data return
  byte-identical results (asserted in tests).
- Empty result fast path: no root node / no hashed files ⇒ `{ groups: [], ... }` zeros.
- No route mounts at T0.10/T3.3 consume this service **flagged for the orchestrator**.

### 2.3 Errors & transactions

- Read-only; store errors map through the repository layer unchanged.

### 2.4 Dependencies

- `fileNodesStore.getUserRootNode` + `fileNodesStore.listSubtreeCacheRows` (new
  keyset-free subtree read with the filecache columns — T0.9 addition, see
  `docs/spec/server/store/fileNodesStore.md`)

### 2.5 Verification Scenarios

- [ ] Three nodes sharing one hash → ONE group of 3; a unique-hash node absent; reclaimable = 2·size
- [ ] NULL `content_hash` rows (even two of them, even with identical names/sizes) NEVER appear in any group (register (b) ruling)
- [ ] Directories and trashed nodes excluded; other users' identical content never grouped
- [ ] Idempotent: second call deep-equals the first; a mid-test new dup changes only its group
- [ ] Zero-hash corpus ⇒ `{ groups: [], groupCount: 0, duplicateCount: 0, reclaimableBytes: 0 }`
