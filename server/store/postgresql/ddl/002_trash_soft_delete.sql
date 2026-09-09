-- ============================================================
-- 002 — Trash soft-delete schema slice (DEF-16 P1)
-- Adds file_nodes.deleted_at (orthogonal to sync_status) and
-- converts the (parent_id, name) uniqueness — including the
-- root variant — to partial unique indexes over
-- deleted_at IS NULL, so trashed siblings may share names
-- while live uniqueness is preserved.
-- Never edit 001: applied-DDL checksum drift is a hard error.
-- SQLite note: the transpiler (convertPostgresToSqlite) rewrites
-- the DROP CONSTRAINT statement below into a table rebuild,
-- because SQLite cannot drop a table-level UNIQUE constraint
-- in place.
-- ============================================================

BEGIN;

ALTER TABLE file_nodes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

ALTER TABLE file_nodes DROP CONSTRAINT IF EXISTS file_nodes_unique_name_per_parent;

DROP INDEX IF EXISTS file_nodes_root_unique;

CREATE UNIQUE INDEX IF NOT EXISTS file_nodes_unique_name_per_parent
  ON file_nodes (parent_id, name) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS file_nodes_root_unique
  ON file_nodes (name) WHERE parent_id IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS file_nodes_children_idx ON file_nodes (parent_id, created_at DESC);

COMMIT;
