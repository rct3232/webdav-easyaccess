'use strict';

const crypto = require('crypto');

/**
 * In-memory BlobStore fake implementing the S3BlobStore/WebdavBlobStore surface
 * with real behavior. Test-only: never touches a real store.
 */
function createFakeBlobStore(overrides = {}) {
  const blobs = new Map();
  const directories = new Set();
  const writeLog = [];
  const failSet = new Set();
  let failNext = 0;

  function throwIfFailing(keyOrPath) {
    if (failNext > 0) {
      failNext -= 1;
      throw new Error('FakeBlobStore: injected failure (failNextN)');
    }
    if (keyOrPath != null && failSet.has(keyOrPath)) {
      throw new Error(`FakeBlobStore: injected failure for key: ${keyOrPath}`);
    }
  }

  function normalizeDirectoryPath(path) {
    const normalized = normalizePath(path);
    return normalized === '/' ? '/' : normalized.replace(/\/+$/, '');
  }

  function normalizePath(path) {
    if (!path) return '/';
    const trimmed = String(path).trim();
    if (!trimmed.startsWith('/')) return `/${trimmed}`;
    return trimmed.replace(/\/+/g, '/');
  }

  function recordDirectory(path) {
    const normalized = normalizeDirectoryPath(path);
    if (normalized === '/') {
      directories.add('/');
      return;
    }
    const segments = normalized.split('/').filter(Boolean);
    let currentPath = '';
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : `/${segment}`;
      directories.add(currentPath);
    }
  }

  async function uploadBlob(key, buffer) {
    throwIfFailing(key);
    if (!key) throw new Error('FakeBlobStore: key is required');
    if (buffer == null) throw new Error('FakeBlobStore: buffer is required');
    blobs.set(key, buffer);
    writeLog.push(key);
  }

  async function downloadBlob(key) {
    throwIfFailing(key);
    if (!blobs.has(key)) return null;
    return blobs.get(key);
  }

  async function deleteBlob(key) {
    throwIfFailing(key);
    blobs.delete(key);
  }

  async function headBlob(key) {
    throwIfFailing(key);
    if (!blobs.has(key)) return null;
    return {
      contentLength: blobs.get(key).length,
      contentType: null,
    };
  }

  async function createDirectory(path) {
    throwIfFailing(path);
    recordDirectory(path);
    writeLog.push(path);
  }

  async function ensureDirectoryExists(path) {
    throwIfFailing(path);
    recordDirectory(path);
    writeLog.push(path);
  }

  function listKeys() {
    return Array.from(blobs.keys());
  }

  function listDirectories() {
    return Array.from(directories);
  }

  function count() {
    return blobs.size;
  }

  function failOn(keyOrPath) {
    failSet.add(keyOrPath);
  }

  function failNextN(n) {
    failNext = n;
  }

  function clearFailures() {
    failSet.clear();
    failNext = 0;
  }

  function writtenKeys() {
    return [...writeLog];
  }

  function writtenPaths() {
    return [...writeLog];
  }

  function clearLog() {
    writeLog.length = 0;
  }

  function getBuffer(key) {
    return blobs.get(key);
  }

  function hashAll() {
    const hashes = new Map();
    for (const [key, buffer] of blobs) {
      hashes.set(key, crypto.createHash('sha256').update(buffer).digest('hex'));
    }
    return hashes;
  }

  return {
    uploadBlob: overrides.uploadBlob || uploadBlob,
    downloadBlob: overrides.downloadBlob || downloadBlob,
    deleteBlob: overrides.deleteBlob || deleteBlob,
    headBlob: overrides.headBlob || headBlob,
    createDirectory: overrides.createDirectory || createDirectory,
    ensureDirectoryExists: overrides.ensureDirectoryExists || ensureDirectoryExists,
    listKeys: overrides.listKeys || listKeys,
    listDirectories: overrides.listDirectories || listDirectories,
    count: overrides.count || count,
    failOn: overrides.failOn || failOn,
    failNextN: overrides.failNextN || failNextN,
    clearFailures: overrides.clearFailures || clearFailures,
    writtenKeys: overrides.writtenKeys || writtenKeys,
    writtenPaths: overrides.writtenPaths || writtenPaths,
    clearLog: overrides.clearLog || clearLog,
    getBuffer: overrides.getBuffer || getBuffer,
    hashAll: overrides.hashAll || hashAll,
  };
}

module.exports = { createFakeBlobStore };
