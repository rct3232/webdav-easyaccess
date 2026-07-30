'use strict';

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

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
    if (!buffer || buffer.length === 0) throw new Error('Buffer is required');

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

module.exports = S3BlobStore;
