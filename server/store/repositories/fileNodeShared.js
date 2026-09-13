'use strict';

function mapNodeRow(row) {
  if (!row) return null;
  const base = {
    id: Number(row.id),
    parentId: row.parent_id != null ? Number(row.parent_id) : null,
    name: row.name,
    type: row.type,
    syncStatus: row.sync_status,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    deletedAt: row.deleted_at || null,
  };
  // Filecache-joined reads (getNode, getTrashChildren, getTopmostTrashedNodes)
  // carry size/mime_type columns; plain file_nodes reads must stay unchanged.
  if (row.size !== undefined && row.size !== null) {
    base.size = Number(row.size);
  }
  if (row.mime_type !== undefined) {
    base.mimeType = row.mime_type;
  }
  return base;
}

// Children rows (file_nodes LEFT JOIN filecache) carry size/mime/hash columns.
function mapChildRow(row) {
  if (!row) return null;
  const base = {
    id: Number(row.id),
    parentId: row.parent_id != null ? Number(row.parent_id) : null,
    name: row.name,
    type: row.type,
    syncStatus: row.sync_status,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    deletedAt: row.deleted_at || null,
  };
  if (row.size !== undefined && row.size !== null) {
    base.size = Number(row.size);
  }
  if (row.mime_type !== undefined) {
    base.mimeType = row.mime_type;
  }
  if (row.content_hash !== undefined) {
    base.contentHash = row.content_hash;
  }
  return base;
}

module.exports = { mapNodeRow, mapChildRow };
