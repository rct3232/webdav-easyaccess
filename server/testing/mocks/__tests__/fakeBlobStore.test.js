'use strict';

const crypto = require('crypto');
const { createFakeBlobStore } = require('@testing/mocks/fakeBlobStore');

describe('createFakeBlobStore', () => {
  it('uploads and downloads a buffer round trip', async () => {
    const store = createFakeBlobStore();
    const data = Buffer.from('hello world');

    await store.uploadBlob('/folder/file.txt', data);

    expect(await store.downloadBlob('/folder/file.txt')).toEqual(data);
    expect(store.getBuffer('/folder/file.txt')).toEqual(data);
  });

  it('returns null for a missing key on download', async () => {
    const store = createFakeBlobStore();
    expect(await store.downloadBlob('missing')).toBeNull();
  });

  it('headBlob returns contentLength/contentType for existing key and null for missing', async () => {
    const store = createFakeBlobStore();
    await store.uploadBlob('key-1', Buffer.from('abcde'));

    expect(await store.headBlob('key-1')).toEqual({ contentLength: 5, contentType: null });
    expect(await store.headBlob('missing')).toBeNull();
  });

  it('deleteBlob removes the blob and is idempotent', async () => {
    const store = createFakeBlobStore();
    await store.uploadBlob('key-1', Buffer.from('data'));

    await store.deleteBlob('key-1');
    expect(await store.downloadBlob('key-1')).toBeNull();

    await expect(store.deleteBlob('key-1')).resolves.not.toThrow();
  });

  it('createDirectory records the directory and all parents', async () => {
    const store = createFakeBlobStore();
    await store.createDirectory('/a/b/c');

    expect(store.listDirectories()).toEqual(expect.arrayContaining(['/a', '/a/b', '/a/b/c']));
  });

  it('ensureDirectoryExists records the directory idempotently', async () => {
    const store = createFakeBlobStore();
    await store.ensureDirectoryExists('/x/y');
    await store.ensureDirectoryExists('/x/y');

    expect(store.listDirectories()).toEqual(expect.arrayContaining(['/x', '/x/y']));
  });

  it('listKeys returns all stored keys', async () => {
    const store = createFakeBlobStore();
    await store.uploadBlob('a', Buffer.from('1'));
    await store.uploadBlob('b', Buffer.from('2'));

    expect(store.listKeys().sort()).toEqual(['a', 'b']);
  });

  it('count reflects stored blobs only', async () => {
    const store = createFakeBlobStore();
    await store.uploadBlob('a', Buffer.from('1'));
    await store.createDirectory('/dir');

    expect(store.count()).toBe(1);
  });

  describe('failure injection', () => {
    it('failOn makes every operation on that key throw', async () => {
      const store = createFakeBlobStore();
      store.failOn('poison');

      await expect(store.uploadBlob('poison', Buffer.from('x'))).rejects.toThrow(/injected failure/);
      await expect(store.downloadBlob('poison')).rejects.toThrow(/injected failure/);
      await expect(store.headBlob('poison')).rejects.toThrow(/injected failure/);
      await expect(store.deleteBlob('poison')).rejects.toThrow(/injected failure/);
    });

    it('failNextN fails the next n operations then recovers', async () => {
      const store = createFakeBlobStore();
      store.failNextN(2);

      await expect(store.uploadBlob('a', Buffer.from('1'))).rejects.toThrow(/injected failure/);
      await expect(store.downloadBlob('a')).rejects.toThrow(/injected failure/);

      await expect(store.downloadBlob('a')).resolves.toBeNull();
      await expect(store.uploadBlob('a', Buffer.from('1'))).resolves.toBeUndefined();
    });

    it('clearFailures removes all injected failures', async () => {
      const store = createFakeBlobStore();
      store.failOn('poison');
      store.failNextN(1);
      store.clearFailures();

      await expect(store.uploadBlob('poison', Buffer.from('x'))).resolves.toBeUndefined();
    });
  });

  describe('write log', () => {
    it('writtenKeys records keys/paths in operation order', async () => {
      const store = createFakeBlobStore();
      await store.uploadBlob('/f1.txt', Buffer.from('1'));
      await store.createDirectory('/dir');
      await store.uploadBlob('/f2.txt', Buffer.from('2'));

      expect(store.writtenKeys()).toEqual(['/f1.txt', '/dir', '/f2.txt']);
      expect(store.writtenPaths()).toEqual(['/f1.txt', '/dir', '/f2.txt']);
    });

    it('clearLog empties the write log', async () => {
      const store = createFakeBlobStore();
      await store.uploadBlob('a', Buffer.from('1'));

      store.clearLog();
      expect(store.writtenKeys()).toEqual([]);
    });
  });

  describe('content helpers', () => {
    it('hashAll returns key to sha256 hex mapping', async () => {
      const store = createFakeBlobStore();
      const dataA = Buffer.from('content-a');
      const dataB = Buffer.from('content-b');
      await store.uploadBlob('a', dataA);
      await store.uploadBlob('b', dataB);

      const hashes = store.hashAll();
      expect(hashes).toBeInstanceOf(Map);
      expect(hashes.get('a')).toBe(crypto.createHash('sha256').update(dataA).digest('hex'));
      expect(hashes.get('b')).toBe(crypto.createHash('sha256').update(dataB).digest('hex'));
      expect(hashes.size).toBe(2);
    });
  });

  describe('overrides', () => {
    it('respects a method override provided by the caller', async () => {
      const uploadBlob = jest.fn().mockResolvedValue(undefined);
      const store = createFakeBlobStore({ uploadBlob });

      await store.uploadBlob('a', Buffer.from('1'));

      expect(uploadBlob).toHaveBeenCalledWith('a', Buffer.from('1'));
      expect(store.count()).toBe(0);
    });

    it('leaves non-overridden methods intact', async () => {
      const store = createFakeBlobStore({ downloadBlob: async () => Buffer.from('custom') });
      await store.uploadBlob('a', Buffer.from('real'));

      expect(await store.downloadBlob('a')).toEqual(Buffer.from('custom'));
      expect(store.getBuffer('a')).toEqual(Buffer.from('real'));
    });
  });
});
