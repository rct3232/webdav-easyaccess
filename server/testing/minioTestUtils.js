'use strict';

const {
  S3Client,
  CreateBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');

const BUCKET_ALREADY_EXISTS_ERRORS = new Set(['BucketAlreadyOwnedByYou', 'BucketAlreadyExists']);

function resolveConfig(input) {
  const endpoint = input.endpoint || process.env.S3_ENDPOINT;
  return {
    bucket: input.bucket || process.env.S3_BUCKET,
    region: input.region || process.env.AWS_REGION,
    credentials: input.credentials || {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    endpoint,
    forcePathStyle: input.forcePathStyle !== undefined ? input.forcePathStyle : Boolean(endpoint),
  };
}

function createClient(config) {
  const clientConfig = {
    region: config.region,
    credentials: config.credentials,
  };
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
    clientConfig.forcePathStyle = config.forcePathStyle;
  }
  return new S3Client(clientConfig);
}

async function ensureBucket({ endpoint, bucket, credentials, region, forcePathStyle = true } = {}) {
  const config = resolveConfig({ endpoint, bucket, credentials, region, forcePathStyle });
  if (!config.bucket) {
    throw new Error('S3 bucket name is required (S3_BUCKET env or `bucket` option)');
  }
  const client = createClient(config);
  try {
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  } catch (err) {
    if (!BUCKET_ALREADY_EXISTS_ERRORS.has(err.name)) throw err;
  }
  return { ok: true, bucket: config.bucket };
}

async function emptyBucket({ endpoint, bucket, credentials, region } = {}) {
  const config = resolveConfig({ endpoint, bucket, credentials, region });
  if (!config.bucket) {
    throw new Error('S3 bucket name is required (S3_BUCKET env or `bucket` option)');
  }
  const client = createClient(config);
  let deleted = 0;
  let token;

  do {
    const listParams = { Bucket: config.bucket };
    if (token) listParams.ContinuationToken = token;

    let response;
    try {
      response = await client.send(new ListObjectsV2Command(listParams));
    } catch (err) {
      if (err.name === 'NoSuchBucket') return 0;
      throw err;
    }

    const keys = (response.Contents || []).map((item) => item.Key);
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: { Objects: keys.map((key) => ({ Key: key })) },
        })
      );
      deleted += keys.length;
    }

    token = response.NextContinuationToken;
  } while (token);

  return deleted;
}

module.exports = { ensureBucket, emptyBucket };
