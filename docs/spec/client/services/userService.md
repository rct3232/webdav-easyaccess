# userService Spec

## 1. Overview

| Item | Description                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------- |
| Role | User-related API: approved users list, update email, update password, update permissions (admin). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/userService.js`
- **Test file:** `client/src/services/__tests__/userService.test.js`

### 2.2 Main Functions

| Function              | Input                 | Return           | API called                     |
| --------------------- | --------------------- | ---------------- | ------------------------------ |
| getApprovedUsers      | ()                    | Promise\<Array\> | GET /api/users/approved        |
| updateEmail           | (userId, email)       | Promise\<void\>  | PUT /api/users/:id/email       |
| updatePassword        | (userId, password)    | Promise\<void\>  | PUT /api/users/:id/password    |
| updateUserPermissions | (userId, permissions) | Promise\<void\>  | PUT /api/users/:id/permissions |

### 2.3 Error Handling

- Errors propagated; MyPage/Admin use getServerErrorDisplay
- Password change rotates token_version; client logs out after success

### 2.4 Verification Scenarios

- [ ] getApprovedUsers returns user array
- [ ] updateEmail, updatePassword call correct endpoints
- [ ] updateUserPermissions sends permissions array
