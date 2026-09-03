# CLI Setup Tool

Source-of-Truth for the first-run **CLI setup tool** (`server/scripts/setup.js`), the
headless/remote counterpart of the browser setup wizard
(`docs/features/setup-wizard.md`). The wizard and the CLI share the **same apply core**
(`server/domains/setup/setupCore.js`), so the two entry points can never drift.

## 1. Why it exists

While `setup_complete === false` the HTTP server binds to `127.0.0.1` only, unconditionally
(`docs/features/setup-wizard.md` → Network exposure). The wizard therefore requires a browser on
the host or an SSH tunnel. Operators on headless/remote-first hosts (no browser anywhere, no
SSH client, automation, container bootstrap) configure first-run from the terminal instead with:

```bash
node server/scripts/setup.js                # interactive (readline) first-run wizard
node server/scripts/setup.js --help         # flag reference (non-interactive mode)
```

There is deliberately **no** remote-wizard token gate (`WEA_SETUP_TOKEN`): the loopback-only
binding already removes the remote attack surface, and the CLI covers every case the token
would have.

## 2. Contract

### 2.1 Parity with the wizard

The CLI performs the **exact same apply as `POST /api/setup/apply`**, through the shared core:

- validates the collected blocks (`validateApplyPayload` semantics),
- partitions T0 (`.env`) vs DB-`settings` entries,
- writes `.env` atomically (`0600`, backup file) — only the T0 subset of the payload
  (`JWT_SECRET`); the metadata-backend T0 keys stay env-owned and are never written by apply,
- updates the `admin` account password,
- upserts DB-`settings` rows as **plaintext** (secret values included; a masked `'****'`
  secret input preserves the previously stored value),
- clears the shared config-resolver cache.

Result parity means: after `apply`, `computeSetupStatus` reports `setup_complete: true` and a
restart (or a fresh boot) binds all interfaces and runs fully configured.

### 2.2 Availability and refusal

- The CLI must run **on the same host** as the app, using the app's own `.env` / metadata
  store. It refuses (exit non-zero, no writes) when `setup_complete === true` — post-setup
  configuration is managed via the admin UI and `.env`, not the first-run tool.
- Interactive mode confirms before any write; non-interactive mode requires the equivalent of
  `--yes` (mirrors the `migrateBlobs.js --yes` convention) and never prompts **except** for a
  missing secret when stdin is a TTY (see Secret handling).
- Passwords/secrets are never echoed or logged; secret values are accepted from the flag, the
  environment (`WEA_SETUP_<KEY>`), or a hidden prompt, in that precedence order.
- **Exit codes:** `0` success; `1` refusal (already complete), validation/probe/boot failure,
  or write failure; `2` usage error.

### 2.3 Flag surface (non-interactive)

| Flag                                                                                                         | Required              | Meaning                                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--help`                                                                                                     | –                     | Print the flag reference and exit.                                                                              |
| `--status`                                                                                                   | –                     | Print the derived setup state (`setup_complete`, `missing`, `current` masked) and exit.                         |
| `--file-backend`                                                                                             | apply                 | `s3` or `webdav`.                                                                                               |
| `--s3-bucket` / `--aws-region` / `--aws-access-key-id` / `--aws-secret-access-key` (alias `--s3-secret-key`) | s3                    | S3 credential block.                                                                                            |
| `--s3-endpoint`                                                                                              | s3 (opt)              | Custom S3-compatible endpoint.                                                                                  |
| `--webdav-url` / `--webdav-username` / `--webdav-password`                                                   | webdav                | WebDAV credential block.                                                                                        |
| `--webdav-auth-type`                                                                                         | webdav (opt)          | `auto`/`basic`/`digest`.                                                                                        |
| `--admin-password`                                                                                           | apply                 | New `admin` password (username fixed to `admin`).                                                               |
| `--jwt-secret`                                                                                               | apply (opt)           | JWT signing secret; auto-generated (crypto-secure) when omitted.                                                |
| `--jwt-expires-in`                                                                                           | opt                   | Session duration (e.g. `30m`, `7d`).                                                                            |
| `--port`                                                                                                     | opt                   | Server port.                                                                                                    |
| `--cors-origins`                                                                                             | opt                   | Allowed browser origins (comma-separated).                                                                      |
| `--email-host` / `--email-port` / `--email-user` / `--email-password` / `--email-secure` / `--email-from`    | opt                   | SMTP block.                                                                                                     |
| `--check`                                                                                                    | –                     | Run the connection probe for the file backend given via `--file-backend` (no writes); exit non-zero on failure. |
| `--yes`                                                                                                      | non-interactive apply | Skip the confirmation prompt.                                                                                   |

Interactive mode (no flags) asks the same blocks step by step with `readline`, with defaults
and masked secret input, then offers the connection check before writing.

### 2.4 Metadata backend

Mirrors the wizard/D7 rules: the metadata backend (`WEA_STORAGE_BACKEND` + the `WEA_PG_*`
block, or the sqlite path) is **`.env`-owned** and never set by apply. The CLI:

- **sqlite (default)** — operates on the app's default store (`data/webdav.db`) when no `.env`
  exists, and writes `.env` for the first time.
- **postgresql** — requires `WEA_STORAGE_BACKEND=postgresql` + `WEA_PG_*` already declared in
  `.env` (as the server does), boots the store against it, and writes the remaining DB-`settings`
  rows there.

The CLI loads the environment exactly like the server boot (`dotenv` config path resolution),
so "what the CLI sees" is "what the next server boot sees".

## 3. Security posture

- Applies the same mitigations as the wizard: allowlisted keys, format validation, `.env`
  written `0600` with a backup, no secret logging.
- Running the CLI requires host access (same login as the app), so no network exposure is added
  by the tool.
- After `apply`, the operator restarts the server (`restart_required: true`, mirroring the
  wizard); the boot then derives `setup_complete: true` and binds all interfaces.

## 4. Testing anchors

- Interactive/flag parsing, required-field validation errors (exit non-zero, nothing written).
- Refusal with exit code when `setup_complete === true`.
- `--status` prints the derived state with secrets masked.
- Apply on a throwaway sqlite store: `.env` written `0600` with the expected keys (only the
  T0 subset, i.e. `JWT_SECRET`); `settings` rows upserted (secrets stored as plaintext);
  `computeSetupStatus` becomes `setup_complete: true`; `--status` after apply reports complete.
- `--check` runs the file-backend probe without writing.
