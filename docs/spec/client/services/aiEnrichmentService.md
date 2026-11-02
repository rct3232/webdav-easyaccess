# aiEnrichmentService Spec

Target-contract spec. Route authority:
[server/routes/aiEnrichments.md](../../server/routes/aiEnrichments.md). Consumer:
[useFileAiInfo.md](../hooks/useFileAiInfo.md).

## 1. Overview

| Item         | Description                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Role         | Thin HTTP seam for the AI Info tab: fetch one node's enrichment payload from `GET /api/ai/enrichments/:nodeId`. |
| Used by      | `useFileAiInfo` (host hook) only. Components never import this service.                                         |
| Does not own | Failure absorption (the hook turns rejection into `null`), tab visibility, rendering, edit affordances.         |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/aiEnrichmentService.js`
- **Test file:** `client/src/services/__tests__/aiEnrichmentService.test.js`

### 2.2 Main Functions

| Function          | Input    | Return                                                | API called                    |
| ----------------- | -------- | ----------------------------------------------------- | ----------------------------- |
| getNodeEnrichment | `nodeId` | `Promise<{ node_id, enrichment }>` — payload verbatim | GET `/api/ai/enrichments/:id` |

- Uses the shared `apiClient.get`; no share-token header or query param is ever attached
  (the route is JWT-only).
- The service does not transform the snake_case payload; the hook extracts `enrichment`.
- No caching layer: the endpoint sends `Cache-Control: no-store`, and the hook controls
  fetch frequency.

### 2.3 Error Handling

- Network/HTTP failures reject unchanged; `useFileAiInfo` absorbs them into `null`.
- A malformed success body (missing `enrichment`) is treated by the hook as `null`.

### 2.4 Verification Scenarios

- [ ] Calls `GET /ai/enrichments/5` for `nodeId = 5`.
- [ ] Returns the response payload verbatim (both row and `null` shapes).
- [ ] Rejects on transport error (absorption belongs to the hook).
