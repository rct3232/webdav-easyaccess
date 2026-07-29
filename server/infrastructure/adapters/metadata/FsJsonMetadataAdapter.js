'use strict';

const { USER_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../../../utils/errorHandler');

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

function pathBasename(p) {
  return String(p).split('/').filter(Boolean).pop() || '';
}

const SHARE_LINKS_DIR = '/.wea/share-links/';

function FsJsonMetadataAdapter() {
  // Lazy requires to ensure Jest mocks on store/storage are picked up
  const storage = require('../../../store/storage');
  const metaPaths = require('../../../store/metaPaths');
  const locks = require('../../../store/locks');

  function getShareLinkPath(token) {
    return metaPaths.normalizeWebdavPath(`${SHARE_LINKS_DIR}${token}.json`);
  }

  async function ensureUserIndexFile() {
    await storage.ensureDir(metaPaths.META_ROOT);
    await storage.ensureDir(metaPaths.USERS_DIR);
    await storage.ensureDir(metaPaths.EMAIL_INDEX_DIR);

    const ok = await storage.exists(metaPaths.USERS_INDEX_PATH);
    if (!ok) {
      const initial = {
        nextId: 1,
        byId: {},
        byUsername: {},
        updated_at: nowIso(),
      };
      await storage.writeFile(metaPaths.USERS_INDEX_PATH, JSON.stringify(initial, null, 2), {
        overwrite: true,
        contentType: 'application/json; charset=utf-8',
      });
    }
  }

  async function readUserIndex() {
    await ensureUserIndexFile();
    const buf = await storage.readFile(metaPaths.USERS_INDEX_PATH);
    const text = Buffer.from(buf).toString('utf8');
    const parsed = safeJsonParse(text);
    if (parsed && typeof parsed === 'object' && typeof parsed.nextId === 'number') {
      parsed.byId = parsed.byId || {};
      parsed.byUsername = parsed.byUsername || {};
      return parsed;
    }
    const initial = {
      nextId: 1,
      byId: {},
      byUsername: {},
      updated_at: nowIso(),
    };
    await storage.writeFile(metaPaths.USERS_INDEX_PATH, JSON.stringify(initial, null, 2), {
      overwrite: true,
      contentType: 'application/json; charset=utf-8',
    });
    return initial;
  }

  async function writeUserIndex(index) {
    index.updated_at = nowIso();
    await storage.writeFile(metaPaths.USERS_INDEX_PATH, JSON.stringify(index, null, 2), {
      overwrite: true,
      contentType: 'application/json; charset=utf-8',
    });
  }

  async function readUserByUsername(username) {
    const p = metaPaths.userPathByUsername(username);
    const ok = await storage.exists(p);
    if (!ok) return undefined;
    const buf = await storage.readFile(p);
    const text = Buffer.from(buf).toString('utf8');
    const u = safeJsonParse(text);
    if (!u || typeof u !== 'object') return undefined;
    if (typeof u.username === 'string' && u.username !== username) {
      return undefined;
    }
    return u;
  }

  async function writeUserByUsername(username, userObj) {
    userObj.updated_at = nowIso();
    await storage.writeFile(metaPaths.userPathByUsername(username), JSON.stringify(userObj, null, 2), {
      overwrite: true,
      contentType: 'application/json; charset=utf-8',
    });
  }

  return {
    ensureUserIndexFile,

    async findByUsername(username) {
      return await readUserByUsername(username);
    },

    async findByEmail(email) {
      const emailNorm = normalizeEmail(email);
      if (!emailNorm) return undefined;
      const emailHash = metaPaths.sha256HexLower(emailNorm);
      const idxPath = metaPaths.emailIndexPathByEmailHash(emailHash);
      if (!(await storage.exists(idxPath))) return undefined;
      const buf = await storage.readFile(idxPath);
      const username = Buffer.from(buf).toString('utf8').trim();
      if (!username) return undefined;
      return await readUserByUsername(username);
    },

    async findById(id) {
      const index = await readUserIndex();
      const username = index.byId?.[String(id)];
      if (!username) return undefined;
      return await readUserByUsername(username);
    },

    async createUser({ username, email, passwordHash, isAdmin = false }) {
      if (!username || !email || !passwordHash) {
        throw createError(SERVER_ERROR_CODES.admin.createUserRequiredFields, 400);
      }

      return await locks.withLock('users', async () => {
        const index = await readUserIndex();

        if (await storage.exists(metaPaths.userPathByUsername(username))) {
          throw createError(SERVER_ERROR_CODES.admin.usernameTaken, 409);
        }

        const emailNorm = normalizeEmail(email);
        const emailHash = metaPaths.sha256HexLower(emailNorm);
        const emailIdxPath = metaPaths.emailIndexPathByEmailHash(emailHash);
        if (await storage.exists(emailIdxPath)) {
          throw createError(SERVER_ERROR_CODES.auth.emailTaken, 409);
        }

        const id = index.nextId;
        index.nextId = id + 1;
        index.byId[String(id)] = username;
        index.byUsername[String(username)] = id;
        await writeUserIndex(index);

        await storage.writeFile(emailIdxPath, `${username}\n`, {
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
          token_version: 0,
          created_at: createdAt,
          updated_at: createdAt,
        };

        await storage.writeFile(metaPaths.userPathByUsername(username), JSON.stringify(userObj, null, 2), {
          overwrite: false,
          ifNoneMatchStar: true,
          contentType: 'application/json; charset=utf-8',
        });

        return userObj;
      });
    },

    async updateStatus(userId, status) {
      return await locks.withLock('users', async () => {
        const user = await this.findById(userId);
        if (!user) {
          return { success: true };
        }
        user.status = status;
        await writeUserByUsername(user.username, user);
        return { success: true };
      });
    },

    async updateEmail(userId, newEmail) {
      const newNorm = normalizeEmail(newEmail);
      if (!newNorm) throw createError(SERVER_ERROR_CODES.users.emailRequired, 400);

      return await locks.withLock('users', async () => {
        const user = await this.findById(userId);
        if (!user) {
          throw createError(SERVER_ERROR_CODES.admin.userNotFound, 404);
        }

        const newHash = metaPaths.sha256HexLower(newNorm);
        const newIdxPath = metaPaths.emailIndexPathByEmailHash(newHash);
        if (await storage.exists(newIdxPath)) {
          const buf = await storage.readFile(newIdxPath);
          const existingUsername = Buffer.from(buf).toString('utf8').trim();
          if (existingUsername && existingUsername !== user.username) {
            throw createError(SERVER_ERROR_CODES.auth.emailTaken, 409);
          }
        } else {
          await storage.writeFile(newIdxPath, `${user.username}\n`, {
            overwrite: false,
            ifNoneMatchStar: true,
            contentType: 'text/plain; charset=utf-8',
          });
        }

        if (user.email_hash) {
          await storage.deletePath(metaPaths.emailIndexPathByEmailHash(user.email_hash));
        }

        user.email = newNorm;
        user.email_hash = newHash;
        await writeUserByUsername(user.username, user);
        return { success: true };
      });
    },

    async updatePassword(userId, passwordHash) {
      return await locks.withLock('users', async () => {
        const user = await this.findById(userId);
        if (!user) return { success: true };
        user.password = passwordHash;
        const current = Number.isInteger(user.token_version) ? user.token_version : 0;
        user.token_version = current + 1;
        await writeUserByUsername(user.username, user);
        return { success: true };
      });
    },

    async deleteUser(userId) {
      return await locks.withLock('users', async () => {
        const index = await readUserIndex();
        const username = index.byId?.[String(userId)];
        if (!username) return { success: true };

        const user = await readUserByUsername(username);
        if (user?.email_hash) {
          await storage.deletePath(metaPaths.emailIndexPathByEmailHash(user.email_hash));
        }

        await storage.deletePath(metaPaths.userPathByUsername(username));

        delete index.byId[String(userId)];
        delete index.byUsername[String(username)];
        await writeUserIndex(index);

        return { success: true };
      });
    },

    async findAll() {
      await storage.ensureDir(metaPaths.USERS_DIR);
      const items = await storage.listDir(metaPaths.USERS_DIR);
      const files = items
        .filter((it) => it.type !== 'directory')
        .map((it) => it.basename)
        .filter((name) => name && name.endsWith('.json') && name !== pathBasename(metaPaths.USERS_INDEX_PATH));

      const users = [];
      for (const fname of files) {
        const username = fname.replace(/\.json$/, '');
        const u = await readUserByUsername(username);
        if (u) users.push(u);
      }

      users.sort((a, b) => {
        const ta = Date.parse(a.created_at || a.updated_at || 0);
        const tb = Date.parse(b.created_at || b.updated_at || 0);
        return tb - ta;
      });
      return users;
    },

    async findByStatus(status) {
      const all = await this.findAll();
      return all.filter((u) => u.status === status);
    },

    async createShareLink(linkData) {
      const { token, filePath, createdBy, expiresInDays } = linkData;
      await storage.ensureDir(SHARE_LINKS_DIR);
      const createdAt = new Date().toISOString();
      let expiresAt = null;
      if (expiresInDays !== null && expiresInDays !== undefined) {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + expiresInDays);
        expiresAt = expiryDate.toISOString();
      }
      const link = {
        token,
        filePath: metaPaths.normalizeWebdavPath(filePath),
        createdBy,
        createdAt,
        expiresAt,
        downloadCount: 0,
      };
      const linkPath = getShareLinkPath(token);
      const linkExists = await storage.exists(linkPath);
      if (linkExists) {
        const existing = await this.getShareLink(token);
        if (existing) return existing;
      }
      await storage.writeFile(linkPath, JSON.stringify(link, null, 2), { overwrite: true });
      return link;
    },

    async getShareLink(token) {
      try {
        const linkPath = getShareLinkPath(token);
        const content = await storage.readFile(linkPath);
        return JSON.parse(content);
      } catch (error) {
        if (error.code === 'ENOENT' || (error.message && error.message.includes('not found'))) {
          return null;
        }
        throw error;
      }
    },

    async getUserShareLinks(userId) {
      try {
        await storage.ensureDir(SHARE_LINKS_DIR);
        const linksDir = metaPaths.normalizeWebdavPath(SHARE_LINKS_DIR);
        const files = await storage.listDir(linksDir);
        const links = [];
        for (const file of files) {
          if (file.type === 'file' && file.basename.endsWith('.json')) {
            try {
              const linkPath = metaPaths.normalizeWebdavPath(`${SHARE_LINKS_DIR}${file.basename}`);
              const content = await storage.readFile(linkPath);
              const link = JSON.parse(content);
              if (link.createdBy === userId) {
                links.push(link);
              }
            } catch (error) {
              console.error(`Failed to read share link file ${file.basename}:`, error);
            }
          }
        }
        links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return links;
      } catch (error) {
        console.error('Failed to get user share links:', error);
        return [];
      }
    },

    async updateShareLink(token, updates) {
      const link = await this.getShareLink(token);
      if (!link) {
        throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
      }
      const updatedLink = { ...link, ...updates };
      const linkPath = getShareLinkPath(token);
      await storage.writeFile(linkPath, JSON.stringify(updatedLink, null, 2));
      return updatedLink;
    },

    async deleteShareLink(token) {
      const linkPath = getShareLinkPath(token);
      await storage.deletePath(linkPath);
    },

    async incrementDownloadCount(token) {
      const link = await this.getShareLink(token);
      if (!link) {
        throw createError(SERVER_ERROR_CODES.share.shareLinkNotFound, 404);
      }
      return await this.updateShareLink(token, {
        downloadCount: (link.downloadCount || 0) + 1,
      });
    },
  };
}

module.exports = FsJsonMetadataAdapter;
