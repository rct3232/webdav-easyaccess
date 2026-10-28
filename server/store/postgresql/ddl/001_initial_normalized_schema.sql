-- ============================================================
-- WebDAV EasyAccess — Normalized Schema (Final State)
-- PostgreSQL 16 target; SQLite-compatible via conversion layer.
-- Single source of truth for all metadata tables.
-- Includes file_nodes.deleted_at (trash soft-delete marker).
-- Includes the FULL §5 AI-platform schema (P0–P4, AI tables included):
-- collections platform, usage signals, undo journal, suggestions,
-- admin reports, LLM/AI foundation. Derived vector artifacts
-- (pgvector shadow tables, sqlite vec0 virtual tables) are NOT here —
-- they are owned by the vectorStore adapter (§4.13).
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
  deleted_at TIMESTAMPTZ DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS file_nodes_root_unique ON file_nodes (name) WHERE parent_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS file_nodes_unique_name_per_parent ON file_nodes (parent_id, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS file_nodes_children_idx ON file_nodes (parent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS object_map (
  id BIGSERIAL PRIMARY KEY,
  file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  s3_key TEXT DEFAULT NULL,
  storage_backend TEXT NOT NULL DEFAULT 's3' CHECK (storage_backend IN ('s3', 'webdav')),
  version_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'history', 'orphaned')),
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

-- -----------------------------------------------------------
-- §5 Collections platform (P0)
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS collections (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_locked BOOLEAN NOT NULL DEFAULT FALSE,
  origin TEXT NOT NULL CHECK (origin IN ('system', 'user', 'seed', 'search')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  definition JSONB DEFAULT NULL,
  publish_mode TEXT NOT NULL DEFAULT 'ask' CHECK (publish_mode IN ('ask', 'off', 'auto')),
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  pinned_by TEXT DEFAULT NULL CHECK (pinned_by IN ('user', 'auto')),
  archived_at TIMESTAMPTZ DEFAULT NULL,
  last_member_change_at TIMESTAMPTZ DEFAULT NULL,
  activity_score REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Name uniqueness per owner over ACTIVE rows only (archived names may repeat).
CREATE UNIQUE INDEX IF NOT EXISTS collections_owner_name_active_uq
  ON collections (owner_id, name) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS collections_owner_status_idx ON collections (owner_id, status);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  added_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  published BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'system', 'seed', 'search')),
  reason TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, node_id)
);

CREATE INDEX IF NOT EXISTS collection_items_node_idx ON collection_items (node_id);

CREATE TABLE IF NOT EXISTS collection_exclusions (
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, node_id)
);

CREATE TABLE IF NOT EXISTS collection_grants (
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  grantee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  granted_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, grantee_id)
);

CREATE INDEX IF NOT EXISTS collection_grants_grantee_idx ON collection_grants (grantee_id);

CREATE TABLE IF NOT EXISTS collection_visibility (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  hidden BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, collection_id)
);

CREATE TABLE IF NOT EXISTS collection_tombstones (
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  def_fingerprint TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, def_fingerprint)
);

CREATE TABLE IF NOT EXISTS collection_digest_cursors (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  last_visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, collection_id)
);

CREATE TABLE IF NOT EXISTS collection_merge_suggestions (
  id BIGSERIAL PRIMARY KEY,
  a_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  b_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  score BIGINT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'merged', 'dismissed', 'rejected')),
  dismiss_count INTEGER NOT NULL DEFAULT 0,
  dismissed_at TIMESTAMPTZ DEFAULT NULL,
  rejected_at TIMESTAMPTZ DEFAULT NULL,
  arbiter_verdict TEXT DEFAULT NULL,
  arbiter_reason TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT collection_merge_suggestions_pair_uq UNIQUE (a_id, b_id)
);

CREATE INDEX IF NOT EXISTS collection_merge_suggestions_state_idx
  ON collection_merge_suggestions (state);

CREATE TABLE IF NOT EXISTS file_likes (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, node_id)
);

-- -----------------------------------------------------------
-- §5 Usage signals + undo journal (P0)
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS usage_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  action TEXT NOT NULL
    CHECK (action IN ('open', 'download', 'preview', 'search_hit', 'like')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS usage_events_node_created_idx ON usage_events (node_id, created_at);
CREATE INDEX IF NOT EXISTS usage_events_user_created_idx ON usage_events (user_id, created_at);

CREATE TABLE IF NOT EXISTS node_activity (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  opens INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  previews INTEGER NOT NULL DEFAULT 0,
  search_hits INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ DEFAULT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, node_id)
);

