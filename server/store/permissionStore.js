const {
  META_ROOT,
  PERMISSIONS_DIR,
  PERMISSIONS_USERS_DIR,
  userPermissionsPathByUserId,
  userMetaDirByUsername,
  userPermissionsMirrorPathByUsername,
  normalizeWebdavPath,
} = require('./metaPaths');
const { ensureDir, exists, readFile, writeFile } = require('./storage');
const { withLock } = require('./locks');
const userStore = require('./userStore');

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const cache = new Map(); // userId -> { expiresAt:number, data: object }
const CACHE_TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 1000;

async function ensureDirs() {
  await ensureDir(META_ROOT);
  await ensureDir(PERMISSIONS_DIR);
  await ensureDir(PERMISSIONS_USERS_DIR);
}

async function ensureUserPermissionsFile(userId) {
  await ensureDirs();
  const p = userPermissionsPathByUserId(userId);
  if (!(await exists(p))) {
    const initial = { permissions: {}, updated_at: nowIso() };
    await writeFile(p, JSON.stringify(initial, null, 2), {
      overwrite: true,
      contentType: 'application/json; charset=utf-8',
    });
  }
}

async function readUserPermissionsDoc(userId, { bypassCache = false } = {}) {
  const uid = String(userId);
  if (CACHE_TTL_MS > 0) {
    const cached = cache.get(uid);
    if (!bypassCache && cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }
  await ensureUserPermissionsFile(uid);
  const buf = await readFile(userPermissionsPathByUserId(uid));
  const text = Buffer.from(buf).toString('utf8');
  const doc = safeJsonParse(text);
  const normalized = doc && typeof doc === 'object' ? doc : { permissions: {}, updated_at: nowIso() };
  normalized.permissions = normalized.permissions && typeof normalized.permissions === 'object' ? normalized.permissions : {};
  if (CACHE_TTL_MS > 0) {
    cache.set(uid, { expiresAt: Date.now() + CACHE_TTL_MS, data: normalized });
  } else {
    cache.delete(uid);
  }
  return normalized;
}

async function writeUserPermissionsDoc(userId, doc) {
  const uid = String(userId);
  doc.updated_at = nowIso();
  await writeFile(userPermissionsPathByUserId(uid), JSON.stringify(doc, null, 2), {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
  if (CACHE_TTL_MS > 0) {
    cache.set(uid, { expiresAt: Date.now() + CACHE_TTL_MS, data: doc });
  } else {
    cache.delete(uid);
  }
}

async function mirrorToUserDirIfExists(userId, doc) {
  try {
    const user = await userStore.findById(userId);
    if (!user?.username) return;
    const userRoot = normalizeWebdavPath(`/${user.username}`);
    if (!(await exists(userRoot))) return;

    // Ensure /{username}/.wea exists and then write mirror file
    await ensureDir(userMetaDirByUsername(user.username));
    await writeFile(userPermissionsMirrorPathByUsername(user.username), JSON.stringify(doc.permissions, null, 2), {
      overwrite: true,
      contentType: 'application/json; charset=utf-8',
    });
  } catch {
    // best-effort only
  }
}

async function grant(userId, folderPath, permission) {
  const uid = String(userId);
  const folder = normalizeWebdavPath(folderPath);
  return await withLock(`perm:${uid}`, async () => {
    const doc = await readUserPermissionsDoc(uid, { bypassCache: true });
    doc.permissions[folder] = permission;
    await writeUserPermissionsDoc(uid, doc);
    await mirrorToUserDirIfExists(uid, doc);
    return { id: undefined, userId: Number(uid), folderPath: folderPath, permission };
  });
}

async function revoke(userId, folderPath) {
  const uid = String(userId);
  const folder = normalizeWebdavPath(folderPath);
  return await withLock(`perm:${uid}`, async () => {
    const doc = await readUserPermissionsDoc(uid, { bypassCache: true });
    delete doc.permissions[folder];
    await writeUserPermissionsDoc(uid, doc);
    await mirrorToUserDirIfExists(uid, doc);
    return { success: true };
  });
}

async function revokeAllUserPermissions(userId) {
  const uid = String(userId);
  return await withLock(`perm:${uid}`, async () => {
    const doc = await readUserPermissionsDoc(uid, { bypassCache: true });
    const deletedCount = Object.keys(doc.permissions || {}).length;
    doc.permissions = {};
    await writeUserPermissionsDoc(uid, doc);
    await mirrorToUserDirIfExists(uid, doc);
    return { success: true, deletedCount };
  });
}

async function getUserPermissions(userId) {
  const uid = String(userId);
  const doc = await readUserPermissionsDoc(uid);
  return Object.entries(doc.permissions).map(([folder_path, permission]) => ({ folder_path, permission }));
}

function permissionRank(p) {
  const order = ['read', 'write', 'admin'];
  const idx = order.indexOf(p);
  return idx < 0 ? -1 : idx;
}

async function checkPermission(userId, folderPath, requiredPermission) {
  const uid = String(userId);
  const folder = normalizeWebdavPath(folderPath);
  const doc = await readUserPermissionsDoc(uid);
  const actual = doc.permissions?.[folder];
  if (!actual) return false;
  return permissionRank(actual) >= permissionRank(requiredPermission);
}

async function getFolderPermissions(folderPath) {
  await ensureDirs();
  const folder = normalizeWebdavPath(folderPath);
  const entries = await require('./storage').listDir(PERMISSIONS_USERS_DIR);
  const results = [];

  for (const ent of entries) {
    if (!ent.basename || !ent.basename.endsWith('.json')) continue;
    const userId = ent.basename.replace(/\.json$/, '');
    const doc = await readUserPermissionsDoc(userId);
    const perm = doc.permissions?.[folder];
    if (!perm) continue;
    const user = await userStore.findById(userId);
    if (!user) continue;
    results.push({
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      permission: perm,
    });
  }

  return results;
}

async function hasPermissionsInPath(folderPath) {
  await ensureDirs();
  const normalized = normalizeWebdavPath(folderPath);
  const normalizedNoSlash = normalized !== '/' && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const normalizedWithSlash = normalizedNoSlash === '/' ? '/' : `${normalizedNoSlash}/`;

  const entries = await require('./storage').listDir(PERMISSIONS_USERS_DIR);
  const results = [];

  for (const ent of entries) {
    if (!ent.basename || !ent.basename.endsWith('.json')) continue;
    const userId = ent.basename.replace(/\.json$/, '');
    const doc = await readUserPermissionsDoc(userId);
    const perms = doc.permissions || {};

    for (const [p, permission] of Object.entries(perms)) {
      const permPath = normalizeWebdavPath(p);
      const permNoSlash = permPath !== '/' && permPath.endsWith('/') ? permPath.slice(0, -1) : permPath;

      const match =
        normalizedNoSlash === '/' ||
        permNoSlash === normalizedNoSlash ||
        permPath === normalizedWithSlash ||
        permNoSlash.startsWith(normalizedWithSlash);

      if (!match) continue;

      // Exclude parent paths when searching for child path (except root)
      if (normalizedNoSlash !== '/' && permNoSlash !== normalizedNoSlash && !permNoSlash.startsWith(normalizedWithSlash)) {
        continue;
      }

      const user = await userStore.findById(userId);
      if (!user) continue;

      results.push({
        id: user.id,
        username: user.username,
        email: user.email,
        is_admin: user.is_admin,
        folder_path: permPath,
        permission,
      });
    }
  }

  return results;
}

module.exports = {
  grant,
  revoke,
  revokeAllUserPermissions,
  getUserPermissions,
  checkPermission,
  getFolderPermissions,
  hasPermissionsInPath,
};

