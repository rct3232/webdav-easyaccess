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

- All require admin JWT.
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
