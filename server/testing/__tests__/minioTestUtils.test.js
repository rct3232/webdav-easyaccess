'use strict';

let utils;
let objectStore;
let bucketExists;
let createErrorName;
let listSnapshot;
let commands;

const PAGE_SIZE = 2;

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn(),
  };
});

beforeEach(() => {
  jest.resetModules();
  objectStore = new Map();
  bucketExists = true;
  createErrorName = null;
  listSnapshot = [];
  commands = [];

  const MockedS3Client = require('@aws-sdk/client-s3').S3Client;
  MockedS3Client.mockImplementation((clientConfig) => ({
    send: async (command) => {
      commands.push({ name: command.constructor.name, input: command.input, clientConfig });
      const params = command.input;

      if (command.constructor.name === 'CreateBucketCommand') {
        if (createErrorName) {
          throw Object.assign(new Error('bucket unavailable'), { name: createErrorName });
        }
        return { Location: `/${params.Bucket}` };
      }

      if (command.constructor.name === 'ListObjectsV2Command') {
        if (!bucketExists) {
          throw Object.assign(new Error('The specified bucket does not exist'), { name: 'NoSuchBucket' });
        }
        if (!params.ContinuationToken) {
          listSnapshot = Array.from(objectStore.keys());
        }
        const startIdx = params.ContinuationToken ? Number(params.ContinuationToken) : 0;
        const page = listSnapshot.slice(startIdx, startIdx + PAGE_SIZE);
        const truncated = startIdx + page.length < listSnapshot.length;
        return {
          Contents: page.map((key) => ({ Key: key })),
          IsTruncated: truncated,
          NextContinuationToken: truncated ? String(startIdx + page.length) : undefined,
        };
      }

      if (command.constructor.name === 'DeleteObjectsCommand') {
        for (const entry of params.Delete.Objects) {
          objectStore.delete(entry.Key);
        }
        return { Deleted: params.Delete.Objects.map((entry) => ({ Key: entry.Key })) };
      }

      throw new Error(`Unknown command: ${command.constructor.name}`);
    },
  }));

  utils = require('../minioTestUtils');
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.S3_BUCKET;
  delete process.env.AWS_REGION;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.S3_ENDPOINT;
});

function baseOptions() {
  return {
    endpoint: 'http://localhost:9000',
    bucket: 'test-bucket',
    region: 'us-east-1',
    credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
  };
}

describe('ensureBucket', () => {
  it('creates the bucket and returns { ok: true, bucket }', async () => {
    const result = await utils.ensureBucket(baseOptions());
    expect(result).toEqual({ ok: true, bucket: 'test-bucket' });

    const create = commands.find((c) => c.name === 'CreateBucketCommand');
    expect(create.input).toEqual({ Bucket: 'test-bucket' });
  });

  it('treats BucketAlreadyOwnedByYou as success', async () => {
    createErrorName = 'BucketAlreadyOwnedByYou';
    const result = await utils.ensureBucket(baseOptions());
    expect(result).toEqual({ ok: true, bucket: 'test-bucket' });
  });

  it('treats BucketAlreadyExists as success', async () => {
    createErrorName = 'BucketAlreadyExists';
    const result = await utils.ensureBucket(baseOptions());
    expect(result).toEqual({ ok: true, bucket: 'test-bucket' });
  });

  it('rethrows non already-exists errors', async () => {
    createErrorName = 'AccessDenied';
    await expect(utils.ensureBucket(baseOptions())).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  it('throws a clear error when no bucket can be resolved', async () => {
    await expect(utils.ensureBucket({ region: 'r', credentials: { accessKeyId: 'k', secretAccessKey: 's' } }))
      .rejects.toThrow(/bucket name is required/i);
  });

  it('sets forcePathStyle=true on the S3Client when an endpoint is provided', async () => {
    await utils.ensureBucket(baseOptions());
    const clientConfig = commands[0].clientConfig;
    expect(clientConfig.endpoint).toBe('http://localhost:9000');
    expect(clientConfig.forcePathStyle).toBe(true);
  });
});

describe('emptyBucket', () => {
  it('deletes all objects across multiple pages and returns the count', async () => {
    objectStore = new Map(Array.from({ length: 5 }, (_, i) => [`obj-${i}`, {}]));

    const deleted = await utils.emptyBucket(baseOptions());

    expect(deleted).toBe(5);
    expect(objectStore.size).toBe(0);

    const lists = commands.filter((c) => c.name === 'ListObjectsV2Command');
    expect(lists.length).toBe(3);
    expect(lists[1].input.ContinuationToken).toBeDefined();

    const deletes = commands.filter((c) => c.name === 'DeleteObjectsCommand');
    expect(deletes.length).toBe(3);
    expect(deletes[0].input.Delete.Objects).toEqual([{ Key: 'obj-0' }, { Key: 'obj-1' }]);
  });

  it('returns 0 and is a no-op for a missing bucket', async () => {
    bucketExists = false;
    const deleted = await utils.emptyBucket(baseOptions());
    expect(deleted).toBe(0);
  });

  it('returns 0 for an already-empty bucket', async () => {
    const deleted = await utils.emptyBucket(baseOptions());
    expect(deleted).toBe(0);
    expect(commands.filter((c) => c.name === 'DeleteObjectsCommand')).toHaveLength(0);
  });
});

describe('env defaults', () => {
  it('derives defaults from process.env when options are omitted', async () => {
    process.env.S3_BUCKET = 'env-bucket';
    process.env.AWS_REGION = 'eu-west-1';
    process.env.AWS_ACCESS_KEY_ID = 'env-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'env-secret';
    process.env.S3_ENDPOINT = 'http://127.0.0.1:9010';

    const result = await utils.ensureBucket();
    expect(result).toEqual({ ok: true, bucket: 'env-bucket' });

    const create = commands.find((c) => c.name === 'CreateBucketCommand');
    expect(create.input.Bucket).toBe('env-bucket');
    expect(create.clientConfig).toMatchObject({
      region: 'eu-west-1',
      endpoint: 'http://127.0.0.1:9010',
      forcePathStyle: true,
      credentials: { accessKeyId: 'env-key', secretAccessKey: 'env-secret' },
    });
  });

  it('emptyBucket derives the bucket from env when omitted', async () => {
    process.env.S3_BUCKET = 'env-bucket';
    objectStore = new Map([['k1', {}]]);

    const deleted = await utils.emptyBucket({
      region: 'us-east-1',
      credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
    });

    expect(deleted).toBe(1);
  });

  it('explicit options take precedence over env defaults', async () => {
    process.env.S3_BUCKET = 'env-bucket';
    const result = await utils.ensureBucket(baseOptions());
    expect(result).toEqual({ ok: true, bucket: 'test-bucket' });
  });
});
