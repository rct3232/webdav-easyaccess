# ShareLinkLoader Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Route path | `/share/:token` |
| Role | Loader for share links. Fetches public share link info; if directory renders FileManager; if file renders ShareLinkSingleFileView. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/ShareLinkLoader.js`
- **Test file:** `client/src/pages/__tests__/ShareLinkLoader.test.js`

### 2.2 Hooks Used

- useParams (token)
- useTranslation

### 2.3 Main Child Components

- FileManager (when linkInfo.isDirectory)
- ShareLinkSingleFileView (when single file)
- CircularProgress, Typography (loading/error states)

### 2.4 Route Protection

- No PrivateRoute; public route. Token in URL; auth optional for “add to shared” flow.

### 2.5 Main User Flows

- Load: call getPublicShareLinkInfo(token)
- Loading: show spinner
- Error: show error message
- Directory: render FileManager with shareToken and linkInfo
- Single file: render ShareLinkSingleFileView

### 2.5.1 Error Handling

- 잘못된 token 형식(빈 문자열, URL 인코딩 오류 등): getPublicShareLinkInfo 호출 → 404/400 등; Error state 표시
- 404: 링크 없음; 403: 접근 불가; 5xx/network: 서버/네트워크 오류. 모두 동일하게 error message + hint 표시 (메시지 키는 공통 가능)

### 2.6 Integration Test Scenarios

- [ ] Loading state while fetching
- [ ] Error state when fetch fails or token invalid
- [ ] Directory link renders FileManager with shareToken/linkInfo
- [ ] Single file link renders ShareLinkSingleFileView
- [ ] Invalid token 형식 → Error state
- [ ] 404 vs 403 vs 5xx 구분 표시(선택: 공통 메시지여도 OK)

### 2.7 Conditional Rendering

- Loading: CircularProgress + loading text
- Error: error message + hint text
- Success: FileManager or ShareLinkSingleFileView based on isDirectory
