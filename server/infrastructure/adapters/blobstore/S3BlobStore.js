'use strict';

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, CopyObjectCommand } = require('@aws-sdk/client-s3');

class S3BlobStore {
  constructor(config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      credentials: config.credentials,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    });
  }

  async uploadBlob(key, buffer) {
    if (!key) throw new Error('S3 key is required');
    if (buffer == null) throw new Error('Buffer is required');

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
    }));
  }

  async downloadBlob(key) {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));

    if (Buffer.isBuffer(response.Body)) {
      return response.Body;
    }

    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async deleteBlob(key) {
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
    } catch (err) {
      if (err.name !== 'NoSuchKey' && !err.message.includes('NoSuchKey')) throw err;
    }
  }

  async headBlob(key) {
    const res = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    return {
      contentLength: Number(res.ContentLength),
      contentType: res.ContentType,
    };
  }

  async copyBlob(sourceKey, destKey) {
    try {
      await this.client.send(new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourceKey}`,
        Key: destKey,
      }));
    } catch (err) {
      if (err.name === 'NoSuchKey' || String(err.message || '').includes('NoSuchKey')) {
        throw new Error(`Source key not found for copy: ${sourceKey}`);
      }
      throw err;
    }
  }

  async listOrphanedKeys(olderThan) {
    const keys = [];
    let token;

    do {
      const cmdParams = { Bucket: this.bucket };
      if (token) cmdParams.ContinuationToken = token;

      const response = await this.client.send(new ListObjectsV2Command(cmdParams));
      const items = response.Contents || [];

      for (const item of items) {
        if (item.LastModified < olderThan) {
          keys.push(item.Key);
        }
      }

      token = response.NextContinuationToken;
    } while (token);

    return keys;
  }
}

/**
 * Inline S3 error → health-code classification (D2). Kept here instead of
 * reusing backendProbe so S3BlobStore never requires backendProbe (which
 * requires S3BlobStore at module load — a require cycle).
 */
function classifyS3Error(error) {
  if (!error) return 'unknown';
  const status =
    Number(error.$metadata && error.$metadata.httpStatusCode) || error.status || error.statusCode;
  const name = String(error.name || '') + ' ' + String(error.code || '') + ' ' + String(error.message || '');
  if (status === 403 || /accessdenied/i.test(name)) return 'auth';
  if (/nosuchbucket/i.test(name) || status === 404) return 'missing_resource';
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/.test(name)) return 'unreachable';
  return 'unknown';
}

function toShortReason(value) {
  if (value == null) return undefined;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > 200 ? text.slice(0, 200) : text;
}

function reportS3Ok() {
  const { getBackendHealth } = require('../../backendHealth');
  getBackendHealth().report('s3', { ok: true });
}

function reportS3Fail(error) {
  const { getBackendHealth } = require('../../backendHealth');
  getBackendHealth().report('s3', {
    ok: false,
    code: classifyS3Error(error),
    reason: toShortReason(error && error.message),
  });
}

function withHealthReport(fn) {
  return async function wrappedHealthReport(...args) {
    try {
      const result = await fn.apply(this, args);
      reportS3Ok();
      return result;
    } catch (error) {
      reportS3Fail(error);
      throw error;
    }
  };
}

for (const method of [
  'uploadBlob',
  'downloadBlob',
  'deleteBlob',
  'headBlob',
  'copyBlob',
  'listOrphanedKeys',
]) {
  S3BlobStore.prototype[method] = withHealthReport(S3BlobStore.prototype[method]);
}

module.exports = S3BlobStore;
