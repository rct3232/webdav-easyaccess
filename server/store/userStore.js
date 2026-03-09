const { USER_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError, mapDatabaseError } = require('../utils/errorHandler');
const {
  META_ROOT,
  USERS_DIR,
  USERS_INDEX_PATH,
  userPathByUsername,
  EMAIL_INDEX_DIR,
  emailIndexPathByEmailHash,
  sha256HexLower,
} = require('./metaPaths');
const { ensureDir, exists, readFile, writeFile, deletePath, getBackend, withTransaction, getPgPool } = require('./storage');
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

function isPostgresqlBackend() {
  return getBackend() === 'postgresql';
}

function toIsoString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return String(value);
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
    token_version: Number.isInteger(row.token_version) ? row.token_version : Number(row.token_version || 0),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

async function ensureUserIndexFile() {
  if (isPostgresqlBackend()) return;
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
  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT *
           FROM users
          WHERE username = $1
          LIMIT 1`,
        [String(username)]
      );
      return mapUserRow(res.rows[0]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
  return await readUserByUsername(username);
}

async function findByEmail(email) {
  if (isPostgresqlBackend()) {
    const emailNorm = normalizeEmail(email);
    if (!emailNorm) return undefined;
    const emailHash = sha256HexLower(emailNorm);
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT *
           FROM users
          WHERE email_hash = $1
          LIMIT 1`,
        [emailHash]
      );
      return mapUserRow(res.rows[0]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
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
  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT *
           FROM users
          WHERE id = $1
          LIMIT 1`,
        [Number(id)]
      );
      return mapUserRow(res.rows[0]);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
  const index = await readUserIndex();
  const username = index.byId?.[String(id)];
  if (!username) return undefined;
  return await readUserByUsername(username);
}

async function createUser({ username, email, passwordHash, isAdmin = false }) {
  if (!username || !email || !passwordHash) {
    throw createError(SERVER_ERROR_CODES.admin.createUserRequiredFields, 400);
  }

  if (isPostgresqlBackend()) {
    const emailNorm = normalizeEmail(email);
    const emailHash = sha256HexLower(emailNorm);
    const createdAt = nowIso();
    try {
      return await withTransaction(async (client) => {
        const dupUsername = await client.query(
          `SELECT 1 FROM users WHERE username = $1 LIMIT 1`,
          [String(username)]
        );
        if (dupUsername.rows.length > 0) {
          throw createError(SERVER_ERROR_CODES.admin.usernameTaken, 409);
        }

        const dupEmail = await client.query(
          `SELECT 1 FROM users WHERE email_hash = $1 LIMIT 1`,
          [emailHash]
        );
        if (dupEmail.rows.length > 0) {
          throw createError(SERVER_ERROR_CODES.auth.emailTaken, 409);
        }

        const inserted = await client.query(
          `INSERT INTO users (
              username,
              email,
              email_hash,
              password,
              status,
              is_admin,
              token_version,
              created_at,
              updated_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
            RETURNING *`,
          [
            String(username),
            emailNorm,
            emailHash,
            String(passwordHash),
            isAdmin ? USER_STATUS.APPROVED : USER_STATUS.PENDING,
            Boolean(isAdmin),
            0,
            createdAt,
          ]
        );
        return mapUserRow(inserted.rows[0]);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  return await withLock('users', async () => {
    const index = await readUserIndex();

    // Username uniqueness
    if (await exists(userPathByUsername(username))) {
      throw createError(SERVER_ERROR_CODES.admin.usernameTaken, 409);
    }

    // Email uniqueness (via hash index)
    const emailNorm = normalizeEmail(email);
    const emailHash = sha256HexLower(emailNorm);
    const emailIdxPath = emailIndexPathByEmailHash(emailHash);
    if (await exists(emailIdxPath)) {
      throw createError(SERVER_ERROR_CODES.auth.emailTaken, 409);
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
  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE users
              SET status = $2,
                  updated_at = NOW()
            WHERE id = $1`,
          [Number(userId), status]
        );
      });
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

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
  if (!newNorm) throw createError(SERVER_ERROR_CODES.users.emailRequired, 400);

  if (isPostgresqlBackend()) {
    const userIdNum = Number(userId);
    const newHash = sha256HexLower(newNorm);
    try {
      return await withTransaction(async (client) => {
        const currentUserRes = await client.query(
          `SELECT *
             FROM users
            WHERE id = $1
            LIMIT 1`,
          [userIdNum]
        );
        if (currentUserRes.rows.length === 0) {
          throw createError(SERVER_ERROR_CODES.admin.userNotFound, 404);
        }

        const dupEmailRes = await client.query(
          `SELECT id
             FROM users
            WHERE email_hash = $1
            LIMIT 1`,
          [newHash]
        );
        if (dupEmailRes.rows.length > 0 && Number(dupEmailRes.rows[0].id) !== userIdNum) {
          throw createError(SERVER_ERROR_CODES.auth.emailTaken, 409);
        }

        await client.query(
          `UPDATE users
              SET email = $2,
                  email_hash = $3,
                  updated_at = NOW()
            WHERE id = $1`,
          [userIdNum, newNorm, newHash]
        );
        return { success: true };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  return await withLock('users', async () => {
    const user = await findById(userId);
    if (!user) {
      throw createError(SERVER_ERROR_CODES.admin.userNotFound, 404);
    }

    const newHash = sha256HexLower(newNorm);
    const newIdxPath = emailIndexPathByEmailHash(newHash);
    if (await exists(newIdxPath)) {
      const buf = await readFile(newIdxPath);
      const existingUsername = Buffer.from(buf).toString('utf8').trim();
      if (existingUsername && existingUsername !== user.username) {
        throw createError(SERVER_ERROR_CODES.auth.emailTaken, 409);
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
  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE users
              SET password = $2,
                  token_version = token_version + 1,
                  updated_at = NOW()
            WHERE id = $1`,
          [Number(userId), String(passwordHash)]
        );
      });
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

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
  if (isPostgresqlBackend()) {
    try {
      await withTransaction(async (client) => {
        await client.query(`DELETE FROM users WHERE id = $1`, [Number(userId)]);
      });
      return { success: true };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

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
  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT *
           FROM users
          ORDER BY created_at DESC`
      );
      return res.rows.map(mapUserRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

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
  if (isPostgresqlBackend()) {
    try {
      const pool = getPgPool();
      const res = await pool.query(
        `SELECT *
           FROM users
          WHERE status = $1
          ORDER BY created_at DESC`,
        [status]
      );
      return res.rows.map(mapUserRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

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

