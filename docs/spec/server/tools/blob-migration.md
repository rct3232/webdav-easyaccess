# Blob Migration Tool Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Bidirectional physical-blob migration between the two supported `WEA_FILE_STORAGE` backends (WebDAV and S3), guided by DB metadata (`file_nodes` + `object_map` + `filecache`). Exposed in-app via the admin API (`docs/spec/server/routes/admin.md`) — the **primary path** (D14) — and as a standalone CLI (`server/scripts/migrateBlobs.js`, kept but not the primary path); both drive the same `migrationService`. |
| Depends on | `migrationService` (`server/domains/admin/services/migrationService.js`), dest-config normalization (`server/infrastructure/adapters/blobstore/config.js`), `fileNodesStore` / `fileNodeService`, blob store adapters                                                                                                                                                                                                   |
| Files      | `server/scripts/migrateBlobs.js` (CLI entry — thin wrapper), exported `runMigrationCli(argv, deps)`                                                                                                                                                                                                                                                                                                                     |
| Test files | `server/scripts/__tests__/migrateBlobs.test.js` (CLI tests call `runMigrationCli` in-process with injected fake deps)                                                                                                                                                                                                                                                                                                   |

This document is the canonical reference for the blob migration tooling and replaces the missing Phase D `webdav-s3-migration.md`. The tool is **bidirectional** — it is no longer a one-shot legacy WebDAV→S3 import; it migrates live blobs in either direction against the current schema.

---

## 2. Purpose

Move physical blobs between the WebDAV and S3 backends while keeping the DB metadata authoritative. The tool provides:

- **Automatic direction:** `webdav-to-s3` or `s3-to-webdav`, derived from the current app config (`WEA_FILE_STORAGE`). There is no direction selection anywhere — not in the CLI, the admin API, or the UI; the server is the single source of truth.
- **Automatic resume:** resume is always on — re-running a copy skips already-migrated destination blobs; a full re-run copies nothing.
- **Inline `object_map` flip (s3→webdav):** after each webdav upload succeeds, the node's `storage_backend` is flipped to `'webdav'` immediately, while `s3_key` is preserved. No separate finalize step exists.
- **Source-native webdav snapshot + post-copy activation:** a `webdav-to-s3` run snapshots native webdav files even without an `object_map` row (see §6) and, after each successful copy, sets the node `sync_status='active'` so the post-cutover S3 state matches the S3 lifecycle model.
- **Mandatory dry-run before any write:** an `--apply` run first performs a dry pass; any failure blocks all writes.
- **Per-node failure isolation:** a failing node is recorded and processing continues.
- **Source-blob preservation:** source blobs are never deleted (a `--delete-mode` follow-up is tracked in `docs/IMPROVEMENT_PLAN.md`).

**Unified migration mode (decisions D1–D4, D7–D10 in `docs/features/migration-mode.md`):**

- **Execution moves to `/migration`:** starting a **`dry-run` or `apply`** run from the
  `MigrationDialog` sets the migration gate and **auto-redirects to `/migration`**; the operator is
  forced to stay there until the job reaches a terminal state (progress-only page, no config). A
  `dry-run` enters migration mode too (it does real enumeration work), but writes nothing.
- **Node-count progress:** `total` = active file nodes in the snapshot, `% = progress / total`,
  current file label + copied/skipped/failed counters. Byte-weighted progress is out of scope.
- **Cancellation:** the cancel flag is set immediately; the current node finishes, then the copy
  stops (the `runCopy` loop gains a cancel check). Partial progress is kept (source preserved)
  and resumed on rerun via the existing `shouldSkip` markers.
- **Auto-persist of the destination config (D10):** when an **`apply`** completes, DB-sourced
  storage keys are persisted to the DB (`Settings.set`, secrets AES-encrypted with
  `encrypt_secret_key`, then `invalidateCache`), and the job records
  `configPersist { persisted, skippedEnvSourced }`. Env-sourced keys fall back to the manual
  `.env` guidance. A restart is still required (storage config is boot-frozen).

