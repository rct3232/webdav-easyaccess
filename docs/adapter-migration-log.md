# CacheAdapter Migration Log

Tracks all raw `Map` instances that should be migrated to the `CacheAdapter` interface defined in Phase 2.

## Interface

```javascript
// CacheAdapter (server/infrastructure/adapters/cache/)
get(key) => any|null
set(key, value, ttl_ms?) => void
delete(key) => boolean
has(key) => boolean
clear() => void
keys() => Iterator<string>
entries() => Iterator<[string, any]>
```

## Migration Status

| # | Map Instance | File | Line | Purpose | Phase | Status |
|---|-------------|------|------|---------|-------|--------|
| 1 | `thumbnailCache` | `utils/thumbnail.js` | 17 | Thumbnail buffer cache (FIFO, max 1000) | Phase 2 | **DONE** — Migrated via `domains/thumbnails/cache.js` + `thumbnailService.js` |
| 2 | `refreshTokensStore` | `utils/auth.js` | 14 | In-memory refresh tokens (`tokenId -> {userId, expiresAt}`) | Phase 3 | Pending |
| 3 | `loginAttempts` | `routes/auth.js` | 26 | Login rate limiter (`IP -> [{timestamp}]`) | Phase 3 | Pending |
| 4 | `clientCache` | `utils/webdav.js` | 10 | WebDAV HTTP client instances (never flushed) | Phase 7 | Pending |
| 5 | `userCache` | `middleware/permissions.js` | 11 | User lookup cache (TTL 3s, unbounded growth risk) | Phase 7 | Pending |
| 6 | `cache` | `store/permissionStore.js` | 35 | Permission TTL cache (TTL 5s) | Phase 7 | Pending |
| 7 | `shareCache` | `store/permissionStore.js` | 36 | Share permission TTL cache (TTL 5s) | Phase 7 | Pending |
| 8 | `existenceIndex` | `store/permissionExistenceIndex.js` | 5 | Path existence cache (TTL 30s, manual invalidation) | Phase 7 | Pending |
| 9 | `jobs` | `store/bulkJobStore.js` | 3 | Bulk operation job tracking (TTL 1hr) | Phase 7 | Pending |

## In-Route Maps (Phase 6 targets)

| # | Map Instance | File | Line | Purpose | Phase | Status |
|---|-------------|------|------|---------|-------|--------|
| 10 | `downloadProgress` | `routes/files.js` | 63 | Download progress per job | Phase 6 | Pending |
| 11 | `operationProgress` | `routes/files.js` | 64 | Bulk operation progress | Phase 6 | Pending |
| 12 | `previewTickets` | `routes/files.js` | 68 | Video preview tickets (TTL 120s) | Phase 6 | Pending |

## Notes

- Phase 2 introduced `InMemoryCacheAdapter` at `server/infrastructure/adapters/cache/InMemoryCacheAdapter.js`
- Factory: `createCacheAdapter()` at `server/infrastructure/adapters/cache/index.js`
- Redis adapter will be added as Future Work; interface swap via factory only
- Each migration should update the Status column above and verify via existing tests
