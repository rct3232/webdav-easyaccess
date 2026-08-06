const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');
const { convertPostgresToSqlite } = require('../sqliteSchemaInit');

function splitStatements(sql) {
  const statements = [];
  let current = '';

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('--')) continue;

    current += trimmed + '\n';

    if (trimmed.endsWith(';')) {
      statements.push(current.trim().slice(0, -1));
      current = '';
    }
  }

  return statements.filter((s) => s.length > 0);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

describe('DDL Smoke Test', () => {
  describe('SQLite path', () => {
    let db;

    beforeAll(async () => {
      const ddlPath = path.join(__dirname, '../../store/postgresql/ddl/001_initial_normalized_schema.sql');
      const rawDdl = fs.readFileSync(ddlPath, 'utf8');
      const convertedDdl = convertPostgresToSqlite(rawDdl);

      db = new sqlite3.Database(':memory:');

      await run(db, 'PRAGMA foreign_keys = ON');
      await run(db, 'PRAGMA defer_foreign_keys = ON');

      const statements = splitStatements(convertedDdl);

      for (const statement of statements) {
        await run(db, statement);
      }
    });

    afterAll((done) => {
      db.close((err) => {
        if (err) console.error(err);
        done();
      });
    });

    it('creates exactly 13 tables', async () => {
      const rows = await all(
        db,
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      );

      expect(rows.length).toBe(13);

      const expectedTables = [
        'users',
        'settings',
        'file_nodes',
        'object_map',
        'filecache',
        'node_ancestors',
        'permissions_user_paths',
        'permissions_user_files',
        'permissions_shares',
        'share_links',
        'recent_files',
        'permission_requests',
        'locks',
      ];

      const actualTables = rows.map((r) => r.name).sort();
      expect(actualTables).toEqual(expectedTables.sort());
    });

    it('FK constraints work on self-referencing file_nodes.parent_id', async () => {
      const parentId = crypto.randomUUID().slice(0, 8);

      await run(db, `INSERT INTO file_nodes (name, type) VALUES (?, 'directory')`, [parentId]);

      const root = await get(db, `SELECT id FROM file_nodes WHERE name = ? AND parent_id IS NULL`, [
        parentId,
      ]);
      expect(root).toBeDefined();

      await run(
        db,
        `INSERT INTO file_nodes (parent_id, name, type) VALUES (?, ?, ?)`,
        [root.id, `${parentId}-child`, 'directory']
      );

      const child = await get(
        db,
        `SELECT id, parent_id FROM file_nodes WHERE name = ? AND parent_id = ?`,
        [`${parentId}-child`, root.id]
      );
      expect(child).toBeDefined();
      expect(child.parent_id).toBe(root.id);
    });

    it('CASCADE delete propagates from parent to child nodes', async () => {
      const uniquePrefix = crypto.randomUUID().slice(0, 8);

      await run(db, `INSERT INTO file_nodes (name, type) VALUES (?, 'directory')`, [uniquePrefix]);

      const parent = await get(db, `SELECT id FROM file_nodes WHERE name = ? AND parent_id IS NULL`, [
        uniquePrefix,
      ]);

      await run(
        db,
        `INSERT INTO file_nodes (parent_id, name, type) VALUES (?, ?, 'file')`,
        [parent.id, `${uniquePrefix}-child`]
      );

      const childCountBefore = await get(
        db,
        `SELECT COUNT(*) as count FROM file_nodes WHERE parent_id = ?`,
        [parent.id]
      );
      expect(childCountBefore.count).toBeGreaterThan(0);

      await run(db, `DELETE FROM file_nodes WHERE id = ?`, [parent.id]);

      const remainingChildren = await get(
        db,
        `SELECT COUNT(*) as count FROM file_nodes WHERE parent_id = ?`,
        [parent.id]
      );
      expect(remainingChildren.count).toBe(0);

      const remainingParent = await get(db, `SELECT id FROM file_nodes WHERE id = ?`, [parent.id]);
      expect(remainingParent).toBeUndefined();
    });

    it('maps BIGSERIAL PRIMARY KEY to INTEGER', async () => {
      const info = await all(
        db,
        "PRAGMA table_info(file_nodes)"
      );

      const idCol = info.find((c) => c.name === 'id');
      expect(idCol.type).toBe('INTEGER');
    });

    it('maps BIGINT to INTEGER for filecache.size', async () => {
      const info = await all(
        db,
        "PRAGMA table_info(filecache)"
      );

      const sizeCol = info.find((c) => c.name === 'size');
      expect(sizeCol.type).toBe('INTEGER');
    });

    it('maps TIMESTAMPTZ to TEXT for users.created_at', async () => {
      const info = await all(
        db,
        "PRAGMA table_info(users)"
      );

      const createdAtCol = info.find((c) => c.name === 'created_at');
      expect(createdAtCol.type).toBe('TEXT');
    });
  });

  describe('PostgreSQL path', () => {
    if (!process.env.DOCKER_AVAILABLE) {
      it.skip('requires DOCKER_AVAILABLE=1 to run PostgreSQL smoke test', () => {});
    } else {
      it('skipped in this context — Docker available but not exercised in local CI', () => {
        console.log('PostgreSQL smoke test would spin up postgres:16 container here');
      });
    }
  });
});
