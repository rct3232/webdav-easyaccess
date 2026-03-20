# ShareLinkLoader Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Route path | `/share/:token` |
| Role | Route shell for share links. Uses `useShareLinkInfo` to fetch public share link info; if directory renders FileManager; if file renders ShareLinkSingleFileView. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/ShareLinkLoader.js`
- **Test file:** `client/src/pages/__tests__/ShareLinkLoader.test.js`

### 2.2 Hooks Used
- useParams (token)
- useShareLinkInfo (token)
- useTranslation (loading/error view text)

Boundary note:

- Route-param lookup stays in the page shell.
- `useShareLinkInfo` owns fetch lifecycle and error normalization for the resolved token.

### 2.3 Main Child Components

- FileManager (when linkInfo.isDirectory)
- ShareLinkSingleFileView (when single file)
- CircularProgress, Typography (loading/error states)

### 2.4 Route Protection

- No PrivateRoute; public route. Token in URL; auth optional for “add to shared” flow.

### 2.5 Main User Flows
- Load: `useShareLinkInfo(token)` calls `getPublicShareLinkInfo(token)`
- Loading: show spinner
- Error: show error message
- Directory: render FileManager with shareToken and linkInfo
- Single file: render ShareLinkSingleFileView

### 2.5.1 Error Handling

- Invalid token format (empty string, URL encoding errors, etc.): `getPublicShareLinkInfo(token)` → 404/400, etc.; show error state
- 404: link not found; 403: access not allowed; 410: expired link; 5xx/network: server/network failure. All map to the same error experience, with the main message normalized by the hook and the hint text rendered by the page shell

### 2.6 Integration Test Scenarios

- [ ] Loading state while fetching
- [ ] Error state when fetch fails or token invalid
- [ ] Directory link renders FileManager with shareToken/linkInfo
- [ ] Single file link renders ShareLinkSingleFileView
- [ ] Invalid token format → error state
- [ ] 404 vs 403 vs 5xx differentiation is shown (optional: common message is OK)

### 2.7 Conditional Rendering

- Loading: CircularProgress + loading text
- Error: error message + hint text
- Success: FileManager or ShareLinkSingleFileView based on isDirectory
