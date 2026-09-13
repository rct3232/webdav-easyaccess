# PLAN: Migration terminal-job recovery (E2E-MIG-008 race fix)

## Objective

Eliminate the terminal-before-mount race on `/migration`: a job that finishes before
`MigrationPage` mounts leaves no jobId channel (gate cleared, status `{active:false}`),
so the D9 terminal modal never appears. Fix via a server-owned "last finished job"
notice + admin ack endpoint (canonical recovery channel), not by threading jobId through
navigate state.

## Scope

- `server/infrastructure/migrationGate.js` — `clear(notice)` retains `{ jobId, type }`;
  `getNotice()` / `ackNotice()`; `reset()` drops it.
- `server/domains/admin/routes/migration.js` — worker `finally` sites pass the notice;
  new `POST /api/admin/migration/last-job/ack` (Token + Admin, 204).
- `server/domains/admin/routes/migrationStatus.js` — admin view when inactive returns
  `{ active: false, lastJob: { jobId, type } | null }`; unauthenticated/non-admin shape
  unchanged.
- `client/src/services/migrationService.js` — `ackMigrationLastJob()`.
- `client/src/pages/Migration/MigrationPage.js` — mount resolve: if inactive && `lastJob`,
  load that job (same initial/poll logic), show terminal modal, then ACK (also ACK on 404).
- Docs: `docs/spec/server/infrastructure/migrationGate.md`, `docs/features/migration-mode.md`
  (D9 + API table), `docs/spec/client/pages/MigrationPage.md`,
  `docs/spec/client/services/migrationService.md`.
- Out of scope: MIG-002 `:691` active-gate assumption, bulk-op pattern, ADMIN-008 test
  (separate branch `test/admin008-cleanup-contract`).

## Success criteria

- Server integration: status inactive+notice → admin sees `lastJob`, anon doesn't;
  ack clears; boot reset drops; e2e-deterministic: terminal modal appears even when the
  job completes before mount (client unit test proves the recovery render path).
- `npm run test:ci` (server + client) green; existing `toEqual({ active: false })` pins
  updated to the new documented admin shape.

## Task graph (deps)

| ID  | Task                                                                                  | Deps  |
| --- | ------------------------------------------------------------------------------------- | ----- |
| T1  | Docs-first: update the 4 doc files to the new contract                                | —     |
| T2  | Server tests: gate notice lifecycle + status/ack route cases (red)                    | T1    |
| T3  | Server impl until T2 green                                                            | T2    |
| T4  | Client tests: MigrationPage inactive+lastJob recovery, ACK after modal, 404 ACK (red) | T1    |
| T5  | Client impl (service + page) until T4 green                                           | T4    |
| T6  | Verify: server+client test:ci, lint, RCA_LOG entry                                    | T3,T5 |

## Hypotheses

- H1 (confirmed by CI trace 46): skip-only rerun job terminates in ~ms; mount round-trip
  loses the race → empty view. Recovery channel removes the timing dependency entirely.

## Status

T1-T6 complete 2026-09-13: server 100 suites/1939 + pg leg 16/232, client 159/1435
(in-band), lint+format clean; local e2e: s3-admin-desktop E2E-ADMIN-008 pass, migration-desktop
9/9 pass. Recovery path proven by unit/integration (idle-machine e2e wins the race by design);
final arbiter: full CI e2e leg.
