# apiClient Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Centralized API client with interceptors. Provides get, post, put, del, request; token injection, 401/403 refresh handling, and retry with exponential backoff. |

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
- Response interceptor: handles `x-new-token`, 401/403 refresh, redirect to /login on auth failure (except login/register and share requests)

### 2.3 Error Handling

- 401/403: try token refresh once, then clear tokens and redirect to /login (unless auth attempt, share request, or share permission check)
- 4xx: no retry
- 5xx/network: retry with exponential backoff (retryRequest)
- Preserves error.response for client error display

### 2.4 Verification Scenarios

- [ ] Token injected in request headers when sessionStorage has token
- [ ] Refresh flow on 401: new token stored, request retried
- [ ] Redirect to /login on auth failure (non-share, non-auth endpoints)
- [ ] get/post/put/del call correct HTTP methods
- [ ] Retry on 5xx, no retry on 4xx
