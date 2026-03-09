#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { sha256HexLower } = require('../store/metaPaths');
const storage = require('../store/storage');

const META_ROOT = '/.wea';
const USERS_DIR = `${META_ROOT}/users`;
const SETTINGS_PATH = `${META_ROOT}/settings.json`;
const PERMISSIONS_USERS_DIR = `${META_ROOT}/permissions/users`;
const PERMISSIONS_SHARES_DIR = `${META_ROOT}/permissions/shares`;
const SHARE_LINKS_DIR = `${META_ROOT}/share-links`;
const RECENT_FILES_DIR = `${META_ROOT}/recent-files`;
const PERMISSION_REQUESTS_PATH = `${META_ROOT}/permission_requests.json`;

const VALID_PERMISSION = new Set(['read', 'write', 'admin']);
const VALID_REQUEST_STATUS = new Set(['pending', 'approved', 'rejected', 'cancelled']);
const VALID_USER_STATUS = new Set(['pending', 'approved', 'rejected']);
const VALID_TARGET_TYPES = new Set(['folder', 'file']);

function parseArgs(argv) {
  const options = {
    sourceBackend: null,
    mode: 'dry-run',
    reportFile: null,
    fsDir: null,
    help: false,
  };

  for (const rawArg of argv) {
    if (!rawArg) continue;
    if (rawArg === '--help' || rawArg === '-h') {
      options.help = true;
      continue;
    }
    if (rawArg === '--dry-run') {
      options.mode = 'dry-run';
      continue;
    }
    if (rawArg === '--apply') {
      options.mode = 'apply';
      continue;
    }
    if (rawArg.startsWith('--source-backend=')) {
      options.sourceBackend = rawArg.split('=').slice(1).join('=').trim().toLowerCase();
      continue;
    }
    if (rawArg.startsWith('--report-file=')) {
      options.reportFile = rawArg.split('=').slice(1).join('=').trim();
      continue;
    }
    if (rawArg.startsWith('--fs-dir=')) {
      options.fsDir = rawArg.split('=').slice(1).join('=').trim();
      continue;
    }
    throw new Error(`Unknown argument: ${rawArg}`);
  }

  return options;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/migrateMetadataToPostgresql.js --source-backend=<fs|webdav> [--dry-run|--apply] [--report-file=<path>] [--fs-dir=<path>]

Examples:
  node scripts/migrateMetadataToPostgresql.js --source-backend=fs --dry-run --report-file=./migration-report.json
  node scripts/migrateMetadataToPostgresql.js --source-backend=fs --apply --report-file=./migration-report.json
  node scripts/migrateMetadataToPostgresql.js --source-backend=webdav --dry-run
`.trim());
}

function canonicalizePath(inputPath) {
  const normalized = normalizePath(String(inputPath || '/'));
  if (normalized !== '/' && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizePermission(permission) {
  if (!permission) return null;
  const value = String(permission).trim().toLowerCase();
  if (!VALID_PERMISSION.has(value)) return null;
  return value;
}

function normalizeRequestPermission(permission) {
  if (!permission) return null;
  const value = String(permission).trim().toLowerCase();
  if (value === 'read' || value === 'write') return value;
  return null;
}

function normalizeUserStatus(status) {
  if (!status) return 'pending';
  const value = String(status).trim().toLowerCase();
  return VALID_USER_STATUS.has(value) ? value : 'pending';
}

function normalizeRequestStatus(status) {
  if (!status) return 'pending';
  const value = String(status).trim().toLowerCase();
  return VALID_REQUEST_STATUS.has(value) ? value : null;
}

function normalizeTargetType(targetType, hasFilePath) {
  if (targetType) {
    const value = String(targetType).trim().toLowerCase();
    if (VALID_TARGET_TYPES.has(value)) return value;
  }
  return hasFilePath ? 'file' : 'folder';
}

function toInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function toIsoOrNow(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return new Date().toISOString();
}

async function fileExists(webdavPath) {
  try {
    return await storage.exists(webdavPath);
  } catch {
    return false;
  }
}

async function readJsonFile(webdavPath) {
  if (!(await fileExists(webdavPath))) return null;
  const raw = await storage.readFile(webdavPath);
  return safeJsonParse(Buffer.from(raw).toString('utf8'));
}

async function listJsonBasenames(directoryPath) {
  if (!(await fileExists(directoryPath))) return [];
  const items = await storage.listDir(directoryPath);
  return items
    .filter((item) => item.type !== 'directory' && item.basename && item.basename.endsWith('.json'))
    .map((item) => item.basename)
    .sort((a, b) => a.localeCompare(b));
}

async function loadSourceSnapshot() {
  const warnings = [];
  const skipped = {
    users: 0,
    settings: 0,
    permissions_user_paths: 0,
    permissions_user_files: 0,
    permissions_shares: 0,
    share_links: 0,
    recent_files: 0,
    permission_requests: 0,
  };

  const users = [];
  const settings = [];
  const permissionsUserPaths = [];
  const permissionsUserFiles = [];
  const permissionsShares = [];
  const shareLinks = [];
  const recentFiles = [];
  const permissionRequests = [];

  const userIds = new Set();
  const seenUserIds = new Set();

  const userBasenames = await listJsonBasenames(USERS_DIR);
  for (const basename of userBasenames) {
    if (basename === '_index.json') continue;
    const usernameFromFile = basename.replace(/\.json$/, '');
    const userDoc = await readJsonFile(`${USERS_DIR}/${basename}`);
    if (!userDoc || typeof userDoc !== 'object') {
      skipped.users++;
      warnings.push(`Skipped user file ${basename}: invalid JSON object`);
      continue;
    }

    const id = toInteger(userDoc.id);
    if (id == null || id <= 0) {
      skipped.users++;
      warnings.push(`Skipped user file ${basename}: invalid id`);
      continue;
    }
    if (seenUserIds.has(id)) {
      skipped.users++;
      warnings.push(`Skipped user id ${id}: duplicate id encountered`);
      continue;
    }
    seenUserIds.add(id);

    const username = String(userDoc.username || usernameFromFile || '').trim();
    const email = String(userDoc.email || '').trim().toLowerCase();
    if (!username || !email) {
      skipped.users++;
      warnings.push(`Skipped user id ${id}: missing username/email`);
      continue;
    }

    const password = String(userDoc.password || '');
    if (!password) {
      skipped.users++;
      warnings.push(`Skipped user id ${id}: missing password hash`);
      continue;
    }

    users.push({
      id,
      username,
      email,
      email_hash: String(userDoc.email_hash || sha256HexLower(email)),
      password,
      status: normalizeUserStatus(userDoc.status),
      is_admin: Boolean(userDoc.is_admin),
      token_version: toInteger(userDoc.token_version) ?? 0,
      created_at: toIsoOrNow(userDoc.created_at),
      updated_at: toIsoOrNow(userDoc.updated_at || userDoc.created_at),
    });
    userIds.add(id);
  }

  const settingsDoc = await readJsonFile(SETTINGS_PATH);
  if (settingsDoc && typeof settingsDoc === 'object') {
    for (const [key, value] of Object.entries(settingsDoc)) {
      if (key === 'updated_at') continue;
      settings.push({
        key: String(key),
        value: String(value),
      });
    }
  } else {
    warnings.push('Settings file missing or invalid; settings migration will be skipped');
    skipped.settings++;
  }

  const permissionUserFiles = await listJsonBasenames(PERMISSIONS_USERS_DIR);
  const seenUserPathPerm = new Set();
  const seenUserFilePerm = new Set();
  for (const basename of permissionUserFiles) {
    const userId = toInteger(basename.replace(/\.json$/, ''));
    if (userId == null || userId <= 0) {
      skipped.permissions_user_paths++;
      skipped.permissions_user_files++;
      warnings.push(`Skipped permission doc ${basename}: invalid user id filename`);
      continue;
    }
    if (!userIds.has(userId)) {
      skipped.permissions_user_paths++;
      skipped.permissions_user_files++;
      warnings.push(`Skipped permission doc ${basename}: user id ${userId} not found in source users`);
      continue;
    }

    const permissionDoc = await readJsonFile(`${PERMISSIONS_USERS_DIR}/${basename}`);
    if (!permissionDoc || typeof permissionDoc !== 'object') {
      skipped.permissions_user_paths++;
      skipped.permissions_user_files++;
      warnings.push(`Skipped permission doc ${basename}: invalid JSON object`);
      continue;
    }

    const folderPermissions = permissionDoc.permissions && typeof permissionDoc.permissions === 'object'
      ? permissionDoc.permissions
      : {};
    const filePermissions = permissionDoc.file_permissions && typeof permissionDoc.file_permissions === 'object'
      ? permissionDoc.file_permissions
      : {};

    for (const [folderPath, permissionRaw] of Object.entries(folderPermissions)) {
      const permission = normalizePermission(permissionRaw);
      if (!permission) {
        skipped.permissions_user_paths++;
        warnings.push(`Skipped folder permission for user ${userId}: invalid permission at ${folderPath}`);
        continue;
      }
      const canonicalPath = canonicalizePath(folderPath);
      const dedupeKey = `${userId}:${canonicalPath}`;
      if (seenUserPathPerm.has(dedupeKey)) continue;
      seenUserPathPerm.add(dedupeKey);
      permissionsUserPaths.push({
        user_id: userId,
        folder_path: canonicalPath,
        permission,
      });
    }

    for (const [filePath, permissionRaw] of Object.entries(filePermissions)) {
      const permission = normalizePermission(permissionRaw);
      if (!permission) {
        skipped.permissions_user_files++;
        warnings.push(`Skipped file permission for user ${userId}: invalid permission at ${filePath}`);
        continue;
      }
      const canonicalPath = canonicalizePath(filePath);
      const dedupeKey = `${userId}:${canonicalPath}`;
      if (seenUserFilePerm.has(dedupeKey)) continue;
      seenUserFilePerm.add(dedupeKey);
      permissionsUserFiles.push({
        user_id: userId,
        file_path: canonicalPath,
        permission,
      });
    }
  }

  const sharePermissionFiles = await listJsonBasenames(PERMISSIONS_SHARES_DIR);
  for (const basename of sharePermissionFiles) {
    const token = basename.replace(/\.json$/, '');
    if (!token) {
      skipped.permissions_shares++;
      warnings.push(`Skipped share permission ${basename}: empty token`);
      continue;
    }
    const doc = await readJsonFile(`${PERMISSIONS_SHARES_DIR}/${basename}`);
    if (!doc || typeof doc !== 'object') {
      skipped.permissions_shares++;
      warnings.push(`Skipped share permission ${basename}: invalid JSON object`);
      continue;
    }
    const permission = normalizePermission(doc.permission || 'read');
    if (!permission) {
      skipped.permissions_shares++;
      warnings.push(`Skipped share permission ${basename}: invalid permission`);
      continue;
    }
    permissionsShares.push({
      token,
      root_path: canonicalizePath(doc.rootPath || '/'),
      is_directory: Boolean(doc.isDirectory),
      permission,
      updated_at: toIsoOrNow(doc.updated_at),
    });
  }

  const shareLinkFiles = await listJsonBasenames(SHARE_LINKS_DIR);
  const seenShareTokens = new Set();
  for (const basename of shareLinkFiles) {
    const tokenFromFile = basename.replace(/\.json$/, '');
    const doc = await readJsonFile(`${SHARE_LINKS_DIR}/${basename}`);
    if (!doc || typeof doc !== 'object') {
      skipped.share_links++;
      warnings.push(`Skipped share link ${basename}: invalid JSON object`);
      continue;
    }

    const token = String(doc.token || tokenFromFile || '').trim();
    if (!token) {
      skipped.share_links++;
      warnings.push(`Skipped share link ${basename}: empty token`);
      continue;
    }
    if (seenShareTokens.has(token)) {
      skipped.share_links++;
      warnings.push(`Skipped share link token ${token}: duplicate token`);
      continue;
    }

    const createdBy = toInteger(doc.createdBy);
    if (createdBy == null || !userIds.has(createdBy)) {
      skipped.share_links++;
      warnings.push(`Skipped share link ${token}: createdBy user is missing`);
      continue;
    }

    seenShareTokens.add(token);
    shareLinks.push({
      token,
      file_path: canonicalizePath(doc.filePath || '/'),
      created_by: createdBy,
      created_at: toIsoOrNow(doc.createdAt),
      expires_at: doc.expiresAt ? toIsoOrNow(doc.expiresAt) : null,
      download_count: Math.max(0, toInteger(doc.downloadCount) ?? 0),
    });
  }

  const recentFileDocs = await listJsonBasenames(RECENT_FILES_DIR);
  for (const basename of recentFileDocs) {
    const userId = toInteger(basename.replace(/\.json$/, ''));
    if (userId == null || !userIds.has(userId)) {
      skipped.recent_files++;
      warnings.push(`Skipped recent files ${basename}: user does not exist in source users`);
      continue;
    }
    const doc = await readJsonFile(`${RECENT_FILES_DIR}/${basename}`);
    if (!Array.isArray(doc)) {
      skipped.recent_files++;
      warnings.push(`Skipped recent files ${basename}: expected array`);
      continue;
    }

    const seenUserPaths = new Set();
    for (const item of doc) {
      if (!item || typeof item !== 'object' || !item.path) {
        skipped.recent_files++;
        continue;
      }
      const canonicalPath = canonicalizePath(item.path);
      if (seenUserPaths.has(canonicalPath)) continue;
      seenUserPaths.add(canonicalPath);
      recentFiles.push({
        user_id: userId,
        path: canonicalPath,
        name: String(item.name || path.posix.basename(canonicalPath) || ''),
        type: String(item.type || 'file'),
        last_accessed: toIsoOrNow(item.lastAccessed),
      });
      if (seenUserPaths.size >= 20) break;
    }
  }

  const requestDoc = await readJsonFile(PERMISSION_REQUESTS_PATH);
  const requestRows = Array.isArray(requestDoc?.requests) ? requestDoc.requests : [];
  const seenRequestIds = new Set();
  for (const raw of requestRows) {
    if (!raw || typeof raw !== 'object') {
      skipped.permission_requests++;
      continue;
    }
    const id = toInteger(raw.id);
    if (id == null || id <= 0) {
      skipped.permission_requests++;
      warnings.push('Skipped permission request: invalid id');
      continue;
    }
    if (seenRequestIds.has(id)) {
      skipped.permission_requests++;
      warnings.push(`Skipped permission request ${id}: duplicate id`);
      continue;
    }

    const requesterId = toInteger(raw.requester_id);
    const ownerId = toInteger(raw.owner_id);
    if (requesterId == null || ownerId == null || !userIds.has(requesterId) || !userIds.has(ownerId)) {
      skipped.permission_requests++;
      warnings.push(`Skipped permission request ${id}: requester/owner missing`);
      continue;
    }

    const requestedPermission = normalizeRequestPermission(raw.requested_permission);
    const status = normalizeRequestStatus(raw.status);
    if (!requestedPermission || !status) {
      skipped.permission_requests++;
      warnings.push(`Skipped permission request ${id}: invalid permission/status`);
      continue;
    }

    const folderPath = raw.folder_path ? canonicalizePath(raw.folder_path) : null;
    const filePath = raw.file_path ? canonicalizePath(raw.file_path) : null;
    const targetType = normalizeTargetType(raw.target_type, Boolean(filePath));

    if (targetType === 'folder' && !folderPath) {
      skipped.permission_requests++;
      warnings.push(`Skipped permission request ${id}: folder target missing folder_path`);
      continue;
    }
    if (targetType === 'file' && !filePath) {
      skipped.permission_requests++;
      warnings.push(`Skipped permission request ${id}: file target missing file_path`);
      continue;
    }

    seenRequestIds.add(id);
    permissionRequests.push({
      id,
      requester_id: requesterId,
      requester_username: String(raw.requester_username || ''),
      owner_id: ownerId,
      owner_username: String(raw.owner_username || ''),
      target_type: targetType,
      folder_path: targetType === 'folder' ? folderPath : null,
      file_path: targetType === 'file' ? filePath : null,
      requested_permission: requestedPermission,
      status,
      message: String(raw.message || ''),
      created_at: toIsoOrNow(raw.created_at),
      resolved_at: raw.resolved_at ? toIsoOrNow(raw.resolved_at) : null,
      resolved_by: toInteger(raw.resolved_by),
    });
  }

  users.sort((a, b) => a.id - b.id);
  permissionRequests.sort((a, b) => a.id - b.id);

  return {
    users,
    settings,
    permissionsUserPaths,
    permissionsUserFiles,
    permissionsShares,
    shareLinks,
    recentFiles,
    permissionRequests,
    warnings,
    skipped,
  };
}

async function applySnapshot(snapshot) {
  await storage.withTransaction(async (client) => {
    for (const user of snapshot.users) {
      await client.query(
        `INSERT INTO users (
           id, username, email, email_hash, password, status, is_admin, token_version, created_at, updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id)
         DO UPDATE
           SET username = EXCLUDED.username,
               email = EXCLUDED.email,
               email_hash = EXCLUDED.email_hash,
               password = EXCLUDED.password,
               status = EXCLUDED.status,
               is_admin = EXCLUDED.is_admin,
               token_version = EXCLUDED.token_version,
               created_at = EXCLUDED.created_at,
               updated_at = EXCLUDED.updated_at`,
        [
          user.id,
          user.username,
          user.email,
          user.email_hash,
          user.password,
          user.status,
          user.is_admin,
          user.token_version,
          user.created_at,
          user.updated_at,
        ]
      );
    }

    for (const row of snapshot.settings) {
      await client.query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key)
         DO UPDATE
           SET value = EXCLUDED.value,
               updated_at = NOW()`,
        [row.key, JSON.stringify(row.value)]
      );
    }

    for (const row of snapshot.permissionsUserPaths) {
      await client.query(
        `INSERT INTO permissions_user_paths (user_id, folder_path, permission, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (user_id, folder_path)
         DO UPDATE
           SET permission = EXCLUDED.permission,
               updated_at = NOW()`,
        [row.user_id, row.folder_path, row.permission]
      );
    }

    for (const row of snapshot.permissionsUserFiles) {
      await client.query(
        `INSERT INTO permissions_user_files (user_id, file_path, permission, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (user_id, file_path)
         DO UPDATE
           SET permission = EXCLUDED.permission,
               updated_at = NOW()`,
        [row.user_id, row.file_path, row.permission]
      );
    }

    for (const row of snapshot.permissionsShares) {
      await client.query(
        `INSERT INTO permissions_shares (token, root_path, is_directory, permission, updated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (token)
         DO UPDATE
           SET root_path = EXCLUDED.root_path,
               is_directory = EXCLUDED.is_directory,
               permission = EXCLUDED.permission,
               updated_at = EXCLUDED.updated_at`,
        [row.token, row.root_path, row.is_directory, row.permission, row.updated_at]
      );
    }

    for (const row of snapshot.shareLinks) {
      await client.query(
        `INSERT INTO share_links (token, file_path, created_by, created_at, expires_at, download_count)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (token)
         DO UPDATE
           SET file_path = EXCLUDED.file_path,
               created_by = EXCLUDED.created_by,
               created_at = EXCLUDED.created_at,
               expires_at = EXCLUDED.expires_at,
               download_count = EXCLUDED.download_count`,
        [row.token, row.file_path, row.created_by, row.created_at, row.expires_at, row.download_count]
      );
    }

    for (const row of snapshot.recentFiles) {
      await client.query(
        `INSERT INTO recent_files (user_id, path, name, type, last_accessed)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, path)
         DO UPDATE
           SET name = EXCLUDED.name,
               type = EXCLUDED.type,
               last_accessed = EXCLUDED.last_accessed`,
        [row.user_id, row.path, row.name, row.type, row.last_accessed]
      );
    }

    for (const row of snapshot.permissionRequests) {
      await client.query(
        `INSERT INTO permission_requests (
           id, requester_id, requester_username, owner_id, owner_username, target_type,
           folder_path, file_path, requested_permission, status, message, created_at, resolved_at, resolved_by
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id)
         DO UPDATE
           SET requester_id = EXCLUDED.requester_id,
               requester_username = EXCLUDED.requester_username,
               owner_id = EXCLUDED.owner_id,
               owner_username = EXCLUDED.owner_username,
               target_type = EXCLUDED.target_type,
               folder_path = EXCLUDED.folder_path,
               file_path = EXCLUDED.file_path,
               requested_permission = EXCLUDED.requested_permission,
               status = EXCLUDED.status,
               message = EXCLUDED.message,
               created_at = EXCLUDED.created_at,
               resolved_at = EXCLUDED.resolved_at,
               resolved_by = EXCLUDED.resolved_by`,
        [
          row.id,
          row.requester_id,
          row.requester_username,
          row.owner_id,
          row.owner_username,
          row.target_type,
          row.folder_path,
          row.file_path,
          row.requested_permission,
          row.status,
          row.message,
          row.created_at,
          row.resolved_at,
          row.resolved_by,
        ]
      );
    }

    await client.query(
      `SELECT setval(
         pg_get_serial_sequence('users', 'id'),
         COALESCE((SELECT MAX(id) FROM users), 1),
         true
       )`
    );
    await client.query(
      `SELECT setval(
         pg_get_serial_sequence('permission_requests', 'id'),
         COALESCE((SELECT MAX(id) FROM permission_requests), 1),
         true
       )`
    );
  });
}

