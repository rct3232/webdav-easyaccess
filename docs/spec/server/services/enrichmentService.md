# enrichmentService Spec

Target-contract spec. Wire contract authority:
[routes/aiEnrichments.md](../routes/aiEnrichments.md). Store authority:
[aiEnrichmentsStore.md](../store/aiEnrichmentsStore.md).

## 1. Overview

| Item       | Description                                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Read-only AI Info projection for one node: ACL/state gate → single `aiEnrichmentsStore.get` → safe wire shape → model-name provenance from `llmModelsStore`.                                                                     |
| Boundaries | No write path, no LLM call, no journal, no lock. The raw `probe` object, model ids, storage keys and any provider configuration never leave this service. `tags` are display words only (§4.18 — no vocabulary/merge machinery). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/ai/enrichmentService.js`
- **Factory:** `createEnrichmentService({ aiEnrichmentsStore, llmModelsStore, fileNodesStore, aclService })`
- **Test file:** `server/domains/ai/__tests__/enrichmentService.test.js`

Defaults resolve the real facades (`server/store/aiEnrichmentsStore.js`,
`server/store/llmModelsStore.js`); `fileNodesStore` and `aclService` are injected by
`server/service/composition.js`. Composition exposes the instance as
`enrichmentService` and supports test overrides.

### 2.2 Public contract

`getNodeEnrichment(userId, nodeId)` → `Promise<{ nodeId, enrichment }>`

- `enrichment` is `null` when the node is readable but has no `ai_enrichments` row.
- Throws a service error with `message = 'notFound'` / `status = 404` when the node is
  unknown, trashed (live-only `getNode` returns `null`), or not readable by `userId`.
- `userId` is the authenticated JWT user id. Share principals are rejected by the route
  before this service is reached.

### 2.3 Pipeline

1. `fileNodesStore.getNode(nodeId)` — live node only (`deleted_at IS NULL`). `null` →
   `notFound` (unknown/trashed are indistinguishable).
2. `aclService.checkFilePermission(userId, nodeId, PERMISSIONS.READ)` — false → `notFound`
   (404 masquerade; admin bypass is owned by `aclService`).
3. `aiEnrichmentsStore.get(nodeId)` — `null` → `{ nodeId, enrichment: null }`.
4. Project the whitelist:
   - `tags`: array of strings (non-array/non-string entries dropped defensively, `[]` fallback)
   - `summary`, `caption`, `transcript`, `media_kind`: string or `null`
   - `media`: `null`, or `{ duration_sec, width, height, codecs }` derived from the stored
     probe (`durationSec`/`width`/`height`, distinct `streams[].codecName`) — raw probe
     `tags`/`streams` are never exposed
   - `truncated`: boolean
   - `schema_version`: number or `null`
   - `updated_at`: ISO string or `null`
5. Provenance: resolve each non-null lineage id through `llmModelsStore.getModel(id)` and
   emit ONLY `{ model_name }`; missing model row → `null`. Result shape is always
   `{ features, caption, asr }`.

`category` is intentionally absent (owner decision: the AI Info surface does not promise a
category field; only persisted tags/summary/caption/transcript/media/truncated ship).

### 2.4 Error/absence contracts

- Unknown/trashed/unreadable → 404 masquerade (`notFound`).
- Readable without a row → 200 with `enrichment: null` (absence is data).
- Model lookup failure → that provenance entry degrades to `null`; the enrichment itself
  still renders (provenance is display sugar, never a hard dependency).
- Malformed stored `probe`/`tags` → safe empty/null projection, never a throw.

### 2.5 Verification Scenarios

- [ ] Unknown and trashed nodes → `notFound`.
- [ ] Unreadable live node → `notFound`; admin/readable users pass.
- [ ] Readable no-row → `{ nodeId, enrichment: null }`.
- [ ] Full row projects the exact whitelist; `tags` non-array → `[]`.
- [ ] `media` carries only `duration_sec`/`width`/`height`/`codecs`; probe tags/streams,
      model ids and base URLs are absent.
- [ ] Provenance resolves `features`/`caption`/`asr` to `{ model_name }`, null for absent
      ids and missing model rows.
