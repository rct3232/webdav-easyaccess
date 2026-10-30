# aiEnrichments routes Spec

Target-contract spec: read-only AI Info surface for the file properties dialog
(`docs/spec/client/components/dialogs/FilePropertiesDialog.md` §3.3). Store authority:
[aiEnrichmentsStore.md](../store/aiEnrichmentsStore.md); tag posture:
`docs/features/collections-platform.md` §4.18.

## 1. Overview

| Item       | Description                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/ai`                                                                                                                                                        |
| Route      | `GET /enrichments/:nodeId`                                                                                                                                       |
| Role       | Return the single node's persisted AI enrichment (tags, summary, caption, transcript, media facts, provenance) for display. Read-only: no mutation route exists. |
| Cache      | `Cache-Control: no-store` — enrichment is per-viewer/ACL-gated derived state and may change after any producer pass.                                             |

**Layer boundary:** the route is a thin serializer. ACL gating, node-state classification,
the single store read, safe media projection and model-name provenance resolution live in
`enrichmentService`. The service NEVER returns raw `probe` (tags/streams), model ids,
`base_url_key`, credentials, vectors or any storage key.

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/ai/enrichmentRoutes.js` (thin router)
- **Service:** `server/domains/ai/enrichmentService.js`
- **Test files:** `server/domains/ai/__tests__/enrichmentRoute.test.js`,
  `server/domains/ai/__tests__/enrichmentService.test.js`

**Mount:** `server/index.js`, after the setup guard, next to the AI search mount:
`app.use('/api/ai', setupModeGuardInstance, require('./domains/ai/enrichmentRoutes'))`.

### 2.2 Route List (sync with api.md)

| Method | Path                   | Auth  | Description                                                         |
| ------ | ---------------------- | ----- | ------------------------------------------------------------------- |
| GET    | `/enrichments/:nodeId` | Token | Read one node's AI enrichment; readable-without-row returns `null`. |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser` (JWT only, in that order)
- `setupModeGuardInstance` at mount (coverage invariant, ARCHITECTURE §1.3)

**Share tokens are excluded by construction:** `authenticateToken` reads only
`Authorization: Bearer`; a request presenting only `X-Share-Token` (or `?shareToken=`)
is unauthenticated → 401. The route is never mounted behind `authenticateTokenOrShare`.

### 2.4 Request/Response Spec

- **Path parameter:** `nodeId` is parsed by `parseNodeId` (positive integer). Missing,
  non-numeric or ≤ 0 → 400 `serverErrors.files.invalidPath`.
- **200 (readable, enrichment row exists):**

```json
{
  "node_id": 90210,
  "enrichment": {
    "tags": ["beach", "sunset"],
    "summary": "A sunset over the beach.",
    "caption": "Waves at golden hour.",
    "transcript": "…",
    "media_kind": "music",
    "media": {
      "duration_sec": 182.4,
      "width": 1920,
      "height": 1080,
      "codecs": ["h264", "aac"]
    },
    "truncated": false,
    "schema_version": 1,
    "updated_at": "2026-01-01T00:00:00.000Z",
    "provenance": {
      "features": { "model_name": "qwen2.5-7b" },
      "caption": { "model_name": "qwen2.5-vl-7b" },
      "asr": { "model_name": "whisper-large-v3" }
    }
  }
}
```

- **200 (readable, no enrichment row):** `{ "node_id": 90210, "enrichment": null }` —
  absence is data, never 404 and never an error.
- **404 masquerade:** unknown id, trashed/soft-deleted node, and a live node the requester
  cannot read (`aclService.checkFilePermission(..., 'read')` false) all return
  404 `serverErrors.files.notFound`. Node existence is never disclosed.
- **Field whitelist:** exactly `node_id`, `enrichment.{tags,summary,caption,transcript,
media_kind,media,truncated,schema_version,updated_at,provenance}`. `tags` is always an
  array (empty when absent); `media` is `null` unless at least one safe fact exists;
  `provenance` entries are `{ model_name } | null` per producer family. `category`,
  `degraded`, raw probe tags/streams, model ids, `base_url`, keys and vectors NEVER
  appear.
- **No-store:** every 200 response carries `Cache-Control: no-store`.

### 2.4.1 Error Codes

| HTTP | errorCode                                    | Trigger                                                |
| ---- | -------------------------------------------- | ------------------------------------------------------ |
| 400  | `serverErrors.files.invalidPath`             | Missing/non-numeric/non-positive `:nodeId`.            |
| 401  | `serverErrors.utilsAuth.accessTokenRequired` | No JWT (share-token-only requests included).           |
| 404  | `serverErrors.files.notFound`                | Unknown, trashed, or unreadable node (404 masquerade). |

No new `SERVER_ERROR_CODES` keys (locale mirrors untouched).

### 2.5 Verification Scenarios

- [ ] 401 without `Authorization` (and for a valid share-link token alone).
- [ ] 400 for a non-numeric / non-positive `:nodeId`.
- [ ] 404 for unknown, trashed, and unreadable nodes (same `files.notFound` body).
- [ ] 200 `{ node_id, enrichment: null }` for a readable node with no row.
- [ ] 200 full whitelist shape for a seeded row (tags/summary/caption/transcript/
      media_kind/media/truncated/schema_version/updated_at/provenance).
- [ ] `media` exposes `duration_sec`/`width`/`height`/`codecs` ONLY; raw `probe.tags`,
      `probe.streams`, model ids and `base_url_key` are absent.
- [ ] `Cache-Control: no-store` on the response.