CREATE TABLE IF NOT EXISTS action_journal (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL
    CHECK (domain IN ('collection', 'batch', 'settings', 'permissions', 'tags', 'file', 'sharing')),
  subject TEXT NOT NULL,
  subject_label TEXT DEFAULT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB DEFAULT NULL,
  chain_seq BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'undone', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  undone_at TIMESTAMPTZ DEFAULT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT action_journal_subject_chain_uq UNIQUE (domain, subject, chain_seq)
);

CREATE INDEX IF NOT EXISTS action_journal_created_idx ON action_journal (created_at DESC);

-- -----------------------------------------------------------
-- §5 Suggestions + admin reports (P0/P3/P4)
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS file_suggestions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  reason JSONB DEFAULT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS file_suggestions_user_state_idx ON file_suggestions (user_id, state);

CREATE TABLE IF NOT EXISTS admin_reports (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('gc', 'migration', 'failsafe', 'night_eval', 'cleanup')),
  status TEXT NOT NULL,
  payload JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_reports_kind_created_idx ON admin_reports (kind, created_at DESC);

-- -----------------------------------------------------------
-- §5 AI foundation (P1–P4). llm_models is declared BEFORE every
-- table that references it (FK ordering — PLAN §6 DDL policy).
-- -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS llm_models (
  id BIGSERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('embed', 'chat', 'vision', 'asr')),
  provider TEXT NOT NULL,
  engine TEXT NOT NULL DEFAULT 'remote' CHECK (engine IN ('embedded', 'remote')),
  base_url_key TEXT NOT NULL,
  model_name TEXT NOT NULL,
  precision TEXT DEFAULT NULL,
  model_revision TEXT DEFAULT NULL,
  max_input_chars INTEGER DEFAULT NULL,
  chunk_budget INTEGER DEFAULT NULL,
  batch_size INTEGER DEFAULT NULL,
  reasoning TEXT NOT NULL DEFAULT 'off' CHECK (reasoning IN ('on', 'off')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS llm_models_role_idx ON llm_models (role);

CREATE TABLE IF NOT EXISTS collection_centroids (
  collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  model_id BIGINT NOT NULL REFERENCES llm_models(id),
  centroid TEXT NOT NULL,
  member_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, model_id)
);

CREATE TABLE IF NOT EXISTS ai_tag_raw (
  node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (node_id, tag)
);

CREATE INDEX IF NOT EXISTS ai_tag_raw_tag_idx ON ai_tag_raw (tag);

CREATE TABLE IF NOT EXISTS embeddings (
  node_id BIGINT PRIMARY KEY REFERENCES file_nodes(id) ON DELETE CASCADE,
  model_id BIGINT NOT NULL REFERENCES llm_models(id),
  dim INTEGER NOT NULL,
  vector TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('fulltext', 'chunk_pool', 'head', 'metadata_only', 'media_direct')),
  content_hash TEXT DEFAULT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS embeddings_chunk (
  node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  chunk_idx SMALLINT NOT NULL,
  vector TEXT NOT NULL,
  model_id BIGINT NOT NULL REFERENCES llm_models(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (node_id, chunk_idx)
);

CREATE TABLE IF NOT EXISTS ai_enrichments (
  node_id BIGINT PRIMARY KEY REFERENCES file_nodes(id) ON DELETE CASCADE,
  features_model_id BIGINT DEFAULT NULL REFERENCES llm_models(id),
  schema_version INTEGER NOT NULL DEFAULT 1,
  tags JSONB DEFAULT NULL,
  summary TEXT DEFAULT NULL,
  caption TEXT DEFAULT NULL,
  caption_model_id BIGINT DEFAULT NULL REFERENCES llm_models(id),
  transcript TEXT DEFAULT NULL,
  asr_model_id BIGINT DEFAULT NULL REFERENCES llm_models(id),
  probe JSONB DEFAULT NULL,
  truncated BOOLEAN NOT NULL DEFAULT FALSE,
  media_kind TEXT DEFAULT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('embed', 'features', 'caption', 'asr', 'backfill')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed', 'skipped')),
  attempt INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ DEFAULT NULL,
  last_error TEXT DEFAULT NULL,
  content_hash TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ DEFAULT NULL,
  finished_at TIMESTAMPTZ DEFAULT NULL,
  CONSTRAINT ai_jobs_node_kind_generation_uq UNIQUE (node_id, kind, generation)
);

CREATE INDEX IF NOT EXISTS ai_jobs_status_next_retry_idx ON ai_jobs (status, next_retry_at);

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  day TEXT NOT NULL,
  role TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  input_chars BIGINT NOT NULL DEFAULT 0,
  cached INTEGER NOT NULL DEFAULT 0,
  degraded INTEGER NOT NULL DEFAULT 0,
  failed_429 INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, role)
);

CREATE TABLE IF NOT EXISTS query_parses (
  normalized_query TEXT PRIMARY KEY,
  predicates JSONB NOT NULL,
  vector TEXT DEFAULT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
