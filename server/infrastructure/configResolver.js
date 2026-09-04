'use strict';

const { TIER, CONFIG_ENTRIES, getEntry } = require('./configRegistry');

const SECRET_MASK = '****';

function isSet(value) {
  return value !== undefined && value !== '';
}

/**
 * Resolve a settings row value for an entry. Settings rows store plaintext
 * string values; the stored value is returned as-is (no decryption — there is
 * no encryption at rest). Secrets are masked presentation-side by the callers
 * using the registry `secret` flag.
 */
function resolveDbValue(raw) {
  if (raw === null || raw === undefined) return undefined;
  return raw;
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

  // T1 keys whose values were copied into `env` at boot from the DB
  // (populateT1Env). The env copy is a boot-time mirror for require-time consts,
  // NOT an operator-set value: without this the resolver would report
  // source='env' and the admin config UI would lock every DB-backed T1 key.
  const dbSourcedKeys = new Set();

  function isDbSourced(key) {
    return dbSourcedKeys.has(key);
  }

  function markDbSourced(keys) {
    for (const key of keys) dbSourcedKeys.add(key);
  }

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

    const envValue = isDbSourced(key) ? undefined : env[key];
    if (isSet(envValue)) return envValue;
    if (entry.tier === TIER.T0) return undefined;

    const raw = await readRow(key);
    const resolved = resolveDbValue(raw);
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
      const envValue = isDbSourced(key) ? undefined : env[key];
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
        const resolved = resolveDbValue(raw);
        if (resolved !== undefined) {
          value = resolved;
          source = 'db';
        } else {
          value = entry.default;
          source = 'default';
        }
      }

      out[key] = {
        // Mask only secrets that actually have a value. An unset/empty secret
        // resolves to `undefined` (or stays empty) — never the literal mask —
        // so presence-based derivations (setupStatus metadata/file-backend
        // checks) cannot mistake a fabricated '****' for a configured secret
        // (configResolver spec §2.6; e.g. an unset WEA_DB_PASSWORD must not
        // select the PostgreSQL metadata backend).
        value: secret && isSet(value) ? SECRET_MASK : value,
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

  /**
   * Synchronous read for require-time consumers (boot-frozen or per-request
   * sync paths): env → cached DB row → default. DB values are visible only
   * after loadAll() primes the cache or an async read populated it.
   */
  function getConfigSync(key) {
    const entry = getEntry(key);
    if (!entry) return undefined;
    const envValue = isDbSourced(key) ? undefined : env[key];
    if (isSet(envValue)) return envValue;
    if (entry.tier === TIER.T0) return undefined;
    const hit = cache.get(key);
    const resolved =
      hit && hit.value !== undefined ? resolveDbValue(hit.value) : undefined;
    if (resolved !== undefined) return resolved;
    return entry.default;
  }

  async function loadAll() {
    const all = await settingsStore.getAll();
    const now = Date.now();
    for (const [key, value] of Object.entries(all)) {
      cache.set(key, { value: value === null ? undefined : value, loadedAt: now });
    }
  }

  return {
    getConfig,
    getConfigSync,
    getEffectiveConfig,
    invalidateCache,
    loadAll,
    markDbSourced,
  };
}

let sharedResolver = null;

/**
 * The single resolver instance used across the process (boot, admin config
 * route, T2 consumers). Lazily created with the app's Settings model store so
 * no DB connection happens at require time. setSharedResolver lets the boot
 * sequence install its own primed instance (after loadAll).
 */
function getSharedResolver() {
  if (!sharedResolver) {
    const Settings = require('../models/Settings');
    sharedResolver = createConfigResolver({ settingsStore: Settings });
  }
  return sharedResolver;
}

function setSharedResolver(resolver) {
  sharedResolver = resolver;
}

/**
 * Copy the effective value of every T1 (boot-frozen) registry key into the
 * given env object (default process.env) so require-time consumers see
 * DB-sourced values. Called at boot only when setup is complete, after
 * loadAll() primed the cache. T0 keys are
 * never copied (env-only by contract) and T2 keys are excluded so they stay
 * lazy (per-request resolver reads). Keys already present in the env win and
 * are never overwritten (D1). Returns the list of keys written.
 *
 * @param {object} resolver resolver exposing getConfigSync(key)
 * @param {Record<string,string|undefined>} [env]
 * @returns {string[]}
 */
function populateT1Env(resolver, env = process.env) {
  const populated = [];
  for (const entry of CONFIG_ENTRIES) {
    if (entry.tier !== TIER.T1) continue;
    if (entry.key in env) continue;
    const value = resolver.getConfigSync(entry.key);
    if (value !== undefined) {
      env[entry.key] = String(value);
      populated.push(entry.key);
    }
  }
  // These env values are boot mirrors of DB rows, not operator-set values —
  // record them so the resolver reports source='db' and the admin UI keeps
  // them editable.
  if (typeof resolver.markDbSourced === 'function') {
    resolver.markDbSourced(populated);
  }
  return populated;
}

module.exports = {
  createConfigResolver,
  getSharedResolver,
  setSharedResolver,
  populateT1Env,
};
