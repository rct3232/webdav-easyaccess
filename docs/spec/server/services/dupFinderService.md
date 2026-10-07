# dupFinderService Spec

Target-contract spec (LLM-free hygiene items). Design owner sections:
`docs/features/collections-platform.md` §4.16/§4.17.

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Exact-duplicate finder — HASH-FIRST (`filecache.content_hash` group-by; cosine-1.0 vector detection is REDUNDANT) and the vector near-dup path is P1, not here. Read-only compute; feeds the Storage-dashboard hygiene cards and the rule-variant cleanup suggestions.                                                              |
| Boundaries | No persistence (proposals/rows ride `file_suggestions` — a separate store/route surface; this service computes groups on demand). No LLM, no vectors. Files only; requester's OWN root subtree (hygiene is self-storage: the accept action moves files to the owner's trash, and the reclaimable-GB number is the user's capacity). |
| Hard rule  | **`content_hash IS NULL` rows NEVER form a dup group** (accepted pre-backfill coverage gap; NULL ≠ a hash of anything).                                                                                                                                                                                                             |

---

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/domains/ai/dupFinderService.js`
- **Test file:** `server/domains/ai/__tests__/dupFinderService.test.js`

### 2.2 Main functions

| Function                           | Returns                                                      | Contract                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `findExactDuplicateGroups(userId)` | `{ groups[], groupCount, duplicateCount, reclaimableBytes }` | Own-root subtree LIVE file nodes with non-NULL `content_hash` (`fileNodesStore.listSubtreeCacheRows`); group by hash; groups of size ≥ 2 only, ordered by (smallest nodeId) asc; group = `{ contentHash, sizeBytes, nodeIds[] (asc), filePaths[] }`. `sizeBytes` = per-node `filecache.size` (0 when absent). `reclaimableBytes = Σ sizeBytes × (count − 1)` (keep one). |
| `summarizeExactDuplicates(userId)` | `{ groupCount, duplicateCount, reclaimableBytes }`           | The Storage-dashboard hygiene-card projection of the same compute (no per-group detail).                                                                                                                                                                                                                                                                                 |

- Pure READ — idempotent by nature; two consecutive calls on unchanged data return
  byte-identical results (asserted in tests).
- Empty result fast path: no root node / no hashed files ⇒ `{ groups: [], ... }` zeros.
- No route of its own; consumed by [dashboardService](dashboardService.md) via the
  mounted `GET /api/dashboard`.

### 2.3 Errors & transactions

- Read-only; store errors map through the repository layer unchanged.

### 2.4 Dependencies

- `fileNodesStore.getUserRootNode` + `fileNodesStore.listSubtreeCacheRows`
  (keyset-free subtree read with the filecache columns — see
  `docs/spec/server/store/fileNodesStore.md`)

### 2.5 Verification Scenarios

- [ ] Three nodes sharing one hash → ONE group of 3; a unique-hash node absent; reclaimable = 2·size
- [ ] NULL `content_hash` rows (even two of them, even with identical names/sizes) NEVER appear in any group
- [ ] Directories and trashed nodes excluded; other users' identical content never grouped
- [ ] Idempotent: second call deep-equals the first; a mid-test new dup changes only its group
- [ ] Zero-hash corpus ⇒ `{ groups: [], groupCount: 0, duplicateCount: 0, reclaimableBytes: 0 }`