The migration core (`migrationService`) is shared between the CLI and the admin API, so both entry points enforce the same contracts, resume markers, and DB rules.

---

## 3. Direction Overview

The direction is never chosen by the user. It is derived from the current app config (`WEA_FILE_STORAGE`): the **source** is the env mode and the **destination** is the other backend. The table below describes the per-direction behavior.

| Direction      | Behavior                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `webdav-to-s3` | Derived when `WEA_FILE_STORAGE=webdav`. Download from the source WebDAV path, upload to a flat S3 UUID key, `upsertObjectMap` → `(storage_backend='s3', s3_key=UUID, active)`. Safe because the webdav-mode app ignores `object_map`.                                                                                                                                                                  |
| `s3-to-webdav` | Derived when `WEA_FILE_STORAGE=s3`. Download from the active `s3_key`, upload to the WebDAV path with directory structure preserved (ancestor MKCOL). Immediately after the upload succeeds, the node's `object_map` is flipped to `storage_backend='webdav'` **inline** while `s3_key` is **preserved** — the running S3-mode app keeps serving through the retained key and rollback stays possible. |

Cutover guidance and operational steps are documented in `docs/SETUP.md`.

---

## 4. Source and Destination

### 4.1 Direction is auto-derived

The direction is **derived from the current app config** (`WEA_FILE_STORAGE` + its env vars): the source is the env mode and the destination is the other backend. The server is the single source of truth; only the **destination** config is user input.

- `WEA_FILE_STORAGE=webdav` ⇒ direction `webdav-to-s3`; source is the WebDAV backend, destination is S3.
- `WEA_FILE_STORAGE=s3` ⇒ direction `s3-to-webdav`; source is the S3 backend, destination is WebDAV.

### 4.2 Destination config fields

Destination config is user input (`*` = required). The destination `type` is validated server-side against the derived destination:

| Field         | Backend | Required | Default       | Notes                                                                                                                 |
| ------------- | ------- | -------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `type`        | both    | yes      | —             | `'webdav'` or `'s3'`; **must equal the derived destination backend** (webdav source → `'s3'`, s3 source → `'webdav'`) |
| `url`         | webdav  | yes      | —             | WebDAV base URL                                                                                                       |
| `username`    | webdav  | yes      | —             | WebDAV account name                                                                                                   |
| `password`    | webdav  | yes      | —             | WebDAV account password                                                                                               |
| `authType`    | webdav  | no       | `'auto'`      | `'auto'` \| `'basic'` \| `'digest'`                                                                                   |
| `upstreamUrl` | webdav  | no       | `''`          | For `Destination` header issues behind a reverse proxy                                                                |
| `bucket`      | s3      | yes      | —             | Target S3 bucket; must already exist                                                                                  |
| `accessKey`   | s3      | yes      | —             | S3 access key ID                                                                                                      |
| `secretKey`   | s3      | yes      | —             | S3 secret access key                                                                                                  |
| `endpoint`    | s3      | no       | —             | Custom endpoint (MinIO, etc.); forces path-style addressing                                                           |
| `region`      | s3      | no       | `'us-east-1'` | AWS region                                                                                                            |

- Missing required field → a clear error listing the missing field(s); nothing runs.
- A destination `type` that does not match the derived destination backend → a clear error; nothing runs.
- The destination summary logged/printed is sanitized (no secrets).

### 4.3 `/info` endpoint and in-app popup

`GET /api/admin/migration/info` (admin-gated) returns the derived migration context:

```json
{
  "source": "webdav" | "s3",
  "direction": "webdav-to-s3" | "s3-to-webdav"
}
```

The in-app UI calls this endpoint when the migration dialog opens to show a read-only "Source: WebDAV → Destination: S3" label and to decide which destination fields to render (the derived destination type).

**Cutover flow after `apply` (replaces the old "manually edit `.env`" popup):**

