# RCA Log — Test-Failure Root Cause Analysis

> **Purpose**: Single dated log for test-failure incidents diagnosed under the mandatory RCA
> procedure (AGENTS.md §3.2). Every failure is classified and recorded here **before** any code
> is changed. Historical entries were removed on 2026-09-02 during consolidation; only new
> incidents are appended below.

## Procedure

1. **Diagnose** before modifying any code — collect the error output and cross-check spec docs.
2. **Classify**:
   - **Case A (Source Error)**: implementation violates spec → **STOP**, ask the user.
   - **Case B (Test Error)**: test misinterprets spec / asserts on internals → fix the test.
   - **Case C (Spec Error)**: spec is undefined or ambiguous → **STOP**, ask the user.
3. **Act** per the classification (do not modify code before classifying).
4. **Record**: append an entry below with date, summary, classification, and action taken.

## Entries

### 2026-09-04 — E2E guarded writes 503 `setup.incomplete` on sqlite+webdav scratch boots (Case A)

- **Summary**: 6 Playwright E2E failures (setup-wizard/admin-config/migration E2E-*001,
  desktop+mobile) — login/health OK but the first guarded write (`POST /api/folders/create`,
  `PUT /api/admin/config`) returned `503 { errorCode: 'serverErrors.setup.incomplete' }`.
- **Diagnosis**: reproduced locally (standalone scratch-server boot with the same `.env`/seed).
  `configResolver.getEffectiveConfig()` masked **every** `secret` entry — including UNSET ones —
  to the literal `'****'` (configResolver.js `value: secret ? SECRET_MASK : value`). `setupStatus`
  `mergeEffective` copied that truthy mask into the derived view, so `metadataMissing`'s
  presence test saw `WEA_DB_PASSWORD='****'`, selected PostgreSQL, and reported
  `WEA_DB_HOST/DATABASE/USER` missing → boot `setup_complete=false` → setup mode → no
  `populateT1Env` → DB-seeded webdav keys never reached `process.env` → every guarded write 503.
  The wizard status path already applied a "mask-drop" helper (`normalizeEffectiveForStatus`,
  setupCore.js) so `/api/setup/status` disagreed with boot. Only sqlite-metadata boots (no
  `WEA_DB_*` env) were affected; PG-backed runs passed.
- **Classification**: **Case A (Source Error)** — masking an unset secret fabricates presence,
  violating the presence-based metadata-selection contract
  (docs/spec/server/store/storage.md §2.4, bootSequence.md step 5).
- **Action taken**: Option B — mask only secrets that actually have a value
  (server/infrastructure/configResolver.js); removed the now-redundant
  `normalizeEffectiveForStatus` and its call sites (setupCore.js, routes.js, scripts/setup.js);
  docs updated (configResolver spec §2.6, routes/config spec, api.md,
  config-source-resolution, bootSequence) + regression unit tests added. Verified end-to-end by
  a `-r` preload simulation (guarded PUT 200) and by the full unit + e2e suites.
