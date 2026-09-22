'use strict';

// Row-shaping helpers shared by the repository dialect twins. jsonb (PG)
// round-trips as an object; sqlite TEXT carries the JSON string. sqlite stores
// booleans as 0/1; PG returns real booleans.

function parseJsonColumn(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function toBoolean(value) {
  return value === true || Number(value) === 1;
}

module.exports = { parseJsonColumn, toBoolean };
