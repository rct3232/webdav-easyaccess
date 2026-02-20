# apiClient Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Centralized API client (fetch-based). Provides get, post, put, del, request; token injection, 401/403 handling, retry with exponential backoff. 401: refresh 후 /login 리다이렉트; 403: URL 이동 후에만 history.back() 또는 '/' 리다이렉트, 그 외 리다이렉트 없음. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/apiClient.js`
- **Test file:** `client/src/services/__tests__/apiClient.test.js`

### 2.2 Main Functions

| Function | Input | Return | API called |
|----------|-------|--------|------------|
| get | (url, config) | Promise\<Response\> | GET /api/url |
| post | (url, data, config) | Promise\<Response\> | POST /api/url |
| put | (url, data, config) | Promise\<Response\> | PUT /api/url |
| del | (url, config) | Promise\<Response\> | DELETE /api/url |
| request | (config) | Promise\<Response\> | Custom config |

- Base URL: `/api`
- Timeout: 300000 (5 min)
- Request interceptor: adds `Authorization: Bearer <token>` from sessionStorage
- Response interceptor: handles `x-new-token`; 401: token refresh 1회 시도 후 실패 시 /login 리다이렉트; 403: URL 이동 직후(GET /api/files/list, GET /api/admin/* 등)는 history.back() 또는 '/' 리다이렉트, 그 외는 리다이렉트 없음. login/register/share 관련 요청은 리다이렉트 미적용

### 2.3 Error Handling

- **401 (토큰 없음/무효/만료):** refresh 1회 시도 → 실패 시 토큰 제거 후 `/login` 리다이렉트. login/register/share 관련 요청은 리다이렉트 미적용
- **403 (권한 없음):** URL 이동 직후(GET /api/files/list, GET /api/admin/* 등): `history.back()` 시도, 불가 시 `'/'` 리다이렉트. 그 외: 리다이렉트 없음, 에러 throw
- **공통 예외:** login, register, share 관련 요청은 리다이렉트 미적용
- 4xx: no retry
- 5xx/network: retry with exponential backoff (retryRequest)
- Preserves error.response for client error display

### 2.3.1 Retry 및 Refresh 실패

- 5xx/network retry exhausted: 마지막 에러 throw; error.response 보존되어 getServerErrorDisplay 가능
- **401** refresh 실패: 토큰 제거, /login 리다이렉트. 리다이렉트 제외: login/register, share 관련(X-Share-Token, /api/share/*)
- **403:** refresh 시도 없음. URL 이동 직후는 history.back() 또는 '/' 리다이렉트; 그 외는 리다이렉트 없음

### 2.4 Verification Scenarios

- [ ] Token injected in request headers when sessionStorage has token
- [ ] Refresh flow on 401: new token stored, request retried
- [ ] 401 refresh 실패: 토큰 제거, /login 리다이렉트 (non-share, non-auth endpoints)
- [ ] 403 URL 이동 직후 (GET /api/files/list, GET /api/admin/* 등): history.back() 또는 '/' 리다이렉트
- [ ] 403 그 외: 리다이렉트 없음, 에러 throw
- [ ] get/post/put/del call correct HTTP methods
- [ ] Retry on 5xx, no retry on 4xx
- [ ] 5xx retry 모두 실패 시 최종 에러 throw
- [ ] refresh 실패 시 리다이렉트 제외 대상(endpoint) 미리디렉트 안 함