async function readTargetCounts() {
  const pool = storage.getPgPool();
  const tableMap = {
    users: 'users',
    settings: 'settings',
    permissions_user_paths: 'permissions_user_paths',
    permissions_user_files: 'permissions_user_files',
    permissions_shares: 'permissions_shares',
    share_links: 'share_links',
    recent_files: 'recent_files',
    permission_requests: 'permission_requests',
  };

  const entries = await Promise.all(
    Object.entries(tableMap).map(async ([key, tableName]) => {
      const res = await pool.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`);
      return [key, Number(res.rows[0].count)];
    })
  );

  return Object.fromEntries(entries);
}

function buildExpectedCounts(snapshot) {
  return {
    users: snapshot.users.length,
    settings: snapshot.settings.length,
    permissions_user_paths: snapshot.permissionsUserPaths.length,
    permissions_user_files: snapshot.permissionsUserFiles.length,
    permissions_shares: snapshot.permissionsShares.length,
    share_links: snapshot.shareLinks.length,
    recent_files: snapshot.recentFiles.length,
    permission_requests: snapshot.permissionRequests.length,
  };
}

function createPermissionValueBucket() {
  return {
    read: 0,
    write: 0,
    admin: 0,
  };
}

function buildPermissionValueCounts(snapshot) {
  const source = {
    permissions_user_paths: createPermissionValueBucket(),
    permissions_user_files: createPermissionValueBucket(),
    permissions_shares: createPermissionValueBucket(),
    permission_requests_requested_permission: createPermissionValueBucket(),
  };

  for (const row of snapshot.permissionsUserPaths || []) {
    if (source.permissions_user_paths[row.permission] !== undefined) {
      source.permissions_user_paths[row.permission] += 1;
    }
  }
  for (const row of snapshot.permissionsUserFiles || []) {
    if (source.permissions_user_files[row.permission] !== undefined) {
      source.permissions_user_files[row.permission] += 1;
    }
  }
  for (const row of snapshot.permissionsShares || []) {
    if (source.permissions_shares[row.permission] !== undefined) {
      source.permissions_shares[row.permission] += 1;
    }
  }
  for (const row of snapshot.permissionRequests || []) {
    const p = row.requested_permission;
    if (source.permission_requests_requested_permission[p] !== undefined) {
      source.permission_requests_requested_permission[p] += 1;
    }
  }

  return source;
}

async function readTargetPermissionValueCounts() {
  const pool = storage.getPgPool();
  const [pathRes, fileRes, shareRes, requestRes] = await Promise.all([
    pool.query(
      `SELECT permission, COUNT(*)::int AS count
         FROM permissions_user_paths
        GROUP BY permission`
    ),
    pool.query(
      `SELECT permission, COUNT(*)::int AS count
         FROM permissions_user_files
        GROUP BY permission`
    ),
    pool.query(
      `SELECT permission, COUNT(*)::int AS count
         FROM permissions_shares
        GROUP BY permission`
    ),
    pool.query(
      `SELECT requested_permission AS permission, COUNT(*)::int AS count
         FROM permission_requests
        GROUP BY requested_permission`
    ),
  ]);

  const target = {
    permissions_user_paths: createPermissionValueBucket(),
    permissions_user_files: createPermissionValueBucket(),
    permissions_shares: createPermissionValueBucket(),
    permission_requests_requested_permission: createPermissionValueBucket(),
  };

  for (const row of pathRes.rows) {
    if (target.permissions_user_paths[row.permission] !== undefined) {
      target.permissions_user_paths[row.permission] = Number(row.count);
    }
  }
  for (const row of fileRes.rows) {
    if (target.permissions_user_files[row.permission] !== undefined) {
      target.permissions_user_files[row.permission] = Number(row.count);
    }
  }
  for (const row of shareRes.rows) {
    if (target.permissions_shares[row.permission] !== undefined) {
      target.permissions_shares[row.permission] = Number(row.count);
    }
  }
  for (const row of requestRes.rows) {
    if (target.permission_requests_requested_permission[row.permission] !== undefined) {
      target.permission_requests_requested_permission[row.permission] = Number(row.count);
    }
  }

  return target;
}

function buildReport({ options, snapshot, targetCounts = null, targetPermissionValueCounts = null }) {
  const expectedCounts = buildExpectedCounts(snapshot);
  const sourcePermissionValueCounts = buildPermissionValueCounts(snapshot);
  const validation = {};
  for (const [tableName, expected] of Object.entries(expectedCounts)) {
    const actual = targetCounts ? targetCounts[tableName] : null;
    validation[tableName] = {
      expected_from_source: expected,
      actual_in_db: actual,
      status: actual == null ? 'not_checked' : actual >= expected ? 'ok' : 'mismatch',
    };
  }

  return {
    generated_at: new Date().toISOString(),
    mode: options.mode,
    source_backend: options.sourceBackend,
    source_meta_root: META_ROOT,
    expected_counts: expectedCounts,
    permission_value_counts: {
      source: sourcePermissionValueCounts,
      target: targetPermissionValueCounts,
    },
    skipped_counts: snapshot.skipped,
    warning_count: snapshot.warnings.length,
    warnings: snapshot.warnings,
    validation,
  };
}

async function writeReportFile(reportFile, report) {
  const resolvedPath = path.resolve(process.cwd(), reportFile);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, JSON.stringify(report, null, 2), 'utf8');
  return resolvedPath;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (options.sourceBackend !== 'fs' && options.sourceBackend !== 'webdav') {
    throw new Error('--source-backend must be one of: fs, webdav');
  }

  if (options.fsDir && options.sourceBackend !== 'fs') {
    throw new Error('--fs-dir can only be used with --source-backend=fs');
  }

  const originalBackend = process.env.WEA_STORAGE_BACKEND;
  const originalFsDir = process.env.WEA_FS_DIR;

  try {
    process.env.WEA_STORAGE_BACKEND = options.sourceBackend;
    if (options.fsDir) {
      process.env.WEA_FS_DIR = path.resolve(process.cwd(), options.fsDir);
    }

    await storage.getPgPool().query('SELECT 1');

    const snapshot = await loadSourceSnapshot();

    let targetCounts = null;
    let targetPermissionValueCounts = null;
    if (options.mode === 'apply') {
      await applySnapshot(snapshot);
      targetCounts = await readTargetCounts();
      targetPermissionValueCounts = await readTargetPermissionValueCounts();
    }

    const report = buildReport({ options, snapshot, targetCounts, targetPermissionValueCounts });
    const statusIcon = options.mode === 'apply' ? 'APPLIED' : 'DRY-RUN';
    console.log(`[metadata-migrator] ${statusIcon} complete`);
    console.log(`[metadata-migrator] warnings: ${report.warning_count}`);
    console.log(JSON.stringify(report, null, 2));

    if (options.reportFile) {
      const reportPath = await writeReportFile(options.reportFile, report);
      console.log(`[metadata-migrator] report written to ${reportPath}`);
    }
  } finally {
    process.env.WEA_STORAGE_BACKEND = originalBackend;
    process.env.WEA_FS_DIR = originalFsDir;
    await storage.closePgPool();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error('[metadata-migrator] failed:', error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  canonicalizePath,
  buildExpectedCounts,
  buildPermissionValueCounts,
  normalizePermission,
  normalizeRequestPermission,
  normalizeUserStatus,
  normalizeRequestStatus,
  normalizeTargetType,
};
