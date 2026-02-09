const { USER_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  META_ROOT,
  USERS_DIR,
  USERS_INDEX_PATH,
  userPathByUsername,
  EMAIL_INDEX_DIR,
  emailIndexPathByEmailHash,
  sha256HexLower,
} = require('./metaPaths');
const { ensureDir, exists, readFile, writeFile, deletePath } = require('./storage');
const { withLock } = require('./locks');

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

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function ensureUserIndexFile() {
  await ensureDir(META_ROOT);
  await ensureDir(USERS_DIR);
  await ensureDir(EMAIL_INDEX_DIR);

  const ok = await exists(USERS_INDEX_PATH);
  if (!ok) {
    const initial = {
      nextId: 1,
      byId: {},
      byUsername: {},
      updated_at: nowIso(),
    };
    await writeFile(USERS_INDEX_PATH, JSON.stringify(initial, null, 2), {
      overwrite: true,
      contentType: 'application/json; charset=utf-8',
    });
  }
}

async function readUserIndex() {
  await ensureUserIndexFile();
  const buf = await readFile(USERS_INDEX_PATH);
  const text = Buffer.from(buf).toString('utf8');
  const parsed = safeJsonParse(text);
  if (parsed && typeof parsed === 'object' && typeof parsed.nextId === 'number') {
    parsed.byId = parsed.byId || {};
    parsed.byUsername = parsed.byUsername || {};
    return parsed;
  }
  // Reset if corrupted
  const initial = {
    nextId: 1,
    byId: {},
    byUsername: {},
    updated_at: nowIso(),
  };
  await writeFile(USERS_INDEX_PATH, JSON.stringify(initial, null, 2), {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
  return initial;
}

async function writeUserIndex(index) {
  index.updated_at = nowIso();
  await writeFile(USERS_INDEX_PATH, JSON.stringify(index, null, 2), {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
}

async function readUserByUsername(username) {
  const p = userPathByUsername(username);
  const ok = await exists(p);
  if (!ok) return undefined;
  const buf = await readFile(p);
  const text = Buffer.from(buf).toString('utf8');
  const u = safeJsonParse(text);
  if (!u || typeof u !== 'object') return undefined;
  // Enforce case-sensitive lookup even on case-insensitive filesystems/WebDAV servers
  if (typeof u.username === 'string' && u.username !== username) {
    return undefined;
  }
  return u;
}

async function writeUserByUsername(username, userObj) {
  userObj.updated_at = nowIso();
  await writeFile(userPathByUsername(username), JSON.stringify(userObj, null, 2), {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
}

async function findByUsername(username) {
  return await readUserByUsername(username);
}

async function findByEmail(email) {
  const emailNorm = normalizeEmail(email);
  if (!emailNorm) return undefined;
  const emailHash = sha256HexLower(emailNorm);
  const idxPath = emailIndexPathByEmailHash(emailHash);
  if (!(await exists(idxPath))) return undefined;
  const buf = await readFile(idxPath);
  const username = Buffer.from(buf).toString('utf8').trim();
  if (!username) return undefined;
  return await readUserByUsername(username);
}

async function findById(id) {
  const index = await readUserIndex();
  const username = index.byId?.[String(id)];
  if (!username) return undefined;
  return await readUserByUsername(username);
}

async function createUser({ username, email, passwordHash, isAdmin = false }) {
  if (!username || !email || !passwordHash) {
    throw new Error('username, email, passwordHash are required');
  }

  return await withLock('users', async () => {
    const index = await readUserIndex();

    // Username uniqueness
    if (await exists(userPathByUsername(username))) {
      const e = new Error('Username already exists');
      e.code = 'USER_EXISTS';
      throw e;
    }

    // Email uniqueness (via hash index)
    const emailNorm = normalizeEmail(email);
    const emailHash = sha256HexLower(emailNorm);
    const emailIdxPath = emailIndexPathByEmailHash(emailHash);
    if (await exists(emailIdxPath)) {
      const e = new Error('Email already exists');
      e.code = 'EMAIL_EXISTS';
      throw e;
    }

    const id = index.nextId;
    index.nextId = id + 1;
    index.byId[String(id)] = username;
    index.byUsername[String(username)] = id;
    await writeUserIndex(index);

    // Create email index (conditional create)
    await writeFile(emailIdxPath, `${username}\n`, {
      overwrite: false,
      ifNoneMatchStar: true,
      contentType: 'text/plain; charset=utf-8',
    });

    const createdAt = nowIso();
    const userObj = {
      id,
      username,
      email: emailNorm,
      email_hash: emailHash,
      password: passwordHash,
      status: isAdmin ? USER_STATUS.APPROVED : USER_STATUS.PENDING,
      is_admin: isAdmin ? 1 : 0,
      // Used for server-side token invalidation (logout-all / password change, etc.)
      token_version: 0,
      created_at: createdAt,
      updated_at: createdAt,
    };

    await writeFile(userPathByUsername(username), JSON.stringify(userObj, null, 2), {
      overwrite: false,
      ifNoneMatchStar: true,
      contentType: 'application/json; charset=utf-8',
    });

    return userObj;
  });
}

async function updateStatus(userId, status) {
  return await withLock('users', async () => {
    const user = await findById(userId);
    if (!user) {
      return { success: true };
    }
    user.status = status;
    await writeUserByUsername(user.username, user);
    return { success: true };
  });
}

async function updateEmail(userId, newEmail) {
  const newNorm = normalizeEmail(newEmail);
  if (!newNorm) throw new Error('Email is required');

  return await withLock('users', async () => {
    const user = await findById(userId);
    if (!user) {
      const e = new Error('User not found');
      e.code = 'USER_NOT_FOUND';
      throw e;
    }

    const newHash = sha256HexLower(newNorm);
    const newIdxPath = emailIndexPathByEmailHash(newHash);
    if (await exists(newIdxPath)) {
      const buf = await readFile(newIdxPath);
      const existingUsername = Buffer.from(buf).toString('utf8').trim();
      if (existingUsername && existingUsername !== user.username) {
        const e = new Error('Email already exists');
        e.code = 'EMAIL_EXISTS';
        throw e;
      }
    } else {
      await writeFile(newIdxPath, `${user.username}\n`, {
        overwrite: false,
        ifNoneMatchStar: true,
        contentType: 'text/plain; charset=utf-8',
      });
    }

    // Remove old email index
    if (user.email_hash) {
      await deletePath(emailIndexPathByEmailHash(user.email_hash));
    }

    user.email = newNorm;
    user.email_hash = newHash;
    await writeUserByUsername(user.username, user);
    return { success: true };
  });
}

async function updatePassword(userId, passwordHash) {
  return await withLock('users', async () => {
    const user = await findById(userId);
    if (!user) return { success: true };
    user.password = passwordHash;
    const current = Number.isInteger(user.token_version) ? user.token_version : 0;
    user.token_version = current + 1;
    await writeUserByUsername(user.username, user);
    return { success: true };
  });
}

async function deleteUser(userId) {
  return await withLock('users', async () => {
    const index = await readUserIndex();
    const username = index.byId?.[String(userId)];
    if (!username) return { success: true };

    const user = await readUserByUsername(username);
    if (user?.email_hash) {
      await deletePath(emailIndexPathByEmailHash(user.email_hash));
    }

    await deletePath(userPathByUsername(username));

    delete index.byId[String(userId)];
    delete index.byUsername[String(username)];
    await writeUserIndex(index);

    return { success: true };
  });
}

async function findAll() {
  await ensureDir(USERS_DIR);
  const items = await require('./storage').listDir(USERS_DIR);
  const files = items
    .filter((it) => it.type !== 'directory')
    .map((it) => it.basename)
    .filter((name) => name && name.endsWith('.json') && name !== pathBasename(USERS_INDEX_PATH));

  const users = [];
  for (const fname of files) {
    const username = fname.replace(/\.json$/, '');
    const u = await readUserByUsername(username);
    if (u) users.push(u);
  }

  // Sort by created_at desc (best effort)
  users.sort((a, b) => {
    const ta = Date.parse(a.created_at || a.updated_at || 0);
    const tb = Date.parse(b.created_at || b.updated_at || 0);
    return tb - ta;
  });
  return users;
}

function pathBasename(p) {
  return String(p).split('/').filter(Boolean).pop() || '';
}

async function findByStatus(status) {
  const all = await findAll();
  return all.filter((u) => u.status === status);
}

module.exports = {
  ensureUserIndexFile,
  findByUsername,
  findByEmail,
  findById,
  findAll,
  findByStatus,
  createUser,
  updateStatus,
  updateEmail,
  updatePassword,
  deleteUser,
};

