BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  password TEXT NOT NULL,
  status TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (username);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_hash_uq ON users (email_hash);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions_user_paths (
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  folder_path TEXT NOT NULL,
  permission TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT permissions_user_paths_permission_check CHECK (permission IN ('read', 'write', 'admin'))
);

CREATE UNIQUE INDEX IF NOT EXISTS permissions_user_paths_user_id_folder_path_uq
  ON permissions_user_paths (user_id, folder_path);

CREATE TABLE IF NOT EXISTS permissions_user_files (
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  permission TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT permissions_user_files_permission_check CHECK (permission IN ('read', 'write', 'admin'))
);

CREATE UNIQUE INDEX IF NOT EXISTS permissions_user_files_user_id_file_path_uq
  ON permissions_user_files (user_id, file_path);

CREATE TABLE IF NOT EXISTS permissions_shares (
  token TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  is_directory BOOLEAN NOT NULL,
  permission TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT permissions_shares_permission_check CHECK (permission IN ('read', 'write', 'admin'))
);

CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  created_by BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT share_links_download_count_check CHECK (download_count >= 0)
);

CREATE TABLE IF NOT EXISTS recent_files (
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS recent_files_user_id_path_uq
  ON recent_files (user_id, path);

CREATE TABLE IF NOT EXISTS permission_requests (
  id BIGSERIAL PRIMARY KEY,
  requester_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  requester_username TEXT NOT NULL,
  owner_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  owner_username TEXT NOT NULL,
  target_type TEXT NOT NULL,
  folder_path TEXT NULL,
  file_path TEXT NULL,
  requested_permission TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL,
  resolved_by BIGINT NULL,
  CONSTRAINT permission_requests_target_type_check CHECK (target_type IN ('folder', 'file')),
  CONSTRAINT permission_requests_requested_permission_check CHECK (requested_permission IN ('read', 'write')),
  CONSTRAINT permission_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT permission_requests_target_consistency_check CHECK (
    (target_type = 'folder' AND folder_path IS NOT NULL AND file_path IS NULL)
    OR (target_type = 'file' AND file_path IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS permission_requests_pending_folder_dedupe_uq
  ON permission_requests (requester_id, owner_id, requested_permission, folder_path)
  WHERE target_type = 'folder' AND status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS permission_requests_pending_file_dedupe_uq
  ON permission_requests (requester_id, owner_id, requested_permission, file_path)
  WHERE target_type = 'file' AND status = 'pending';

CREATE TABLE IF NOT EXISTS locks (
  lock_name_hash TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Performance indexes for common listing and lookup paths.
CREATE INDEX IF NOT EXISTS permission_requests_owner_status_created_idx
  ON permission_requests (owner_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS permission_requests_requester_status_created_idx
  ON permission_requests (requester_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS recent_files_user_last_accessed_idx
  ON recent_files (user_id, last_accessed DESC);

CREATE INDEX IF NOT EXISTS share_links_created_by_created_idx
  ON share_links (created_by, created_at DESC);

COMMIT;
