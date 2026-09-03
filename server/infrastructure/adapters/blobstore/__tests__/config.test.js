'use strict';

jest.mock('webdav', () => {
  const createClient = jest.fn((url, options) => ({ url, options, isMockClient: true }));
  return { createClient };
});

jest.mock('../S3BlobStore', () => {
  const RealS3BlobStore = jest.requireActual('../S3BlobStore');
  return jest.fn(function S3BlobStore(config) {
    return new RealS3BlobStore(config);
  });
});

jest.mock('../WebdavBlobStore', () => {
  const RealWebdavBlobStore = jest.requireActual('../WebdavBlobStore');
  return jest.fn(function WebdavBlobStore(webdavClient) {
    return new RealWebdavBlobStore(webdavClient);
  });
});

const RealS3BlobStore = jest.requireActual('../S3BlobStore');
const RealWebdavBlobStore = jest.requireActual('../WebdavBlobStore');

const { buildDestBlobStore, deriveDirection, destinationTypeForDirection } = require('../config');
const S3BlobStore = require('../S3BlobStore');
const WebdavBlobStore = require('../WebdavBlobStore');
const { createClient } = require('webdav');

describe('deriveDirection', () => {
  it('derives webdav-to-s3 when fileStorageMode is webdav', () => {
    expect(deriveDirection('webdav')).toBe('webdav-to-s3');
  });

  it('derives s3-to-webdav for any other fileStorageMode', () => {
    expect(deriveDirection('s3')).toBe('s3-to-webdav');
    expect(deriveDirection(undefined)).toBe('s3-to-webdav');
    expect(deriveDirection('gcs')).toBe('s3-to-webdav');
  });
});

describe('destinationTypeForDirection', () => {
  it('maps webdav-to-s3 to an s3 destination', () => {
    expect(destinationTypeForDirection('webdav-to-s3')).toBe('s3');
  });

  it('maps s3-to-webdav to a webdav destination', () => {
    expect(destinationTypeForDirection('s3-to-webdav')).toBe('webdav');
  });
});