- An `apply` run **auto-redirects to `/migration`** (gate active). Progress is node-count based;
  the run is cancellable mid-copy and resumable on rerun.
- On `completed`, the terminal popup shows the persist result and next-step guidance:
  - **DB-sourced** storage keys → auto-persisted to the DB (`configPersist.persisted`, D10);
    the popup instructs a **restart** (storage config is boot-frozen).
  - **Env-sourced** keys → `configPersist.skippedEnvSourced`; the popup shows the manual `.env`
    guidance (set `WEA_FILE_STORAGE` + the target storage env block, then restart).
- After restart, the boot probe verifies the new backend (WebDAV, or the S3 probe) on the health
  card.
- A `dry-run` also enters migration mode (gate active, progress on `/migration`); on completion it
  shows only the dry-run summary — nothing was written.

### 4.4 Job payload and `configPersist` (D10)

Blob and metadata jobs do **not** share one identical shape; they only share the same
in-memory store row (`migrationJobStore.create`,
`server/domains/admin/stores/migrationJobStore.js`). The `progress` field is type-specific:

- **Blob jobs** keep the **legacy scalar** progress and carry the current file path at the
  top level (`runMigrationWorker` writes it from the migration service `onProgress`):

```js
{
  jobId: string,                    // gate jobId (field is jobId, not id)
  type: 'blobs',
  direction: 'webdav-to-s3' | 's3-to-webdav',
  mode: 'dry-run' | 'apply',
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
  stage: 'copy' | null,
  progress: number,                 // scalar done-node count — NOT { percent, currentLabel }
  total: number,                    // enumerated snapshot node count
  current: string | null,           // current file path label (top-level, not nested)
  results: { copied: number, skipped: number, failed: number, errors: [] },
  errorMessage: string | null,      // failure reason
  configPersist: { persisted: string[], skippedEnvSourced: string[] } | null,  // apply only
  createdAt: string,                // ISO (the store records createdAt; no startedAt on the job)
  completedAt: string | null,
}
```

- **Metadata jobs** instead carry the extended `progress: { percent, currentLabel }` plus a
  `stage` (`scan`/`schema`/`wipe`/`copy`/`done`) — see
  `docs/spec/server/tools/metadata-migration.md` §3.
- **Blob `%`:** `progress / total` over the snapshot node count (D8); the current-file label
  is the top-level `current` field. The `/migration` page derives the percent and current
  label from either shape (`client/src/pages/Migration/MigrationPage.js`).
- **`configPersist`:** set only when `mode === 'apply'` reaches `completed`. Computed by
  `persistStorageConfigToDb(destConfig)`, which returns **arrays of keys**, not booleans:
  - DB-sourced storage keys (`current[key].source !== 'env'` for the
    `WEA_FILE_STORAGE`/`S3_*`/`WEBDAV_*` block) are written with `Settings.set` — secrets
    AES-256-GCM-encrypted under `encrypt_secret_key`, then
    `getSharedResolver().invalidateCache()` — and pushed to `configPersist.persisted`.
  - Env-sourced keys are skipped and pushed to `configPersist.skippedEnvSourced` (no env↔DB
    sync tool); the UI shows the manual `.env` guidance instead.
  - A restart is required in both cases (storage config is boot-frozen:
    `process.env.WEA_FILE_STORAGE` is snapshotted when the composition/blobstore is created).

---

## 5. CLI Usage

Executable: `server/scripts/migrateBlobs.js`. The script is a thin wrapper; the runnable logic lives in the exported `runMigrationCli(argv, deps)` where `deps = { migrationService, output }` — tests inject a fake `migrationService`, so CLI tests never touch the network or spawn subprocesses.

### 5.1 Entry flow

`dotenv` (with `DOTENV_CONFIG_PATH` support) → `storage.js` → `initMetadataStore()` → `getComposition()` → derive direction + expected destination type from `process.env.WEA_FILE_STORAGE` → build dest store from `--dest-*` flags or `DEST_*` env → `migrationService.run` → print progress + summary → `closePgPool()` / `closeSqliteDb()`.

