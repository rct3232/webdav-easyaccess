-- ============================================================
-- WebDAV EasyAccess — Normalized Schema (Final State)
-- PostgreSQL 16 target; SQLite-compatible via conversion layer.
-- Single source of truth for all metadata tables.
-- ============================================================

BEGIN;

-- -----------------------------------------------------------
-- Unchanged tables
-- -----------------------------------------------------------

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

-- -----------------------------------------------------------
-- New filesystem tables
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS file_nodes (
  id BIGSERIAL PRIMARY KEY,
  parent_id BIGINT DEFAULT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('file', 'directory')),
  sync_status TEXT NOT NULL DEFAULT 'active'
    CHECK (sync_status IN ('active', 'pending_upload', 'orphaned_node')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT file_nodes_unique_name_per_parent UNIQUE (parent_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS file_nodes_root_unique ON file_nodes (name) WHERE parent_id IS NULL;
CREATE INDEX IF NOT EXISTS file_nodes_children_idx ON file_nodes (parent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS object_map (
  id BIGSERIAL PRIMARY KEY,
  file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  s3_key TEXT DEFAULT NULL,
  storage_backend TEXT NOT NULL DEFAULT 's3' CHECK (storage_backend IN ('s3', 'webdav')),
  version_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'orphaned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT object_map_version_unique UNIQUE (file_node_id, version_number)
);

CREATE INDEX IF NOT EXISTS object_map_active_idx ON object_map (file_node_id, status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS filecache (
  file_node_id BIGINT PRIMARY KEY REFERENCES file_nodes(id) ON DELETE CASCADE,
  size BIGINT NOT NULL DEFAULT 0,
  mime_type TEXT DEFAULT NULL,
  content_hash TEXT DEFAULT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS node_ancestors (
  ancestor_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  descendant_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL CHECK (depth >= 0),
  PRIMARY KEY (ancestor_id, descendant_id)
);

CREATE INDEX IF NOT EXISTS node_ancestors_descendant_idx ON node_ancestors (descendant_id, depth);
CREATE INDEX IF NOT EXISTS node_ancestors_ancestor_idx ON node_ancestors (ancestor_id, depth);

-- -----------------------------------------------------------
-- Rewritten tables: path columns → file_node_id FK references
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS permissions_user_paths (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT permissions_user_paths_unique UNIQUE (user_id, file_node_id)
);

CREATE TABLE IF NOT EXISTS permissions_user_files (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT permissions_user_files_unique UNIQUE (user_id, file_node_id)
);

CREATE TABLE IF NOT EXISTS permissions_shares (
  token TEXT PRIMARY KEY,
  file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY,
  file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL,
  download_count INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0)
);

CREATE INDEX IF NOT EXISTS share_links_created_by_created_idx ON share_links (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS recent_files (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recent_files_user_node_uq UNIQUE (user_id, file_node_id)
);

CREATE INDEX IF NOT EXISTS recent_files_user_last_accessed_idx ON recent_files (user_id, last_accessed DESC);

CREATE TABLE IF NOT EXISTS permission_requests (
  id BIGSERIAL PRIMARY KEY,
  requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_username TEXT NOT NULL,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_username TEXT NOT NULL,
  file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  requested_permission TEXT NOT NULL CHECK (requested_permission IN ('read', 'write')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL,
  resolved_by BIGINT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS permission_requests_pending_dedupe_uq
  ON permission_requests (requester_id, owner_id, requested_permission, file_node_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS permission_requests_owner_status_created_idx
  ON permission_requests (owner_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS permission_requests_requester_status_created_idx
  ON permission_requests (requester_id, status, created_at DESC);

-- -----------------------------------------------------------
-- Unchanged table
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS locks (
  lock_name_hash TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

COMMIT;
