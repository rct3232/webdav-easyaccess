'use strict';

/**
 * In-memory S3 mock factory for server unit tests.
 */
function createS3Mock(overrides = {}) {
  const store = new Map();

  function methods() {
    return {
      putObject: jest.fn((cmd) => {
        const params = cmd.input || cmd;
        const { Bucket, Key, Body, ContentType } = params;
        store.set(Key, {
          Body,
          ContentType: ContentType || 'application/octet-stream',
          ContentLength: Buffer.isBuffer(Body) ? Body.length : 0,
          LastModified: new Date(),
        });
        return { Location: `/${Bucket}/${Key}` };
      }),

      getObject: jest.fn((cmd) => {
        const params = cmd.input || cmd;
        const { Key } = params;
        const obj = store.get(Key);
        if (!obj) {
          throw new Error('NoSuchKey');
        }
        return {
          Body: obj.Body,
          ContentType: obj.ContentType,
          ContentLength: obj.ContentLength,
        };
      }),

      deleteObject: jest.fn((cmd) => {
        const params = cmd.input || cmd;
        const { Key } = params;
        store.delete(Key);
        return {};
      }),

      copyObject: jest.fn((cmd) => {
        const params = cmd.input || cmd;
        const { CopySource, Key } = params;
        const sourceKey =
          typeof CopySource === 'string' ? CopySource.split('/').slice(1).join('/') : CopySource;
        const src = store.get(sourceKey);
        if (!src) {
          throw new Error('NoSuchKey');
        }
        store.set(Key, {
          Body: src.Body,
          ContentType: src.ContentType,
          ContentLength: src.ContentLength,
          LastModified: new Date(),
        });
        return { CopyObjectResult: {} };
      }),

      headObject: jest.fn((cmd) => {
        const params = cmd.input || cmd;
        const { Key } = params;
        const obj = store.get(Key);
        if (!obj) {
          throw new Error('NoSuchKey');
        }
        return {
          ContentLength: obj.ContentLength,
          ContentType: obj.ContentType,
          LastModified: obj.LastModified,
        };
      }),

      listObjectsV2: jest.fn((cmd) => {
        const params = cmd.input || cmd;
        const { ContinuationToken, MaxKeys } = params;
        const allEntries = Array.from(store.entries()).map(([Key, obj]) => ({
          Key,
          Size: obj.ContentLength,
          LastModified: obj.LastModified,
        }));

        let startIdx = 0;
        if (ContinuationToken) {
          const tokenIdx = allEntries.findIndex((e) => e.Key === ContinuationToken);
          if (tokenIdx >= 0) {
            startIdx = tokenIdx + 1;
          }
        }

        const sliced = MaxKeys
          ? allEntries.slice(startIdx, startIdx + MaxKeys)
          : allEntries.slice(startIdx);
        const isTruncated = sliced.length > 0 && startIdx + sliced.length < allEntries.length;

        return {
          Contents: sliced,
          KeyCount: sliced.length,
          IsTruncated: isTruncated,
          NextContinuationToken: isTruncated ? sliced[sliced.length - 1].Key : undefined,
        };
      }),

      getStore: () => store,

      clearStore: () => {
        store.clear();
      },
    };
  }

  return {
    ...methods(),
    ...overrides,
  };
}

module.exports = { createS3Mock };
