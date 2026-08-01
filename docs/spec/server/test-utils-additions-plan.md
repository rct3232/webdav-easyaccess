# test-utils Additions — Phase 4 nodeId-Based Test Helpers

## 1. Overview

| Item | Description |
|------|-------------|
| Role | New helper functions for `server/test-utils.js` to support Phase 4 nodeId-based testing. Existing path-based helpers remain available for legacy tests; these additions enable direct manipulation of `file_nodes`, `permissions_*`, `object_map`, and `node_ancestors` tables in isolated test databases. |
| Target file | `server/test-utils.js` |

---

## 2. New Helper Functions

### 2.1 `createTestFileNode`

Creates a row in the `file_nodes` table for use as a test fixture (directory or file).

#### Purpose and Usage Context

Used to build filesystem tree fixtures before running nodeId-based permission, ancestry, or CRUD tests. Replaces the need to exercise full route/service layers just to create test nodes. Intended for `beforeEach` / `beforeAll` blocks in unit and integration tests.

#### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `database` | object | yes | — | Storage backend accessor (returned by `createTestDatabase()`). Provides `.getPgPool()` / `.getSqliteConnection()` for direct queries. In practice, the test harness passes the storage module or pool directly; see implementation notes below. |
| `name` | string | yes | — | Node name (e.g. `'myfolder'`, `'report.pdf'`). Must satisfy UNIQUE constraint on `(parent_id, name)`. |
| `type` | string | no | `'file'` | Node type: `'file'` or `'directory'`. Enforced by CHECK constraint on `file_nodes.type`. |
| `parentId` | number \| null | no | `null` | Parent node ID. `null` creates a root-level node. Must reference an existing `file_nodes.id` if non-null (FK constraint). |

#### Return Value

```js
{ id: <number>, parentId: <number|null>, name: <string>, type: <string> }
```

The newly inserted row's ID, ready for use in downstream helpers.

#### Database Operations Performed

- `INSERT INTO file_nodes (parent_id, name, type) VALUES (?, ?, ?)` — PostgreSQL uses `$1, $2, ...` placeholders; SQLite uses `?`. Returns the generated `id` via `RETURNING id` (PG) or `db.lastID` (SQLite).
- No ancestor chain is built by this helper. Call `buildAncestorsForTestNode` separately to populate `node_ancestors`.

#### Example Usage

```js
// In a test file:
const { createTestDatabase, createTestFileNode } = require('../test-utils');

describe('permission check by nodeId', () => {
  let db;
  beforeAll(async () => { db = await createTestDatabase(); });
  afterAll(async () => { await db.cleanup(); });

  it('grants read on a directory node', async () => {
    const dir = await createTestFileNode({ database: db, name: 'shared', type: 'directory' });
    // dir.id is now usable in grantTestPermissionByNodeId(...)
    expect(dir.type).toBe('directory');
  });
});
```

---

### 2.2 `grantTestPermissionByNodeId`

Grants a directory-level permission to a user for a specific node, using the nodeId-based schema (`permissions_user_paths`).

#### Purpose and Usage Context

Replaces path-based grants in new tests. Writes directly to `permissions_user_paths(user_id, file_node_id, permission)` matching the v2 normalized schema. Used when testing permission resolution via closure-table ancestor traversal rather than string path comparison.

The existing `grantTestPermission(userId, folderPath, permission)` remains for legacy path-based tests and is not replaced by this helper.

#### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `database` | object | yes | — | Test database connection handle from `createTestDatabase()`. |
| `userId` | number | yes | — | The user's ID (`users.id`). Typically obtained via `createTestUser()` or a test fixture. |
| `fileNodeId` | number | yes | — | The target node ID (`file_nodes.id`) where the permission is granted. Must be a directory node for path-level grants. |
| `permission` | string | no | `'read'` | Permission level: `'read'`, `'write'`, or `'admin'`. Enforced by CHECK constraint on `permissions_user_paths.permission`. |

#### Return Value

```js
{ userId: <number>, fileNodeId: <number>, permission: <string> }
```

Echoes the grant parameters for assertion convenience. Does not return full DB row (timestamps are implementation detail).

#### Database Operations Performed

- `INSERT INTO permissions_user_paths (user_id, file_node_id, permission) VALUES (?, ?, ?)` — or `ON CONFLICT (user_id, file_node_id) DO UPDATE SET permission = EXCLUDED.permission` to handle upsert semantics matching production behavior.
- Uses parameterized queries for both PostgreSQL and SQLite backends.

#### Example Usage

