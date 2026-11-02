'use strict';

/**
 * Shared shaping/validation for the StorageUsageSnapshotsRepository dialect
 * twins (docs/spec/server/store/storageUsageSnapshotsStore.md). The day is a
 * caller-supplied UTC `YYYY-MM-DD` string in every method; byte totals are
 * non-negative integers.
 */

const { toIsoString } = require('../../utils/sharedHelpers');

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDay(day, field = 'day') {
  if (typeof day !== 'string' || !DAY_PATTERN.test(day)) {
    throw new TypeError(`${field} must be a UTC YYYY-MM-DD string`);
  }
  return day;
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new TypeError('upsertSnapshot requires a snapshot');
  }
  const userId = Number(snapshot.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new TypeError('upsertSnapshot requires a positive integer userId');
  }
  const bytes = Number(snapshot.bytes);
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new TypeError('upsertSnapshot bytes must be a non-negative integer');
  }
  return {
    userId,
    day: normalizeDay(snapshot.day),
    bytes,
  };
}

/** Driver row → domain-shaped snapshot row. */
function mapSnapshotRow(row) {
  return {
    userId: Number(row.user_id),
    day: String(row.day),
    bytes: Number(row.bytes),
    createdAt: toIsoString(row.created_at),
  };
}

module.exports = { normalizeDay, normalizeSnapshot, mapSnapshotRow };
