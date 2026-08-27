# Blob Migration Tool Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Bidirectional physical-blob migration between the two supported `WEA_FILE_STORAGE` backends (WebDAV and S3), guided by DB metadata (`file_nodes` + `object_map` + `filecache`). Exposed as a standalone CLI (`server/scripts/migrateBlobs.js`) and in-app via the admin API (`docs/spec/server/routes/admin.md`); both drive the same `migrationService`. |
| Depends on | `migrationService` (`server/domains/admin/services/migrationService.js`), dest-config normalization (`server/infrastructure/adapters/blobstore/config.js`), `fileNodesStore` / `fileNodeService`, blob store adapters |
| Files | `server/scripts/migrateBlobs.js` (CLI entry — thin wrapper), exported `runMigrationCli(argv, deps)` |
| Test files | `server/scripts/__tests__/migrateBlobs.test.js` (CLI tests call `runMigrationCli` in-process with injected fake deps) |

This document is the canonical reference for the blob migration tooling and replaces the missing Phase D `webdav-s3-migration.md`. The tool is **bidirectional** — it is no longer a one-shot legacy WebDAV→S3 import; it migrates live blobs in either direction against the current schema.

---

## 2. Purpose

Move physical blobs between the WebDAV and S3 backends while keeping the DB metadata authoritative. The tool provides:

- **Both directions:** `webdav-to-s3` and `s3-to-webdav`, selected by `--direction`.
- **Resumability and idempotency:** re-running a copy skips already-migrated nodes; a full re-run copies nothing.
- **Mandatory dry-run before any write:** an `--apply` run first performs a dry pass; any failure blocks all writes.
- **Per-node failure isolation:** a failing node is recorded and processing continues.
- **Source-blob preservation:** source blobs are never deleted in the MVP.

The migration core (`migrationService`) is shared between the CLI and the admin API, so both entry points enforce the same contracts, resume markers, and DB rules.

---

## 3. Direction Overview

| Direction | Copy phase | Finalize phase |
|---|---|---|
| `webdav-to-s3` | Download from the source WebDAV path, upload to a flat S3 UUID key, `upsertObjectMap` → `(storage_backend='s3', s3_key=UUID, active)`. | None required — safe because the webdav-mode app ignores `object_map`. |
| `s3-to-webdav` | Download from the active `s3_key`, upload to the WebDAV path with directory structure preserved (ancestor MKCOL). `object_map` is **untouched** during copy — the running S3-mode app resolves blobs through it. | After the app is switched to webdav mode, flips migrated nodes to `storage_backend='webdav'`, `s3_key=NULL`. Idempotent. |

Cutover guidance and operational steps are documented in `docs/SETUP.md`.

---

## 4. Source and Destination

### 4.1 Source is auto-determined

The source backend is **auto-determined from the current app config** (`WEA_FILE_STORAGE` + its env vars). Direction implies source; only the **destination** config is user input.

- `--direction=webdav-to-s3` ⇒ source is the WebDAV backend.
- `--direction=s3-to-webdav` ⇒ source is the S3 backend.

### 4.2 Destination config fields

Destination config is user input (`*` = required):

| Field | Backend | Required | Default | Notes |
|---|---|---|---|---|
| `type` | both | yes | — | `'webdav'` or `'s3'`; selects the destination backend |
| `url` | webdav | yes | — | WebDAV base URL |
| `username` | webdav | yes | — | WebDAV account name |
| `password` | webdav | yes | — | WebDAV account password |
| `authType` | webdav | no | `'auto'` | `'auto'` \| `'basic'` \| `'digest'` |
| `upstreamUrl` | webdav | no | `''` | For `Destination` header issues behind a reverse proxy |
| `bucket` | s3 | yes | — | Target S3 bucket; must already exist |
| `accessKey` | s3 | yes | — | S3 access key ID |
| `secretKey` | s3 | yes | — | S3 secret access key |
| `endpoint` | s3 | no | — | Custom endpoint (MinIO, etc.); forces path-style addressing |
| `region` | s3 | no | `'us-east-1'` | AWS region |

