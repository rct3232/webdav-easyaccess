'use strict';

/**
 * FileStoreAdapter interface contract.
 *
 * This file defines the type signature for file-store adapters wrapping
 * remote storage operations. Implementations must provide all methods
 * listed below with matching signatures and return types.
 */

/**
 * @typedef {Object} FileStoreAdapter
 * @property {function(string=): Promise<Array<Object>>} listDirectory — Lists directory contents. Returns array of entries with {filename, basename, type, size, lastmod, mime}.
 * @property {function(string): Promise<Buffer>} getFileContents — Reads file contents as a Buffer.
 * @property {function(string, Buffer): Promise<void>} putFileContents — Writes a Buffer to the given path, creating intermediate directories if needed.
 * @property {function(string, string, function=, boolean=, Object=): Promise<Object>} moveFile — Moves sourcePath → destinationPath. Returns {success}.
 * @property {function(string, string, function=, boolean=, Object=): Promise<Object>} copyFile — Copies sourcePath → destinationPath. Returns {success}.
 * @property {function(string, Object=): Promise<Object>} deleteFile — Deletes a file or directory. Options: {isDirectory?: boolean}. Returns {success}.
 * @property {function(string): Promise<void>} createDirectory — Creates a directory at the given path.
 * @property {function(string): Promise<boolean>} pathExists — Checks whether a path exists on remote storage.
 * @property {function(string): Promise<Object>} getFileMetadata — Gets file metadata without reading content. Returns {size, lastmod, mime}.
 */

module.exports = {};