```js
const { createTestFileNode, grantTestPermissionByNodeId } = require('../test-utils');

it('user has read on granted directory', async () => {
  const user = await createTestUser();
  const dir = await createTestFileNode({ database: db, name: 'docs', type: 'directory' });

  await grantTestPermissionByNodeId({
    database: db,
    userId: user.id,
    fileNodeId: dir.id,
    permission: 'read',
  });

  // Now permissionStore.checkPermission(user.id, dir.id, 'read') → true
});
```

---

### 2.3 `createTestObjectMapEntry`

Inserts an entry into the `object_map` table linking a file node to a blob storage key.

#### Purpose and Usage Context

Used in S3-mode tests where a file node must have an associated object mapping. Creates a single-row entry with the specified status (`'pending'`, `'active'`, or `'orphaned'`) for testing upload lifecycle, download resolution, and orphan cleanup scenarios.

#### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `database` | object | yes | — | Test database connection handle from `createTestDatabase()`. |
| `fileNodeId` | number | yes | — | The file node ID to map. Must reference an existing `file_nodes.id` (FK constraint). |
| `s3Key` | string | yes | — | S3 object key path (e.g. `'uploads/abc123/myfile.pdf'`). Stored in `object_map.s3_key`. |
| `status` | string | no | `'active'` | Object status: `'pending'`, `'active'`, or `'orphaned'`. Enforced by CHECK constraint on `object_map.status`. |

#### Return Value

```js
{ fileNodeId: <number>, s3Key: <string>, status: <string> }
```

Echoes the insert parameters for assertion convenience.

#### Database Operations Performed

- Single `INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status) VALUES (?, ?, 's3', 1, ?)` — no orphaning of previous active row; this is a test helper that inserts directly without the production upsert logic.
- If an active entry for `fileNodeId` already exists, caller is responsible for cleanup (test fixtures should be idempotent or cleaned between tests).

#### Example Usage

```js
const { createTestFileNode, createTestObjectMapEntry } = require('../test-utils');

it('resolves S3 key for active file', async () => {
  const file = await createTestFileNode({ database: db, name: 'photo.jpg', type: 'file' });
  await createTestObjectMapEntry({
    database: db,
    fileNodeId: file.id,
    s3Key: `uploads/${crypto.randomUUID()}/photo.jpg`,
    status: 'active',
  });

  // object_map row is now queryable via store.getActiveObject(file.id)
});
```

---

### 2.4 `buildAncestorsForTestNode`

Populates the `node_ancestors` closure table for a given node by walking its parent chain.

#### Purpose and Usage Context

The production `_ancestryHelper.buildAncestorsForNode` relies on `fileNodesStore.getAncestorChain()` to fetch the parent's existing ancestor rows. This test helper performs the same algorithm: if the node has no parent, it inserts only a self-row; otherwise, it retrieves all ancestors of the parent and inserts them with incremented depth plus the self-row.

Required for any nodeId-based permission check that relies on ancestor inheritance (see `permissionStore` spec §2.7). Without correct closure-table data, `checkPermission` queries will return false negatives.

#### Parameters

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `database` | object | yes | — | Test database connection handle from `createTestDatabase()`. |
| `nodeId` | number | yes | — | The node ID to build ancestors for. Must already exist in `file_nodes`. |
| `parentId` | number \| null | yes | — | The parent node's ID. If the parent has its own ancestor chain populated, those rows will be inherited. `null` means root-level (self-row only). |

#### Return Value

```js
{ nodeId: <number>, ancestorCount: <number> }
```

Returns the number of ancestor rows inserted (including self-row), useful for verification in tests.

#### Database Operations Performed

1. If `parentId === null`: single `INSERT INTO node_ancestors (ancestor_id, descendant_id, depth) VALUES (nodeId, nodeId, 0)` — self-reference only.
2. If `parentId !== null`:
   - `SELECT ancestor_id FROM node_ancestors WHERE descendant_id = parentId` — fetch parent's full chain.
   - For each returned ancestor: `INSERT INTO node_ancestors (ancestor_id, descendant_id, depth) VALUES (parentAncestorId, nodeId, parentDepth + 1)`
   - Final self-row: `INSERT INTO node_ancestors VALUES (nodeId, nodeId, 0)`
3. All inserts are executed within a single transaction to maintain closure-table consistency.

#### Example Usage

