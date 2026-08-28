'use strict';

const { TIER, CONFIG_ENTRIES, getEntry } = require('./configRegistry');
const { decryptSecret, isEncryptedPayload } = require('../utils/configEncryption');

const SECRET_MASK = '****';

function isSet(value) {
  return value !== undefined && value !== '';
}

function tryParseJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Resolve a settings row value for an entry.
 *
 * - plaintext key: the row value (string; boolean passthrough for
 *   registration_enabled) is returned as-is.
 * - secret key: an encrypted payload (object, or a JSON string thereof — the
 *   practical artifact of settingsStore.set with a serialized payload) is
 *   decrypted with env.encrypt_secret_key. A missing master key, or a
 *   decryption failure, yields undefined (never throws). A legacy plaintext
 *   string is returned as-is.
 */
function resolveDbValue(raw, entry, env) {
  if (raw === null || raw === undefined) return undefined;
  if (!entry.secret) return raw;

  const payload = tryParseJson(raw);
  if (isEncryptedPayload(payload)) {
    const masterKey = env.encrypt_secret_key;
    if (!masterKey) return undefined;
    try {
      return decryptSecret(payload, masterKey);
    } catch {
      return undefined;
    }
  }
  return typeof raw === 'string' ? raw : String(raw);
}

/**
 * Effective-config resolver (env → DB settings row → built-in default).
 *
 * Reads go through the injected settingsStore only (get / getAll). A small
 * per-key in-memory TTL cache (default 5s) backstops direct-DB edits;
 * invalidateCache clears it on admin/wizard writes. Single-instance
 * assumption (PLAN Q2).
 *
 * @param {{ get: Function, getAll: Function }} settingsStore
 * @param {Record<string,string|undefined>} [env] environment to resolve against
 * @param {number} [ttlMs] cache TTL in ms
 */
function createConfigResolver({ settingsStore, env = process.env, ttlMs = 5000 }) {
  if (
    !settingsStore ||
    typeof settingsStore.get !== 'function' ||
    typeof settingsStore.getAll !== 'function'
  ) {
    throw new TypeError('settingsStore must expose get(key) and getAll()');
  }

  const cache = new Map();

  function cacheHit(key, now) {
    const hit = cache.get(key);
    return hit && now - hit.loadedAt < ttlMs ? hit : null;
  }

  async function readRow(key) {
    const now = Date.now();
    const hit = cacheHit(key, now);
    if (hit) return hit.value;
    const value = await settingsStore.get(key);
    cache.set(key, { value: value === null ? undefined : value, loadedAt: now });
    return value === null ? undefined : value;
  }

  async function getConfig(key) {
    const entry = getEntry(key);
    if (!entry) return undefined;

    const envValue = env[key];
    if (isSet(envValue)) return envValue;
    if (entry.tier === TIER.T0) return undefined;

    const raw = await readRow(key);
    const resolved = resolveDbValue(raw, entry, env);
    if (resolved !== undefined) return resolved;
    return entry.default;
  }

  async function getEffectiveConfig() {
    const all = await settingsStore.getAll();
    const now = Date.now();
    for (const [key, value] of Object.entries(all)) {
      cache.set(key, { value: value === null ? undefined : value, loadedAt: now });
    }

    const out = {};
    for (const entry of CONFIG_ENTRIES) {
      const { key, tier, secret } = entry;
      const envValue = env[key];
      let value;
      let source;

      if (isSet(envValue)) {
        value = envValue;
        source = 'env';
      } else if (tier === TIER.T0) {
        value = undefined;
        source = 'env';
      } else {
        const raw = all[key] === null || all[key] === undefined ? undefined : all[key];
        const resolved = resolveDbValue(raw, entry, env);
        if (resolved !== undefined) {
          value = resolved;
          source = 'db';
        } else {
          value = entry.default;
          source = 'default';
        }
      }

      out[key] = {
        value: secret ? SECRET_MASK : value,
        source,
        tier,
        secret: Boolean(secret),
      };
    }
    return out;
  }

  function invalidateCache(keys) {
    if (keys === undefined) {
      cache.clear();
      return;
    }
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) cache.delete(key);
  }

  async function loadAll() {
    const all = await settingsStore.getAll();
    const now = Date.now();
    for (const [key, value] of Object.entries(all)) {
      cache.set(key, { value: value === null ? undefined : value, loadedAt: now });
    }
  }

  return { getConfig, getEffectiveConfig, invalidateCache, loadAll };
}

module.exports = { createConfigResolver };