### 5.2 Flags

| Flag                                                                      | Description                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `--check-env`                                                             | Validate config + snapshot + destination connectivity. No writes. Exit `0` (valid) / `1` (invalid).   |
| `--dry-run`                                                               | Run the dry pass (validate config, enumerate snapshot, probe destination). No writes.                 |
| `--apply`                                                                 | Write mode. Runs the internal dry-run pass first; requires `--yes`.                                   |
| `--yes`                                                                   | Required for `--apply`; abort otherwise.                                                              |
| `--force`                                                                 | Re-copy a node even when the automatic resume skip would skip it (already-migrated destination blob). |
| `--dest-type=s3\|webdav`                                                  | Destination backend. Must equal the derived destination (webdav source → `s3`, s3 source → `webdav`). |
| `--dest-webdav-url` / `--dest-webdav-username` / `--dest-webdav-password` | WebDAV destination connection.                                                                        |
| `--dest-webdav-auth-type` / `--dest-webdav-upstream-url`                  | WebDAV destination optional fields.                                                                   |
| `--dest-s3-bucket` / `--dest-s3-access-key` / `--dest-s3-secret-key`      | S3 destination connection.                                                                            |
| `--dest-s3-endpoint` / `--dest-s3-region`                                 | S3 destination optional fields.                                                                       |

### 5.3 `DEST_*` environment variables

The same destination config can be supplied via environment:

| Variable                   | Maps to       |
| -------------------------- | ------------- |
| `DEST_TYPE`                | `type`        |
| `DEST_WEBDAV_URL`          | `url`         |
| `DEST_WEBDAV_USERNAME`     | `username`    |
| `DEST_WEBDAV_PASSWORD`     | `password`    |
| `DEST_WEBDAV_AUTH_TYPE`    | `authType`    |
| `DEST_WEBDAV_UPSTREAM_URL` | `upstreamUrl` |
| `DEST_S3_BUCKET`           | `bucket`      |
| `DEST_S3_ACCESS_KEY`       | `accessKey`   |
| `DEST_S3_SECRET_KEY`       | `secretKey`   |
| `DEST_S3_ENDPOINT`         | `endpoint`    |
| `DEST_S3_REGION`           | `region`      |

`--dest-*` flags take precedence over `DEST_*` env. At least one complete set (flags or env) must be provided for the derived destination backend; `DEST_TYPE` must equal the derived destination (`s3` for webdav source, `webdav` for s3 source).

### 5.4 Preflight rules

- `--apply` requires `--yes`; a missing `--yes` aborts the run.
- `--apply` / `--dry-run` validate that the destination type matches the derived destination backend; a mismatch aborts with exit `1` before any work.
- Unknown flag combinations → clear usage error, exit `2`.

---

## 6. Snapshot Approach

The tool does **not** take the app into a write-blocking maintenance mode. Instead:

1. Enumerate the file-node set **once** at start, source-mode aware:
   - **S3 source (unchanged):** `file_nodes WHERE type='file' AND sync_status='active'` with an active `object_map` row (via `fileNodesStore.getNodesBySyncStatus('active')`, filtered to type=file with an object_map row).
   - **WebDAV source:** every file node with `sync_status != 'orphaned_node'` (via `fileNodesStore.getNodesBySyncStatusNot('orphaned_node')`); per node the active `object_map` row is used when present (its preserved `s3_key` is the webdav→s3 resume marker from a prior run), otherwise the activeObject is synthesized as `{ s3_key: null, storage_backend: 'webdav' }`. Native webdav files — the app's own uploads, which stay `sync_status='pending_upload'` with no `object_map` (webdav is path-addressed; the blob IS the node's display path) — are therefore included without a mapping row.
2. Read only from the **source** store.
3. Write only to the **destination** store plus the required DB updates.

