'use strict';

const { toIsoString } = require('../../utils/sharedHelpers');
const { parseJsonColumn } = require('./rowMappers');

function mapActionRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    domain: row.domain,
    subject: row.subject,
    subjectLabel: row.subject_label,
    actor: row.actor,
    action: row.action,
    payload: parseJsonColumn(row.payload),
    chainSeq: Number(row.chain_seq),
    status: row.status,
    createdAt: toIsoString(row.created_at),
    undoneAt: toIsoString(row.undone_at),
    expiresAt: toIsoString(row.expires_at),
  };
}

module.exports = { mapActionRow };
