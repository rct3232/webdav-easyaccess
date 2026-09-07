'use strict';

const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../../utils/errorHandler');
const { toIsoString } = require('../../utils/sharedHelpers');

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function mapUserRow(row) {
  if (!row) return undefined;
  return {
    id: Number(row.id),
    username: row.username,
    email: row.email,
    email_hash: row.email_hash,
    password: row.password,
    status: row.status,
    is_admin: row.is_admin ? 1 : 0,
    token_version: Number.isInteger(row.token_version)
      ? row.token_version
      : Number(row.token_version || 0),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

function requireCreateFields({ username, email, passwordHash }) {
  if (!username || !email || !passwordHash) {
    throw createError(SERVER_ERROR_CODES.admin.createUserRequiredFields, 400);
  }
}

function throwUsernameTaken() {
  throw createError(SERVER_ERROR_CODES.admin.usernameTaken, 409);
}

function throwEmailTaken() {
  throw createError(SERVER_ERROR_CODES.auth.emailTaken, 409);
}

function throwUserNotFound() {
  throw createError(SERVER_ERROR_CODES.admin.userNotFound, 404);
}

function throwEmailRequired() {
  throw createError(SERVER_ERROR_CODES.users.emailRequired, 400);
}

module.exports = {
  normalizeEmail,
  mapUserRow,
  requireCreateFields,
  throwUsernameTaken,
  throwEmailTaken,
  throwUserNotFound,
  throwEmailRequired,
};
