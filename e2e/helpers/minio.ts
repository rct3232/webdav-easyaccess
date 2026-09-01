import {
  S3Client,
  ListObjectsV2Command,
  type ListObjectsV2CommandInput,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

/**
 * Direct MinIO access for the S3+PostgreSQL E2E scenarios (E2E-S3PG-005/008).
 *
 * These scenarios assert blob-level behavior that is only observable against
 * the object store itself (GC Tier 2 reconciliation), so the spec talks to
 * the seeded bucket directly. Config mirrors `e2e/global-setup.ts`.
 */

const E2E_S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://127.0.0.1:9010';
const E2E_S3_REGION = process.env.AWS_REGION || 'us-east-1';
const E2E_S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || 'minioadmin';
const E2E_S3_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin';
const E2E_S3_BUCKET = process.env.S3_BUCKET || 'e2e-test-bucket';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: E2E_S3_REGION,
      credentials: {
        accessKeyId: E2E_S3_ACCESS_KEY,
        secretAccessKey: E2E_S3_SECRET_KEY,
      },
      endpoint: E2E_S3_ENDPOINT,
      forcePathStyle: true,
    });
  }
  return s3Client;
}

/** List every object key currently present in the seeded bucket. */
export async function listS3Keys(): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const params: ListObjectsV2CommandInput = { Bucket: E2E_S3_BUCKET };
    if (token) params.ContinuationToken = token;

    const response = await getS3Client().send(new ListObjectsV2Command(params));
    for (const item of response.Contents || []) {
      if (item.Key) keys.push(item.Key);
    }
    token = response.NextContinuationToken;
  } while (token);

  return keys;
}

/** True when an object with `key` exists in the seeded bucket. */
export async function blobExists(key: string): Promise<boolean> {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: E2E_S3_BUCKET, Key: key }));
    return true;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw err;
  }
}

/** Directly PUT a blob that has no corresponding `object_map` row (E2E-S3PG-008). */
export async function putBlob(key: string, body: Buffer): Promise<void> {
  await getS3Client().send(new PutObjectCommand({ Bucket: E2E_S3_BUCKET, Key: key, Body: body }));
}

/**
 * Delete every object currently in the seeded bucket. Used by the migration
 * E2E to give its "no duplicate blobs" assertions a deterministic baseline:
 * the shared bucket otherwise accumulates objects across tests in the same
 * Playwright invocation, so an exact `listS3Keys()` count match must start
 * from an empty bucket per case.
 */
export async function emptyS3Bucket(): Promise<void> {
  const client = getS3Client();
  for (;;) {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: E2E_S3_BUCKET }));
    const contents = listed.Contents || [];
    if (contents.length === 0) return;
    await client.send(
      new DeleteObjectsCommand({
        Bucket: E2E_S3_BUCKET,
        Delete: { Objects: contents.map(({ Key }) => ({ Key: Key as string })) },
      })
    );
    if (!listed.IsTruncated) return;
  }
}