- Missing required field → a clear error listing the missing field(s); nothing runs.
- The destination summary logged/printed is sanitized (no secrets).

---

## 5. CLI Usage

Executable: `server/scripts/migrateBlobs.js`. The script is a thin wrapper; the runnable logic lives in the exported `runMigrationCli(argv, deps)` where `deps = { migrationService, output }` — tests inject a fake `migrationService`, so CLI tests never touch the network or spawn subprocesses.

### 5.1 Entry flow

`dotenv` (with `DOTENV_CONFIG_PATH` support) → `storage.js` → `initMetadataStore()` → `getComposition()` → build dest store from `--dest-*` flags or `DEST_*` env → `migrationService.run` → print progress + summary → `closePgPool()` / `closeSqliteDb()`.

### 5.2 Flags

| Flag | Description |
|---|---|
| `--direction=webdav-to-s3\|s3-to-webdav` | **Required.** Direction implies the source backend. |
| `--phase=copy\|finalize` | Default `copy`. `finalize` is only valid for `s3-to-webdav`. |
| `--check-env` | Validate config + snapshot + destination connectivity. No writes. Exit `0` (valid) / `1` (invalid). |
| `--dry-run` | Run the dry pass (validate config, enumerate snapshot, probe destination). No writes. |
| `--apply` | Write mode. Runs the internal dry-run pass first; requires `--yes`. |
| `--yes` | Required for `--apply`; abort otherwise. |
| `--resume` | Skip already-migrated nodes per the resume markers (§8). |
| `--force` | Re-copy even when a resume marker is present. |
| `--dest-type=s3\|webdav` | Select the destination backend. |
| `--dest-webdav-url` / `--dest-webdav-username` / `--dest-webdav-password` | WebDAV destination connection. |
| `--dest-webdav-auth-type` / `--dest-webdav-upstream-url` | WebDAV destination optional fields. |
| `--dest-s3-bucket` / `--dest-s3-access-key` / `--dest-s3-secret-key` | S3 destination connection. |
| `--dest-s3-endpoint` / `--dest-s3-region` | S3 destination optional fields. |

### 5.3 `DEST_*` environment variables

The same destination config can be supplied via environment:

| Variable | Maps to |
|---|---|
| `DEST_TYPE` | `type` |
| `DEST_WEBDAV_URL` | `url` |
| `DEST_WEBDAV_USERNAME` | `username` |
| `DEST_WEBDAV_PASSWORD` | `password` |
| `DEST_WEBDAV_AUTH_TYPE` | `authType` |
| `DEST_WEBDAV_UPSTREAM_URL` | `upstreamUrl` |
| `DEST_S3_BUCKET` | `bucket` |
| `DEST_S3_ACCESS_KEY` | `accessKey` |
| `DEST_S3_SECRET_KEY` | `secretKey` |
| `DEST_S3_ENDPOINT` | `endpoint` |
| `DEST_S3_REGION` | `region` |

`--dest-*` flags take precedence over `DEST_*` env. At least one complete set (flags or env) must be provided for the selected backend.

### 5.4 Preflight rules

- `--apply` requires `--yes`; a missing `--yes` aborts the run.
- `--apply` / `--dry-run` require a valid `--direction`.
- `--phase=finalize` is valid only for `s3-to-webdav` with `mode=apply`.
- Unknown flag combinations → clear usage error, exit `2`.

---

## 6. Snapshot Approach

The tool does **not** take the app into a write-blocking maintenance mode. Instead:

1. Enumerate the active file-node set **once** at start: `file_nodes WHERE type='file' AND sync_status='active'` with an active `object_map` row (via `fileNodesStore.getNodesBySyncStatus('active')`, filtered to type=file with an object_map row).
2. Read only from the **source** store.
3. Write only to the **destination** store plus the required DB updates.

