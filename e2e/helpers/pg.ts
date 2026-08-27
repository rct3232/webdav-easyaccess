/**
 * Direct PostgreSQL access for the S3+PostgreSQL E2E scenarios.
 *
 * Used only where the assertion has no non-DB observable:
 * - E2E-S3PG-004 needs to prove two nodes reference the same S3 blob, and no
 *   API exposes `object_map.s3_key`, so a targeted read is the only reliable way.
 * - E2E-S3PG-005 needs to capture the blob key before the node delete cascades
 *   the `object_map` row away, so it can assert the blob is reclaimed by GC.
 *
 * `pg` is required via `createRequire` because it ships no TypeScript types
 * and the e2e toolchain has no `@types/pg`; the local structural type keeps the
 * surface typed without an extra dependency.
 */

import { createRequire } from 'node:module';

const require = createRequire(__filename);

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
};

type PgPoolFactory = new (config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}) => PgPool;

const { Pool } = require('pg') as { Pool: PgPoolFactory };

let pool: PgPool | null = null;

function getPool(): PgPool {
  if (!pool) {
    pool = new Pool({
      host: process.env.WEA_PG_HOST || '127.0.0.1',
      port: Number(process.env.WEA_PG_PORT || '5433'),
      database: process.env.WEA_PG_DATABASE || 'webdav_e2e',
      user: process.env.WEA_PG_USER || 'e2etest',
      password: process.env.WEA_PG_PASSWORD || 'e2etest',
    });
  }
  return pool;
}

export async function queryPg<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

export async function closePgPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
