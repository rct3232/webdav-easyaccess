# backendHealth Spec

## 1. Overview

| Item            | Description                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role            | In-memory per-backend health tracker for `postgresql`, `s3`, `webdav` plus the AI LLM role slots `ai.embed` / `ai.chat` (feature doc `docs/features/collections-platform.md` §4.12). Passive, event-based: callers report success/failure; the tracker records state, fires a transition callback only on `OK→FAIL` / `FAIL→OK`, and serves a snapshot for the admin card/banner and public status. State resets on restart. |
| Source of truth | `docs/features/backend-health.md`                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/backendHealth.js` (new)
- **Test file:** `server/infrastructure/__tests__/backendHealth.test.js`

### 2.2 State shape (per backend / per AI role slot)

```js
{
  status: 'ok' | 'fail' | 'unknown',   // 'unknown' until the first report
  preparing: boolean,                  // non-terminal readiness: preparation in progress for this slot (§2.3)
  phase: string | undefined,           // what is preparing ('provisioning', 'index-build', …) — admin display only
  progress: string | undefined,        // short human-readable progress ("3/7 files") — admin display only
  code: 'unreachable' | 'auth' | 'missing_resource' | 'unknown' | undefined,
  reason: string | undefined,          // short diagnostic (≤200 chars), never user-facing
  hint: string | undefined,            // human hint (i18n key or short text) for admin surfaces
  lastCheckedAt: number | undefined,   // epoch ms of the last report
  firstFailedAt: number | undefined,   // epoch ms when the current FAIL streak started
  consecutiveFailures: number,         // 0 when OK
}
```

### 2.3 Public API

| Export                | Signature                                                                     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createBackendHealth` | `() => { report, getHealth, reset, setOnTransition }`                         | Factory (tests get an isolated instance; production uses the shared singleton).                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `getHealth`           | `() => { postgresql, s3, webdav, 'ai.embed', 'ai.chat' }`                     | Snapshot for `GET /api/admin/health` (full) and `GET /api/health` (status strings only). AI role slots are keyed `ai.<role>` (`embed`/`chat`, feature doc `docs/features/collections-platform.md` §4.12) with the same state shape; only `embed` and `chat` have tracker rows — `vision`/`asr` readiness is rendered by the admin from per-role probe results and is not tracked here.                                                                                                              |
| `report`              | `(key, { ok, preparing?, phase?, progress?, code?, reason?, hint? }) => void` | Update state; `key` is a backend name or an `ai.<role>` slot. Fire the transition callback only when the status flips `ok`↔`fail` — entering/leaving `preparing` never fires it. `preparing:true` sets the non-terminal readiness state (clears `code/reason/hint`, keeps the underlying `status`); the next `ok:true`/`ok:false` report replaces it. `ok:true` clears `code/reason/hint`, resets `consecutiveFailures` to 0, keeps `lastCheckedAt`. Unknown keys are ignored silently (unchanged). |
| `reset`               | `() => void`                                                                  | Reset all tracked keys to `unknown` (boot + test hook).                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `setOnTransition`     | `(cb) => void`                                                                | Register a callback for `OK→FAIL` / `FAIL→OK` transitions (terminal logging).                                                                                                                                                                                                                                                                                                                                                                                                                       |

**AI role slots (`ai.embed`, `ai.chat`).** Same generic row shape; the adapter
reports probe outcomes via the `probeLlm` slot (`backendProbe.registerProbeTarget('llm', …)`
— `docs/spec/server/infrastructure/llmAdapter.md` §2.3) and the admin 5-state display
(`not_configured | preparing(phase, progress) | probe_failed(reason) | partial | ok`)
maps the row at render time — `preparing` reads the row's readiness fields, not the status.
`GET /api/settings/public` derives its `ai: { embed, chat }` booleans live from these rows
(`status === 'ok'`, `docs/spec/server/routes/settings.md`); a `preparing` row is not `ok`,
so public flags stay `false` while preparation runs (absent-not-disabled holds). The public `/api/health`
endpoint keeps reporting only the three backend statuses; the admin `/health` snapshot
includes the AI rows additively.

### 2.4 Classification

Stable `code` values and the probe/i18n codes that map to them (shared with
`server/infrastructure/backendProbe.js` `classifyToHealthCode`):

| `code`             | Sources                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unreachable`      | PG `ECONNREFUSED/ENOTFOUND/EAI_AGAIN/ETIMEDOUT/ECONNRESET`; S3 unreachable; webdav `connectionRefused`/`serverNotResponding`/`cannotConnect`/`allConnectionAttemptsFailed`; PG `57P01/53300` |
| `auth`             | PG `28P01/28000`; S3 `403/AccessDenied`; webdav `credentialsNotConfigured`/403                                                                                                               |
| `missing_resource` | PG `3D000`; S3 `NoSuchBucket`/404; webdav `pathNotFound`/`sourceNotFound`/`fileOrFolderNotFound`                                                                                             |
| `unknown`          | anything else                                                                                                                                                                                |

### 2.5 Terminal logging

The boot path installs a transition callback that logs only transitions:

```
[backend-health] postgresql: OK → FAIL (unreachable) — <reason>
[backend-health] s3: FAIL → OK
```

Never logs steady-state reports.

---

## 3. Verification Scenarios

- [ ] `report` with no prior state → `status` reflects the first report
- [ ] `ok:true` after `fail` flips to `ok`, clears `code/reason`, resets `consecutiveFailures`
- [ ] `ok:false` increments `consecutiveFailures`; first `fail` sets `firstFailedAt`
- [ ] transition callback fires only on `ok`↔`fail` flips (not on repeated same-state reports)
- [ ] `reset()` returns all tracked keys (backends + AI role slots) to `unknown`
- [ ] `getHealth()` returns the three backends plus the `ai.embed`/`ai.chat` slots with no cross-contamination
- [ ] an `ai.<role>` report never fires a transition for a backend row and vice versa
- [ ] a `preparing:true` report sets the readiness state WITHOUT firing the transition callback and without touching `code/reason`; the next `ok:true`/`ok:false` report clears `preparing/phase/progress`; `settings/public` derivation reads `false` while `preparing` is set