The app remains fully usable during the copy phase. Directories are only relevant for WebDAV destinations (ancestor MKCOL).

---

## 7. Direction-Specific `object_map` Rules (authoritative)

| Action | WebDAV→S3 copy | S3→WebDAV copy | S3→WebDAV finalize |
|---|---|---|---|
| read source | path → download | active `s3_key` → download | — |
| write dest | S3 UUID key (flat) | webdav path `/username/...` + mkdir | — |
| `object_map` | upsert `(s3, key, active)` | **untouched** | flip migrated → `(webdav, NULL)` |
| `filecache` | size/mime/hash | hash (+size check for resume) | — |
| resume marker | active non-null `s3_key` | dest `headBlob` size == `filecache.size` | `headBlob` check per node |
| S3 dest | flat UUID keys, NO directory structure | — | — |
| WebDAV dest | — | directory structure preserved (ancestor MKCOL) | — |

- **`webdav-to-s3`:** `object_map` is updated per node during copy (`upsertObjectMap` → `storage_backend='s3'`, `s3_key=UUID`, `active`). Safe because the webdav-mode app ignores `object_map`.
- **`s3-to-webdav`:** `object_map` is NOT touched during copy (the running S3-mode app resolves blobs through it). A separate **finalize** phase, run after the app is switched to webdav mode, flips migrated nodes to `storage_backend='webdav'`, `s3_key=NULL`.

---

## 8. Resume Markers

| Direction | Marker | Meaning |
|---|---|---|
| `webdav-to-s3` | active `object_map` row with non-null `s3_key` | Node already migrated → skip (unless `--force`). |
| `s3-to-webdav` | dest `headBlob(nodePath).contentLength === filecache.size` | Node already uploaded to WebDAV at the right size → skip. A partial/unfinished dest blob is never treated as complete. |
| `finalize` | dest `headBlob(path)` exists and size matches `filecache` | Node eligible for flip to `(webdav, NULL)`. |

---

## 9. Dry-Run and Safety Gates

1. **Dry-run is mandatory before any write:** `--apply` first performs the dry-run pass (config validation + snapshot enumeration + destination connectivity); any failure blocks all writes (exit code `1`). `--dry-run` / `--check-env` never write.
2. **Source blobs are never deleted** in the MVP. `--delete-mode` is a follow-up.
3. **`.wea` is a normal folder** — included in migration like any other node.
4. **`--force` re-copy** is included (overrides resume-skip); `--delete-mode` is not.
5. **Per-node failure isolation:** a failing node is caught, recorded in `errors`, and processing continues. The run only aborts when config/snapshot/destination validation fails.

---

## 10. Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success — `--check-env` valid, `--dry-run` passed, or `--apply` completed. |
| `1` | Preflight/config/snapshot/destination failure, or failed dry-run pass — nothing written. |
| `2` | Usage error — unknown flags/combinations, missing or invalid `--direction`. |

---

## 11. Verification Scenarios

- [ ] `--check-env` validates config + snapshot + destination connectivity with no writes; exit `0`/`1` accordingly
- [ ] `--apply` without `--yes` aborts with a clear error
- [ ] `--apply` runs the internal dry-run pass first; a failed dry-run blocks all writes (exit `1`)
- [ ] `--dry-run` writes nothing (destination store count `0`, DB unchanged)
- [ ] `--resume` skips already-migrated nodes per direction marker; re-run is idempotent (0 copied)
- [ ] `--force` re-copies nodes even when the resume marker is present
- [ ] Missing required dest field produces a clear error listing the field(s)
- [ ] Dest config from `--dest-*` flags and from `DEST_*` env produce the same destination store; flags win on conflict
- [ ] `--phase=finalize` rejected for `webdav-to-s3` / missing `--direction`
- [ ] Unknown flag combination exits `2` with a usage message
- [ ] `runMigrationCli` output includes progress and a summary of copied/skipped/failed
