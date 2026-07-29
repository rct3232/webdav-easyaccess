/**
 * In-memory CacheAdapter implementation using Map.
 * Supports optional TTL-based expiration (lazy eviction on access).
 *
 * @typedef {Object} CacheAdapter
 * @property {function(string): any|null} get
 * @property {function(string, any, number?): void} set — ttl_ms optional
 * @property {function(string): boolean} delete
 * @property {function(string): boolean} has
 * @property {function(): void} clear
 * @property {function(): Iterator<string>} keys
 * @property {function(): Iterator<[string, any]>} entries
 */
class InMemoryCacheAdapter {
  constructor() {
    this._store = new Map();
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttl_ms) {
    const entry = ttl_ms ? { value, expiresAt: Date.now() + ttl_ms } : { value };
    this._store.set(key, entry);
  }

  delete(key) {
    return this._store.delete(key);
  }

  has(key) {
    const entry = this._store.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return false;
    }
    return true;
  }

  clear() {
    this._store.clear();
  }

  *keys() {
    for (const [key, entry] of this._store) {
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        this._store.delete(key);
        continue;
      }
      yield key;
    }
  }

  *entries() {
    for (const [key, entry] of this._store) {
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        this._store.delete(key);
        continue;
      }
      yield [key, entry.value];
    }
  }

  get size() {
    return this._store.size;
  }
}

module.exports = InMemoryCacheAdapter;
