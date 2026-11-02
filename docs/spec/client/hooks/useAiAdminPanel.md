# useAiAdminPanel Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Page-local controller for `AiAdminContent`: polled AI governance summary, launcher actions, gates, probe and settings-journal rollback.                                                                                          |
| Used by    | `client/src/components/mypage/content/AiAdminContent.js`                                                                                                                                                                         |
| Data owner | `GET /api/admin/ai/summary` (poll), `GET /api/admin/ai/reembed/preview`, `POST /api/admin/ai/reembed`, `PUT /api/admin/config`, `POST /api/admin/config/test`, `GET /api/actions?domain=settings`, `POST /api/actions/:id/undo`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/MyPage/hooks/useAiAdminPanel.js`
- **Test file:** `client/src/pages/MyPage/hooks/__tests__/useAiAdminPanel.test.js`

### 2.2 Inputs

| Name    | Type   | Required | Description                                                                  |
| ------- | ------ | -------- | ---------------------------------------------------------------------------- |
| service | object | N        | Injectable admin service surface (defaults to `adminService`; tests inject). |
| pollMs  | number | N        | Poll interval in ms (default 15000; tests use a large/large-mocked value).   |

### 2.3 Return value

| Key              | Type                             | Meaning                                                                  |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `summary`        | object \| null                   | Latest summary payload (snake_case).                                     |
| `preview`        | object \| null                   | Latest re-embed preview.                                                 |
| `journal`        | array                            | Settings-domain journal feed rows.                                       |
| `journalError`   | Error \| null                    | Last journal read error, separate from the summary error.                |
| `loading`        | boolean                          | Initial summary read in progress.                                        |
| `error`          | Error \| null                    | Last summary read error (`admin.aiPanel.loadFail` rendered by caller).   |
| `busyKey`        | string \| null                   | Active operation key (`preview`, `launch`, `settings`, `probe`, `undo`). |
| `refresh`        | () => Promise\<void\>            | Manual summary read (in-flight guarded).                                 |
| `loadPreview`    | () => Promise\<object\>          | Fetches the read-only launcher preview.                                  |
| `launch`         | () => Promise\<object\>          | Posts the launcher action; refreshes the summary on success.             |
| `saveSettings`   | (values) => Promise\<object\>    | PUT config values, then refreshes summary + journal.                     |
| `probeRoles`     | () => Promise\<Array\<object\>\> | Probes chat/vision/asr targets sequentially, then refreshes summary.     |
| `refreshJournal` | () => Promise\<array\>           | Reads `GET /api/actions?domain=settings` and returns its action rows.    |
| `undoJournal`    | (actionId) => Promise\<object\>  | Undoes a settings journal row, then refreshes summary + journal.         |

### 2.4 Polling contract (U4)

- First read on mount (summary + settings journal); then `setInterval(pollMs)` refreshes
  both the summary and the settings-journal feed.
- `inFlight` ref guards both the interval and manual summary refresh: a slow response is
  never overlapped; the next tick runs after it settles.
- Unmount clears the interval and flips a `mounted` ref so late responses do not write
  state.
- No pub-sub channel and no socket: polling is the only refresh mechanism.

### 2.5 Error handling

- Summary failures set `error` and keep the previous payload (no fabricated empty data).
- Journal read failures set `journalError` (the previous rows stay in state but the
  journal block renders the error state) and do not overwrite `error`, so the block can
  render an error/retry while the summary remains visible. Journal writes (undo/gate
  save) still throw.
- Launcher/gate/journal-write errors are thrown to the component, which renders the
  server error code/params.
- Probe failures are per-role and do not abort the remaining role probes.

### 2.6 Verification Scenarios

- [ ] Mount triggers one read; advancing fake timers triggers the next tick.
- [ ] A pending read blocks a second call (in-flight guard).
- [ ] Unmount clears the interval and drops a late response.
- [ ] Launch success refreshes the summary; preview does not mutate the summary.
- [ ] Gate save refreshes both the summary and the settings journal feed.
- [ ] A journal read failure sets `journalError` without overwriting the summary `error`.
- [ ] Probe runs one call per role and isolates failures.
