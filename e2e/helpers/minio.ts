import {
  S3Client,
  ListObjectsV2Command,
  type ListObjectsV2CommandInput,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

/**
 * Direct MinIO access for E2E scenarios that assert blob-level behavior with
 * no non-blob observable (e.g. the migration E2E's "no duplicate blobs"
 * guarantees and its deterministic bucket baseline). Config mirrors
 * `e2e/global-setup.ts`.
 *
 * Bucket contract (Option A Phase 1): every helper takes the bucket explicitly
 * so the migration suite can target its DEDICATED `e2e-migration-bucket` and
 * never empty/list the shared `e2e-test-bucket` that the s3-mode platform
 * tests write to — the suites can therefore run concurrently.
 */

const E2E_S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://127.0.0.1:9010';
const E2E_S3_REGION = process.env.AWS_REGION || 'us-east-1';
const E2E_S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || 'minioadmin';
const E2E_S3_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin';

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

/** List every object key currently present in `bucket`. */
export async function listS3Keys(bucket: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const params: ListObjectsV2CommandInput = { Bucket: bucket };
    if (token) params.ContinuationToken = token;

    const response = await getS3Client().send(new ListObjectsV2Command(params));
    for (const item of response.Contents || []) {
      if (item.Key) keys.push(item.Key);
    }
    token = response.NextContinuationToken;
  } while (token);

  return keys;
}

/** True when an object with `key` exists in `bucket`. */
export async function blobExists(key: string, bucket: string): Promise<boolean> {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw err;
  }
}

/**
 * Create `bucket` when it does not exist. The bucket is wiped by the
 * global-teardown `down -v`, so a later run (any mode) must be able to
 * re-provision it deterministically.
 */
export async function ensureS3BucketExists(bucket: string): Promise<void> {
  const client = getS3Client();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status !== 404 && status !== 403) throw err;
  }
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
}

/**
 * Delete every object currently in `bucket`. Used by the migration E2E to give
 * its "no duplicate blobs" assertions a deterministic baseline per case. The
 * migration suite passes its dedicated bucket, so it never empties the shared
 * platform bucket.
 */
export async function emptyS3Bucket(bucket: string): Promise<void> {
  const client = getS3Client();
  await ensureS3BucketExists(bucket);
  for (;;) {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    const contents = listed.Contents || [];
    if (contents.length === 0) return;
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: contents.map(({ Key }) => ({ Key: Key as string })) },
      })
    );
    if (!listed.IsTruncated) return;
  }
}
