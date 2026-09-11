'use strict';

function nowIso() {
  return new Date().toISOString();
}

function toIsoString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

module.exports = { nowIso, toIsoString };
