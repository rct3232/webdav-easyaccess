# adminService Spec

## 1. Overview

| Item | Description                                                                                          |
| ---- | ---------------------------------------------------------------------------------------------------- |
| Role | Admin API: users (pending, list, approve, reject, delete, create), settings, cleanup, admin reports. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/adminService.js`
- **Test file:** `client/src/services/__tests__/adminService.test.js`

### 2.2 Main Functions

| Function             | Input                                    | Return            | API called                                          |
| -------------------- | ---------------------------------------- | ----------------- | --------------------------------------------------- |
| getPendingUsers      | ()                                       | Promise\<Array\>  | GET /api/admin/users/pending                        |
| getUsers             | ()                                       | Promise\<Array\>  | GET /api/admin/users                                |
| getSettings          | ()                                       | Promise\<Object\> | GET /api/admin/settings                             |
| updateSettings       | (settings)                               | Promise\<void\>   | PUT /api/admin/settings                             |
| approveUser          | (userId)                                 | Promise\<void\>   | POST /api/admin/users/:id/approve                   |
| rejectUser           | (userId)                                 | Promise\<void\>   | POST /api/admin/users/:id/reject                    |
| deleteUser           | (userId)                                 | Promise\<void\>   | DELETE /api/admin/users/:id                         |
| createUser           | ({ username, email, password })          | Promise\<void\>   | POST /api/admin/users                               |
| cleanupOrphaned      | ()                                       | Promise\<Object\> | POST /api/admin/cleanup/orphaned                    |
| ensureHomeOwnerAdmin | ()                                       | Promise\<Object\> | POST /api/admin/permissions/ensure-home-owner-admin |
| testConfig           | (target, values)                         | Promise\<Object\> | POST /api/admin/config/test                         |
| getAdminReports      | ()                                       | Promise\<Object\> | GET /api/admin/reports                              |
| getAdminReport       | (id)                                     | Promise\<Object\> | GET /api/admin/reports/:id                          |
| repairAdminReport    | (id, { action, nodeId?, repairAction? }) | Promise\<Object\> | POST /api/admin/reports/:id/repair                  |
| getAiAdminSummary    | ()                                       | Promise\<Object\> | GET /api/admin/ai/summary                           |
| getAiReembedPreview  | ()                                       | Promise\<Object\> | GET /api/admin/ai/reembed/preview                   |
| startAiReembed       | ()                                       | Promise\<Object\> | POST /api/admin/ai/reembed                          |
| getSettingsJournal   | ()                                       | Promise\<Object\> | GET /api/actions?domain=settings                    |
| undoSettingsAction   | (actionId)                               | Promise\<Object\> | POST /api/actions/:id/undo                          |
| probeLlmRole         | (role)                                   | Promise\<Object\> | POST /api/admin/config/test (`target:'llm'`)        |

- All require admin JWT.
- The AI-admin wrappers return `response.data` verbatim (snake_case payloads): the summary/preview shapes are `routes/admin.md` §2.2.7, and the journal wrappers reuse the actions feed/undo contract (`routes/actions.md` §2.4). `probeLlmRole(role)` delegates to `testConfig('llm', { role })`; the server resolves stored credentials, so the client never sends a secret.
- `getAdminReports()` / `getAdminReport(id)` / `repairAdminReport(id, { action, nodeId?, repairAction? })` are thin `apiClient` wrappers returning `response.data` (`{ reports }`, `{ report }`, `{ messageCode, report, result }` respectively); errors propagate like the sibling wrappers (server contract: `docs/spec/server/routes/admin.md` §2.2.6).
- `testConfig(target, values)` submits one connection probe and returns `response.data`; it sets `maxRetries: 0` because retrying an intentional external-connectivity failure does not improve the pending config and delays the editor's error state. The standard API client retry policy remains unchanged for other calls.

### 2.3 Error Handling

- Errors propagated; AdminDashboard uses getServerErrorDisplay
- Cleanup/ensureHomeOwnerAdmin return results object with counts/errors

### 2.4 Verification Scenarios

- [ ] getUsers, getPendingUsers return arrays
- [ ] approve, reject, delete, create call correct endpoints
- [ ] getSettings/updateSettings for settings tab
- [ ] testConfig sends exactly one POST probe with `maxRetries: 0`, returns data, and normalizes failure details
- [ ] cleanupOrphaned, ensureHomeOwnerAdmin return results
- [ ] getAdminReports, getAdminReport, repairAdminReport call the correct verbs/paths and return `response.data`
- [ ] AI-admin wrappers call the summary/preview/reembed paths; settings journal reads `domain=settings` and undo posts `/:id/undo`; `probeLlmRole` posts `target:'llm'` with no secret
