# useShareLinkInfo Spec

## 1. Overview

| Item                     | Description                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Role                     | Fetches public share-link info for `/share/:token` and normalizes loading + error state for the route shell. |
| Used by components/pages | `client/src/pages/ShareLinkLoader.js`                                                                        |

> **Phase 5 nodeId end-state:** `GET /api/share/:token/info` always returns a `nodeId` for the shared root, so the hook never needs to resolve a path. The Phase 4 gap-closure `resolve-path` fallback (C2.5) was removed in Phase 5; `useShareLinkInfo` only fetches link info and passes it through as-is.

---

## 2. Implementation Spec

### 2.1 File Path

Scope is page-local to `ShareLinkLoader`:

- **Source:** `client/src/pages/ShareLinkLoader/hooks/useShareLinkInfo.js`
- **Test file:** `client/src/pages/ShareLinkLoader/hooks/__tests__/useShareLinkInfo.test.js`

### 2.2 Input Parameters

`useShareLinkInfo(token)`

| Name  | Type   | Required | Description                            |
| ----- | ------ | -------- | -------------------------------------- |
| token | string | Y        | Public share token from the route URL. |

### 2.3 Return Value / State

| Key      | Type           | Meaning                                                                                                              |
| -------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| loading  | `boolean`      | Current fetch-in-flight state.                                                                                       |
| linkInfo | object \| null | Share metadata on success; includes `nodeId`, `fileName`, `fileType`, `isDirectory`, and `displayPath` from the API. |
| error    | string \| null | Translated main error message on error.                                                                              |

### 2.4 Dependencies

- Services called: `getPublicShareLinkInfo(token)`
- Other hooks: `useTranslation` (to provide/resolve message + hint keys)

### 2.5 Side Effects

- Calls `getPublicShareLinkInfo(token)` when `token` changes.
- Ensures out-of-order async responses do not overwrite the latest state.

### 2.6 Error Handling

- Invalid token format (empty string, URL encoding errors) results in `loading=false` and a non-null `error`.
- All known fetch failures map to a translated error message (main message). The route shell owns any static hint text.
- Network/server failures also result in `loading=false` with a translated error message.

### 2.7 Verification Scenarios

- [ ] Initial state while fetching: `loading === true`
- [ ] Success: directory link info returns `loading === false` and `linkInfo.isDirectory === true`
- [ ] Success: file link info returns `loading === false` and `linkInfo.isDirectory === false`
- [ ] Directory link info passes through the server-provided `linkInfo.nodeId` unchanged (no `resolvePath` call)
- [ ] Error state when fetch fails or token invalid: `loading === false` with a non-null `error` string

### 2.8 Edge Cases

- Empty `token` never resolves to `success`.
- Rapid token changes do not cause older responses to overwrite newer state.
- `getPublicShareLinkInfo` failure (expired link, network error) keeps `linkInfo` null and surfaces a translated error message.
