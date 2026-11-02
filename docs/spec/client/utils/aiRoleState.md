# aiRoleState Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Pure mapper that turns a backend-health tracker row (`GET /api/admin/health` `backends['ai.<role>']`) into the admin 5-state display value `not_configured \| preparing \| probe_failed \| partial \| ok` (llmAdapter.md §2.4). Consumed by the admin health card (SystemSettingsContent) and reusable by the AI governance panel (P4). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/aiRoleState.js`
- **Test file:** `client/src/utils/__tests__/aiRoleState.test.js`

### 2.2 Function Signatures

| Function       | (input) => return                                          |
| -------------- | ---------------------------------------------------------- |
| mapAiRoleState | `(row) => { state, phase?, progress?, reason? }` or `null` |

**Input parameters**

| Name | Type   | Description                                                                                                                                                                              |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| row  | Object | A backend-health tracker row (backendHealth.md §2.2 shape): `{ status, preparing, phase, progress, code, reason, hint, ... }`. `null`/`undefined` maps to `null` (caller skips the row). |

**Return value**

| Key      | Meaning                                                      |
| -------- | ------------------------------------------------------------ |
| state    | One of the five admin states (below)                         |
| phase    | `row.phase` when state is `preparing`                        |
| progress | `row.progress` when state is `preparing`                     |
| reason   | `row.reason` (probe diagnostic) when state is `probe_failed` |

**State mapping (exhaustive, ordered)**

1. `row.preparing === true` → `preparing` — the non-terminal readiness state reads the row's readiness fields, never `status` (backendHealth.md §2.3).
2. `row.status === 'ok'` with a non-empty `hint` → `partial` — a declared-vs-probed warning note rides the row's `hint` (capability partially on).
3. `row.status === 'ok'` → `ok`.
4. `row.status === 'fail'` → `probe_failed` — `reason` is the short diagnostic.
5. otherwise (`status 'unknown'` or unrecognized) → `not_configured`.

### 2.3 Dependencies

- None. Pure function over a plain object; no i18n, no fetch, no React.

---

## 3. Related Documents

- [../components/mypage/content/SystemSettingsContent.md](../components/mypage/content/SystemSettingsContent.md) — render surface
- [../../../server/infrastructure/llmAdapter.md](../../../server/infrastructure/llmAdapter.md) §2.4 — the 5-state contract