```js
const { createTestFileNode, buildAncestorsForTestNode } = require('../test-utils');

it('ancestor inheritance resolves permission on child', async () => {
  // Build: root (id=1) → subdir (id=2) → file (id=3)
  const root = await createTestFileNode({ database: db, name: 'root', type: 'directory' });
  await buildAncestorsForTestNode({ database: db, nodeId: root.id, parentId: null });

  const subdir = await createTestFileNode({ database: db, name: 'subdir', type: 'directory', parentId: root.id });
  await buildAncestorsForTestNode({ database: db, nodeId: subdir.id, parentId: root.id });

  // Grant read on root → should inherit to subdir and file below.
  const user = await createTestUser();
  await grantTestPermissionByNodeId({
    database: db,
    userId: user.id,
    fileNodeId: root.id,
    permission: 'read',
  });

  // Permission check on subdir should resolve via ancestor traversal of root.
});
```

---

## 3. Schema References

All helpers operate against the normalized schema defined in:

- `server/store/postgresql/ddl/001_initial_normalized_schema.sql` (canonical DDL)

Key tables touched by these helpers:

| Table | Columns used by helpers | Constraints |
|-------|-------------------------|-------------|
| `file_nodes` | `id`, `parent_id`, `name`, `type` | UNIQUE(parent_id, name), CHECK(type IN ('file', 'directory')), FK parent_id → file_nodes(id) ON DELETE CASCADE |
| `permissions_user_paths` | `user_id`, `file_node_id`, `permission` | UNIQUE(user_id, file_node_id), CHECK(permission IN ('read', 'write', 'admin')), FK user_id → users(id), FK file_node_id → file_nodes(id) |
| `object_map` | `file_node_id`, `s3_key`, `storage_backend`, `version_number`, `status` | UNIQUE(file_node_id, version_number), CHECK(status IN ('pending', 'active', 'orphaned')), FK file_node_id → file_nodes(id) |
| `node_ancestors` | `ancestor_id`, `descendant_id`, `depth` | PRIMARY KEY(ancestor_id, descendant_id), CHECK(depth >= 0), FK ancestor_id/descendant_id → file_nodes(id) |

---

## 4. Backend Compatibility

Each helper must produce correct SQL for both PostgreSQL and SQLite backends:

| Concern | PostgreSQL | SQLite |
|---------|-----------|--------|
| Parameter placeholders | `$1, $2, ...` | `?` |
| ID retrieval after INSERT | `RETURNING id` clause | `db.lastID` post-insert |
| NOW() in DEFAULT | `NOW()` | `datetime('now')` (handled by schema conversion layer) |
| Transaction wrapper | `storage.withTransaction()` | `storage.withSqliteTransaction()` |

The helpers should delegate backend-aware query construction to the existing store layer or storage module rather than duplicating SQL dialect logic. Where possible, route inserts through the existing store methods (`fileNodesStore.createNode`, etc.) instead of raw queries — this ensures both backends are covered automatically and test fixtures match production behavior.

---

## 5. Relationship to Existing Helpers

| Existing helper | New helper | Relationship |
|-----------------|------------|-------------|
| `createTestDatabase()` | All four new helpers | Consumed by all; provides isolated DB connection |
| `createTestUser()` | `grantTestPermissionByNodeId` | User creation precedes permission grant |
| `grantTestPermission(userId, folderPath, permission)` | `grantTestPermissionByNodeId` | Complementary: path-based vs nodeId-based. Both coexist during transition. |
| N/A (no existing file-node helper) | `createTestFileNode`, `buildAncestorsForTestNode`, `createTestObjectMapEntry` | New capability for Phase 4 testing |

---

## 6. Verification Scenarios

Each helper must satisfy the following test scenarios before being merged:

### `createTestFileNode`
- [ ] Creates root-level directory node (parentId=null), returns valid id
- [ ] Creates child file under existing parent, respects UNIQUE(parent_id, name) constraint
- [ ] Rejects invalid type value via CHECK constraint violation
- [ ] Works on both PostgreSQL and SQLite backends

### `grantTestPermissionByNodeId`
- [ ] Inserts row into permissions_user_paths; subsequent checkPermission returns true
- [ ] Upserts permission on duplicate (user_id, file_node_id) without throwing unique violation
- [ ] Respects CHECK constraint — rejects invalid permission string
- [ ] FK to users(id) and file_nodes(id) enforced

### `createTestObjectMapEntry`
- [ ] Inserts active entry; store.getActiveObject(fileNodeId) returns the row
- [ ] Supports 'pending' status for upload-in-progress test scenarios
- [ ] Respects UNIQUE(file_node_id, version_number) constraint on duplicate insert at same version

### `buildAncestorsForTestNode`
- [ ] Root node (parentId=null): inserts exactly 1 self-row with depth=0
- [ ] Depth-1 child: inserts parent row (depth=1) + self-row (depth=0) = 2 rows total
- [ ] Depth-N chain: ancestor count equals N+1 including self
- [ ] Ancestor IDs match the path from root to node via file_nodes.parent_id traversal
