# MigrationPage Spec

## 1. Overview

| Item | Description |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Operator progress page for a running/finished blob or metadata migration (`/migration`, guarded by `MigrationGuard`). Renders the job badge, direction, progress, counters, alerts, and the terminal modal. Owns the **Cancel job** control (moved here from `MigrationDialog` when job execution relocated to `/migration`). |
| Component | `client/src/pages/Migration/MigrationPage.js` |
| Dependencies | `migrationService` (`getMigrationStatus`, `getBlobMigrationStatus`, `cancelBlobMigration`), MUI, `react-i18next`, `formatDate` |

## 2. Behavior

- **Polling:** `getBlobMigrationStatus(jobId)` every 400 ms while the job is non-terminal (`completed` / `failed` / `cancelled` stop it).
- **Cancel job:** a `Cancel job` outlined-error button renders while the loaded job is non-terminal. Clicking calls `cancelBlobMigration(jobId)`; the button is disabled for the rest of the run after a request was made (cancellation is a flag — polling continues until the job reports `cancelled`). A success shows the `migrationPage.cancelRequested` note; a failure surfaces `migrationPage.cancelFail` as an inline error Alert without breaking polling.
- **Terminal modal:** shown exactly once per job (see existing behavior); unchanged by the cancel control.

## 3. Locales

`migrationPage.cancelJob`, `migrationPage.cancelRequested`, `migrationPage.cancelFail` (en/ko).

## 4. Verification Scenarios

- [ ] Running job renders the `Cancel job` button; terminal jobs do not
- [ ] Click → `cancelBlobMigration(jobId)` called once; button disabled afterwards; cancelRequested note shown
- [ ] Cancel API failure → cancelFail Alert inline; polling keeps running
- [ ] Empty/failed/cancelled/terminal flows unchanged