describe('buildDestBlobStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('type validation', () => {
    it('throws when type is missing', () => {
      expect(() => buildDestBlobStore({})).toThrow(/missing required destination field: type/i);
    });

    it('throws clear error for unsupported type', () => {
      expect(() => buildDestBlobStore({ type: 'gcs' })).toThrow(/invalid destination type: gcs/i);
    });
  });

  describe('s3 destination', () => {
    const baseS3 = {
      type: 's3',
      bucket: 'my-bucket',
      accessKey: 'ak',
      secretKey: 'sk',
    };

    it('builds an S3BlobStore with region defaulting to us-east-1', () => {
      const { blobStore, summary } = buildDestBlobStore(baseS3);

      expect(blobStore).toBeInstanceOf(RealS3BlobStore);
      expect(summary).toContain('s3 destination');
      expect(summary).toContain('bucket=my-bucket');
      expect(summary).toContain('region=us-east-1');
    });

    it('uses provided region when set', () => {
      const { summary } = buildDestBlobStore({ ...baseS3, region: 'eu-west-1' });
      expect(summary).toContain('region=eu-west-1');
    });

    it('passes endpoint through so forcePathStyle applies', () => {
      const { blobStore } = buildDestBlobStore({ ...baseS3, endpoint: 'http://localhost:9000' });
      expect(blobStore.client.config.forcePathStyle).toBe(true);
    });

    it('accepts accessKeyId/secretAccessKey aliases', () => {
      const { blobStore } = buildDestBlobStore({
        type: 's3',
        bucket: 'my-bucket',
        accessKeyId: 'alias-ak',
        secretAccessKey: 'alias-sk',
      });
      expect(blobStore).toBeInstanceOf(RealS3BlobStore);
    });

    it('throws listing exactly which required fields are missing', () => {
      expect(() => buildDestBlobStore({ type: 's3', region: 'eu-west-1' })).toThrow(
        'Missing required destination fields: bucket, accessKey, secretKey'
      );
    });

    it('throws when required fields are empty strings', () => {
      expect(() =>
        buildDestBlobStore({ type: 's3', bucket: '', accessKey: 'ak', secretKey: '' })
      ).toThrow('Missing required destination fields: bucket, secretKey');
    });
  });

  describe('webdav destination', () => {
    const baseWebdav = {
      type: 'webdav',
      url: 'https://dav.example.com',
      username: 'user',
      password: 'secret',
    };

    it('builds a WebdavBlobStore wrapping a webdav client adapter', () => {
      const { blobStore, summary } = buildDestBlobStore(baseWebdav);

      expect(WebdavBlobStore).toHaveBeenCalledTimes(1);
      expect(createClient).toHaveBeenCalledWith(
        'https://dav.example.com',
        expect.objectContaining({
          username: 'user',
          password: 'secret',
          headers: expect.objectContaining({ 'User-Agent': 'WebDAV-EasyAccess/1.0' }),
        })
      );
      expect(blobStore).toBeInstanceOf(RealWebdavBlobStore);
      expect(typeof blobStore.uploadBlob).toBe('function');
      expect(typeof blobStore.downloadBlob).toBe('function');
      expect(typeof blobStore.deleteBlob).toBe('function');
      expect(typeof blobStore.headBlob).toBe('function');
      expect(typeof blobStore.createDirectory).toBe('function');
      expect(typeof blobStore.webdav.getFileContents).toBe('function');
      expect(typeof blobStore.webdav.putFileContents).toBe('function');
      expect(typeof blobStore.webdav.deleteFile).toBe('function');
      expect(typeof blobStore.webdav.getFileMetadata).toBe('function');
      expect(summary).toContain('webdav destination');
      expect(summary).toContain('url=https://dav.example.com');
      expect(summary).toContain('authType=auto');
    });

    it('defaults authType to auto (omits authType option) and upstreamUrl to empty string', () => {
      buildDestBlobStore(baseWebdav);

      const [url, options] = createClient.mock.calls[0];
      expect(url).toBe('https://dav.example.com');
      expect(options.authType).toBeUndefined();

      const { blobStore } = buildDestBlobStore(baseWebdav);
      expect(blobStore.webdav.upstreamUrl).toBe('');
    });

    it('passes non-auto authType through to the client', () => {
      buildDestBlobStore({ ...baseWebdav, authType: 'digest' });
      expect(createClient).toHaveBeenCalledWith(
        'https://dav.example.com',
        expect.objectContaining({ authType: 'digest' })
      );
    });

    it('passes upstreamUrl through and exposes it on the adapter', () => {
      const { blobStore } = buildDestBlobStore({
        ...baseWebdav,
        upstreamUrl: 'https://upstream.example.com',
      });
      expect(blobStore.webdav.upstreamUrl).toBe('https://upstream.example.com');
    });

    it('trims trailing slash from the url', () => {
      buildDestBlobStore({ ...baseWebdav, url: 'https://dav.example.com/' });
      expect(createClient).toHaveBeenCalledWith('https://dav.example.com', expect.any(Object));
    });

    it('throws listing exactly which required fields are missing', () => {
      expect(() => buildDestBlobStore({ type: 'webdav', url: 'https://dav.example.com' })).toThrow(
        'Missing required destination fields: username, password'
      );
    });
  });

  describe('summary sanitization', () => {
    it('never includes secrets for s3', () => {
      const { summary } = buildDestBlobStore({
        type: 's3',
        bucket: 'b',
        accessKey: 'SUPER-SECRET-AK',
        secretKey: 'SUPER-SECRET-SK',
        region: 'eu-central-1',
        endpoint: 'http://localhost:9000',
      });
      expect(summary).not.toContain('SUPER-SECRET-AK');
      expect(summary).not.toContain('SUPER-SECRET-SK');
      expect(summary).toContain('endpoint=http://localhost:9000');
    });

    it('never includes secrets for webdav', () => {
      const { summary } = buildDestBlobStore({
        type: 'webdav',
        url: 'https://dav.example.com',
        username: 'admin',
        password: 'hunter2',
        authType: 'digest',
        upstreamUrl: 'https://upstream.example.com',
      });
      expect(summary).not.toContain('admin');
      expect(summary).not.toContain('hunter2');
      expect(summary).toContain('authType=digest');
      expect(summary).toContain('upstreamUrl=https://upstream.example.com');
    });
  });
});
