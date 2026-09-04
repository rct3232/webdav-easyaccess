# Boot Sequence Spec

## 1. Overview

The boot path initializes the metadata DB, primes the shared config resolver, derives the
effective configuration, and branches into normal boot vs setup mode. This replaces the
previous single `initMetadataStore()` call in `server/index.js` with an ordered sequence that
lets DB-sourced configuration take effect before require-time consts are captured.

## 2. Order

```
1. Load .env → process.env (dotenv, override: false). T0 keys are read here.
2. [D6] Pre-flight metadata-backend resolution (top of runBoot):
     - the backend is resolved from the generic remote-DB credential block: setting at least one
       of WEA_DB_HOST / WEA_DB_DATABASE / WEA_DB_USER / WEA_DB_PASSWORD selects the remote
       database (PostgreSQL is the only supported remote engine); setting none selects SQLite.
     - a partial set (some but not all of the four) → console.error('[config] … requires <keys> …')
       + process.exit(1), listing the missing keys. A complete-but-unreachable remote still boots
       and reports the outage via GET /api/health.
       The DB connection is .env-owned; there is no sqlite-wizard fallback for it (D6/D7).
3. initMetadataSchema()            — connect the metadata DB + apply schema/migrations.
                                    (No admin seeding — deferred until after env population.)
4. resolver = createConfigResolver({ settingsStore: Settings })
   await resolver.loadAll()        — bulk-read settings rows into the resolver cache.
   setSharedResolver(resolver)     — install the process-wide instance (admin route + T2 consumers).
5. effective = await resolver.getEffectiveConfig()
   bootStatus = computeSetupStatus(process.env, { effectiveConfig: effective })
   — The effective map masks only **set** secrets; an unset secret carries `value: undefined`
     (see configResolver spec §2.6), so the merged presence/completeness checks below are
     truthful: an unset `WEA_DB_PASSWORD` does not select PostgreSQL and an unset file-backend
     secret does not satisfy its required-key set.
6. if bootStatus.setup_complete:
     populateT1Env(resolver, process.env)
       — for each T1 registry key absent from env, resolve the DB-sourced
         plaintext value (settings rows are no longer encrypted) and copy it
         into process.env so require-time consts see it.
     (CORS production warning uses the effective value.)
   else:
     setup mode — no env population; the wizard serves non-T0 only (D7).
7. await ensureDefaultAdmin()
   — reads process.env.ADMIN_DEFAULT_PASSWORD, which may now be a DB-sourced,
     plaintext T1 value (the wizard stores it in DB for the postgresql path).
8. backendHealth.reset() + install the [backend-health] OK→FAIL / FAIL→OK
   transition logger. The reset MUST run BEFORE the boot probes below: a probe
   failure recorded during boot must survive into the tracker so it is visible
   on the health card and the file-screen banner immediately after login. A
   post-probe reset would wipe it (surfaces would report `unknown` at boot).
9. FFmpeg init (best-effort, warn-only).
10. Boot connection probes for the ACTIVE file backend only (D3 / warn-only):
    - WEA_FILE_STORAGE=webdav → utils/webdav `testConnection`; failure logs warn.
    - WEA_FILE_STORAGE=s3 → `backendProbe.probeS3`; missing S3 config logs
      SKIPPED (no failure record); probe failure records to the health tracker
      (survives because step 8 already ran).
    Probing an unused backend would record a false alert (D3), so only the
    active file backend is probed.
11. getMigrationGate().reset() — fresh-process migration gate.
12. mount / listen:
    - PORT resolved at listen time via resolver.getConfigSync('PORT') (T1: env → DB → default).
    - CORS origin list resolved per request from the resolver (T2, hot).
    - the setImmediate composition (getComposition / fail-safe / GC scheduler) runs as before;
      its fallback still uses computeSetupStatus(process.env).setup_complete (consistent post-populate).
```

## 3. Why admin seeding is deferred

`ensureDefaultAdmin` reads `ADMIN_DEFAULT_PASSWORD` from the env. Under the two-layer model
that value may live in the DB `settings` row (plaintext; T1). It must therefore run only after the
resolver is primed and T1 values are populated, or the admin would be created with the built-in
default password.

## 4. Consumers

- `server/index.js` (`runBoot`)
- `server/store/bootstrap.js` — `initMetadataSchema` (new, split), `initMetadataStore`
  (backward-compatible schema + admin), `ensureDefaultAdmin`

## 5. Verification

- [ ] Fresh boot (no `.env`, no remote-DB credentials): metadata backend defaults to SQLite; the DB connects locally and the wizard serves non-T0 only while non-T0 config is incomplete.
- [ ] Partial `WEA_DB_*` credential set (some but not all of `WEA_DB_HOST`/`WEA_DB_DATABASE`/`WEA_DB_USER`/`WEA_DB_PASSWORD`) → `[config]` error listing the missing keys + `exit(1)`.
- [ ] Full config in DB (T0 in `.env`): boots, T1 values visible to require-time consts,
      `ADMIN_DEFAULT_PASSWORD` honored when DB-sourced.
- [ ] `.env` wins over DB for any T1 key (`populateT1Env` never overwrites existing env).
- [ ] T2 keys never written into process.env (stay lazy).
- [ ] PORT from DB used at listen; CORS origin list resolved per request.
- [ ] A failing active-file-backend boot probe leaves the health tracker `fail` (reset runs first), so `GET /api/health` reports the failure and the file-screen banner shows immediately after login.