The app remains fully usable during the copy run. Directories are only relevant for WebDAV destinations (ancestor MKCOL).

**Cancellation (D4):** while the migration gate is active, the admin can cancel via
`POST /api/admin/migration/jobs/:jobId/cancel`. The cancel flag is set immediately; the
`runCopy` loop checks it between nodes, finishes the current node, then stops. Partial progress
is kept (source preserved) and rerun resumes via the automatic `shouldSkip` markers. In migration
mode the copy runs on the `/migration` page, which forces the operator to stay until the job
reaches a terminal state.

---

## 7. Direction-Specific `object_map` Rules (authoritative)

| Action                   | WebDAV→S3 copy                                                                                                                                          | S3→WebDAV copy                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| snapshot preconditions   | non-orphaned file nodes (`sync_status != 'orphaned_node'`); activeObject synthesized `{s3_key:null, storage_backend:'webdav'}` when no `object_map` row | active file nodes with an active `object_map` row (unchanged)                   |
| read source              | path → download                                                                                                                                         | active `s3_key` → download                                                      |
| write dest               | S3 UUID key (flat)                                                                                                                                      | webdav path `/username/...` + mkdir                                             |
| `object_map`             | upsert `(s3, key, active)`                                                                                                                              | flip `storage_backend='webdav'` inline after upload succeeds; **keep `s3_key`** |
| `file_nodes.sync_status` | set `'active'` after copy (webdav-native nodes were `'pending_upload'`)                                                                                 | unchanged (`'active'` already)                                                  |
| `filecache`              | size/mime/hash                                                                                                                                          | hash (+size check for resume)                                                   |
| resume marker            | active non-null `s3_key`                                                                                                                                | dest `headBlob` size == `filecache.size`                                        |
| S3 dest                  | flat UUID keys, NO directory structure                                                                                                                  | —                                                                               |
| WebDAV dest              | —                                                                                                                                                       | directory structure preserved (ancestor MKCOL)                                  |

- **`webdav-to-s3`:** `object_map` is updated per node during copy (`upsertObjectMap` → `storage_backend='s3'`, `s3_key=UUID`, `active`), and the node is set `sync_status='active'` after a successful copy. Safe because the webdav-mode app ignores `object_map`.
- **`s3-to-webdav`:** each node's `object_map.storage_backend` is flipped to `'webdav'` **inline** right after its webdav upload succeeds, while `s3_key` is **preserved**. The running S3-mode app reads only `s3_key` (`downloadBlob` in S3 mode never consults `storage_backend`), so the flip has zero functional impact on running reads; `storage_backend` is informational. Preserving `s3_key` also keeps rollback possible — the pre-migration key stays recorded on the row.

### 7.1 `object_map` transitions

| Direction      | Transition                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `webdav-to-s3` | Upsert row → `(storage_backend='s3', s3_key=<UUID>, active)`.                                                                                 |
| `s3-to-webdav` | Flip `storage_backend='webdav'` inline after the webdav upload succeeds; `s3_key` is retained (a legacy reference; harmless; helps rollback). |

There is **no** transition that nulls `s3_key`. Source blobs are never deleted (a delete-mode
follow-up is tracked in `docs/IMPROVEMENT_PLAN.md`).

---

## 8. Resume Markers

Resume is **automatic and always on** — there is no `--resume` flag or UI checkbox. On every run, destination-state markers are checked per node and already-migrated blobs are skipped. `--force` overrides the automatic skip.

| Direction      | Marker                                                     | Meaning                                                                                                                |
| -------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `webdav-to-s3` | active `object_map` row with non-null `s3_key`             | Node already migrated → skip (unless `--force`).                                                                       |
| `s3-to-webdav` | dest `headBlob(nodePath).contentLength === filecache.size` | Node already uploaded to WebDAV at the right size → skip. A partial/unfinished dest blob is never treated as complete. |

---

## 9. Dry-Run and Safety Gates

