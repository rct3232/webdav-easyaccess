# useShareLinkInfo Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Fetches public share-link info for `/share/:token` and normalizes loading + error state for the route shell. Enriches directory links with the share root `nodeId` (resolve-path fallback, C2.5). |
| Used by components/pages | `client/src/pages/ShareLinkLoader.js` |

> **Phase 4 nodeId end-state (C2.5):** for directory links, `linkInfo` is enriched with the share root `nodeId` once at share-view entry. When the API already carries `nodeId` it is kept as-is; otherwise `linkInfo.filePath` is resolved via `POST /files/resolve-path` for authenticated viewers (guarded by an access-token presence check so public share viewers are not redirected to login). The resolve-path fallback is removed in Phase 5 once `GET /share/:token/info` returns a nodeId.

---

## 2. Implementation Spec

### 2.1 File Path

Scope is page-local to `ShareLinkLoader`:

- **Source:** `client/src/pages/ShareLinkLoader/hooks/useShareLinkInfo.js`
- **Test file:** `client/src/pages/ShareLinkLoader/hooks/__tests__/useShareLinkInfo.test.js`

### 2.2 Input Parameters

`useShareLinkInfo(token)`

| Name | Type | Required | Description |
|------|------|----------|-------------|
| token | string | Y | Public share token from the route URL. |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| loading | `boolean` | Current fetch-in-flight state. |
| linkInfo | object \| null | Share metadata on success; includes `isDirectory` and, for directory links, the share root `nodeId` when resolvable (C2.5). |
| error | string \| null | Translated main error message on error. |

### 2.4 Dependencies

- Services called: `getPublicShareLinkInfo(token)`, `resolvePath(filePath)` (directory links only, when `nodeId` absent and the viewer holds an access token), `getAccessToken()` (auth guard)
- Other hooks: `useTranslation` (to provide/resolve message + hint keys)

### 2.5 Side Effects

- Calls `getPublicShareLinkInfo(token)` when `token` changes.
- For directory links without `nodeId`, calls `resolvePath(linkInfo.filePath)` once to attach the share root nodeId.
- Ensures out-of-order async responses do not overwrite the latest state.

### 2.6 Error Handling

- Invalid token format (empty string, URL encoding errors) results in `loading=false` and a non-null `error`.
- All known fetch failures map to a translated error message (main message). The route shell owns any static hint text.
- Network/server failures also result in `loading=false` with a translated error message.

### 2.7 Verification Scenarios

- [ ] Initial state while fetching: `loading === true`
- [ ] Success: directory link info returns `loading === false` and `linkInfo.isDirectory === true`
- [ ] Success: file link info returns `loading === false` and `linkInfo.isDirectory === false`
- [ ] Authenticated directory link resolves the share root `nodeId` via `resolvePath` and exposes it on `linkInfo.nodeId`
- [ ] Unauthenticated directory link leaves `linkInfo.nodeId` absent (no `resolvePath` call)
- [ ] Error state when fetch fails or token invalid: `loading === false` with a non-null `error` string

### 2.8 Edge Cases

- Empty `token` never resolves to `success`.
- Rapid token changes do not cause older responses to overwrite newer state.
- `resolvePath` failure (unauthenticated viewer or unresolvable path) keeps `linkInfo` path-based; the path-based fallbacks in FileManager / ShareLinkSection remain.

