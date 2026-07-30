'use strict';

const S3BlobStore = require('./S3BlobStore');
const NoOpBlobStore = require('./NoOpBlobStore');

function resolveS3Config() {
  const required = ['S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required S3 environment variables: ${missing.join(', ')}`);
  }

  const config = {
    bucket: process.env.S3_BUCKET,
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  };

  if (process.env.S3_ENDPOINT) {
    config.endpoint = process.env.S3_ENDPOINT;
  }

  return config;
}

function createBlobStore() {
  const storage = process.env.WEA_FILE_STORAGE || 's3';

  if (storage === 'webdav') {
    return new NoOpBlobStore();
  }

  const config = resolveS3Config();
  return new S3BlobStore(config);
}

module.exports = { createBlobStore, resolveS3Config };