1. **Dry-run is mandatory before any write:** `--apply` first performs the dry-run pass (config validation + snapshot enumeration + destination connectivity); any failure blocks all writes (exit code `1`). `--dry-run` / `--check-env` never write.
2. **Source blobs are never deleted** (a `--delete-mode` follow-up is tracked in
   `docs/IMPROVEMENT_PLAN.md`).
3. **`.wea` is a normal folder** — included in migration like any other node.
4. **`--force` re-copy** is included (overrides the automatic resume skip); `--delete-mode` is
   not (tracked in `docs/IMPROVEMENT_PLAN.md`).
5. **Per-node failure isolation:** a failing node is caught, recorded in `errors`, and processing continues. The run only aborts when config/snapshot/destination validation fails.
6. **Cancellation:** the cancel flag is set immediately; the current node finishes then the copy stops (cancel check in the `runCopy` loop). Partial progress is kept and resumed on rerun; the source is never touched.

---

## 10. Exit Codes

| Code | Meaning                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success — `--check-env` valid, `--dry-run` passed, or `--apply` completed.                                                                                            |
| `1`  | Preflight/config/snapshot/destination failure — including a destination `type` that does not match the derived destination — or failed dry-run pass; nothing written. |
| `2`  | Usage error — unknown flags/combinations.                                                                                                                             |

---

## 11. Verification Scenarios

- [ ] `--check-env` validates config + snapshot + destination connectivity with no writes; exit `0`/`1` accordingly
- [ ] `--apply` without `--yes` aborts with a clear error
- [ ] `--apply` runs the internal dry-run pass first; a failed dry-run blocks all writes (exit `1`)
- [ ] `--dry-run` writes nothing (destination store count `0`, DB unchanged, no `object_map` flips)
- [ ] Automatic resume skips already-migrated nodes per direction marker; a full re-run is idempotent (0 copied)
- [ ] `--force` re-copies nodes even when the automatic resume skip would skip them
- [ ] Missing required dest field produces a clear error listing the field(s)
- [ ] A destination `type` that does not match the derived destination backend is rejected before any work (exit `1`)
- [ ] Direction is derived from `WEA_FILE_STORAGE` at bootstrap; no `--direction` flag or other user selection exists
- [ ] webdav-source snapshot: a native webdav file (no `object_map`, `sync_status='pending_upload'`) is included and copied; after copy its `sync_status` is `'active'` and it has an `(s3, UUID, active)` `object_map` row
- [ ] webdav-source snapshot: a preserved active `s3_key` (prior migration) resumes as a skip marker; a rerun copies only the remaining native files
- [ ] webdav-source snapshot: `orphaned_node` file nodes are excluded
- [ ] s3-source snapshot is unchanged: only `active` file nodes with an active `object_map` row are enumerated
- [ ] Dest config from `--dest-*` flags and from `DEST_*` env produce the same destination store; flags win on conflict
- [ ] s3-to-webdav apply flips `storage_backend='webdav'` inline per node while preserving `s3_key`; a re-run skips flipped nodes
- [ ] Unknown flag combination exits `2` with a usage message
- [ ] `runMigrationCli` output includes progress and a summary of copied/skipped/failed

**Migration-mode additions (decisions D1–D4, D8, D10 in `docs/features/migration-mode.md`):**

- [ ] Any start (both `apply` and `dry-run`) sets the migration gate and the client auto-redirects to `/migration`; a `dry-run` enters migration mode too but writes nothing
- [ ] Progress is node-count based (`% = progress/total` over the snapshot) with a current-file label and copied/skipped/failed counters
- [ ] Cancel mid-copy finishes the current node then stops; a rerun resumes via `shouldSkip` (no duplicate copies, source preserved)
- [ ] Apply completion persists DB-sourced storage keys (`configPersist.persisted`), skips env-sourced keys (`configPersist.skippedEnvSourced`), and records the result on the job
- [ ] Terminal state surfaces an auto modal with summary + "Go to settings" on `/migration`
