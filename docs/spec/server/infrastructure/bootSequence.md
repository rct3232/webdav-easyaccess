# Boot Sequence Spec

## 1. Overview

The boot path initializes the metadata DB, primes the shared config resolver, derives the
effective configuration, and branches into normal boot vs setup mode. This replaces the
previous single `initMetadataStore()` call in `server/index.js` with an ordered sequence that
lets DB-sourced configuration take effect before require-time consts are captured.

## 2. Order

```
1. Load .env → process.env (dotenv, override: false). T0 keys are read here.
2. initMetadataSchema()            — connect the metadata DB + apply schema/migrations.
                                    (No admin seeding — deferred until after env population.)
3. resolver = createConfigResolver({ settingsStore: Settings })
   await resolver.loadAll()        — bulk-read settings rows into the resolver cache.
   setSharedResolver(resolver)     — install the process-wide instance (admin route + T2 consumers).
4. effective = await resolver.getEffectiveConfig()
   bootStatus = computeSetupStatus(process.env, { effectiveConfig: effective })
5. if bootStatus.setup_complete:
     populateT1Env(resolver, process.env)
       — for each T1 registry key absent from env, copy the effective value
         (decrypted DB secrets) into process.env so require-time consts see it.
     (CORS production warning uses the effective value.)
   else:
     setup mode — no env population; the wizard serves.
6. await ensureDefaultAdmin()
   — reads process.env.ADMIN_DEFAULT_PASSWORD, which may now be a DB-sourced,
     decrypted T1 value (the wizard stores it in DB for the postgresql path).
7. mount / listen:
   - PORT resolved at listen time via resolver.getConfigSync('PORT') (T1: env → DB → default).
   - CORS origin list resolved per request from the resolver (T2, hot).
   - the setImmediate composition (getComposition / fail-safe / GC scheduler) runs as before;
     its fallback still uses computeSetupStatus(process.env).setup_complete (consistent post-populate).
```

## 3. Why admin seeding is deferred

`ensureDefaultAdmin` reads `ADMIN_DEFAULT_PASSWORD` from the env. Under the two-layer model
that value may live in the DB `settings` row (encrypted). It must therefore run only after the
resolver is primed and T1 values are populated, or the admin would be created with the built-in
default password.

## 4. Consumers

- `server/index.js` (`runBoot`)
- `server/store/bootstrap.js` — `initMetadataSchema` (new, split), `initMetadataStore`
  (backward-compatible schema + admin), `ensureDefaultAdmin`

## 5. Verification

- [ ] Fresh boot (no `.env`, sqlite): setup mode, wizard serves, no env population.
- [ ] Full config in DB (T0 in `.env`): boots, T1 values visible to require-time consts,
      `ADMIN_DEFAULT_PASSWORD` honored when DB-sourced.
- [ ] `.env` wins over DB for any T1 key (`populateT1Env` never overwrites existing env).
- [ ] T2 keys never written into process.env (stay lazy).
- [ ] PORT from DB used at listen; CORS origin list resolved per request.
