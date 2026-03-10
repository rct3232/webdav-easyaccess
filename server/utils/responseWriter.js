const { once } = require('events');

const DEFAULT_CHUNK_SIZE_BYTES = 1024 * 1024; // 1MB

async function sendBufferAsChunks(res, buffer, options = {}) {
  const chunkSizeBytes = options.chunkSizeBytes || DEFAULT_CHUNK_SIZE_BYTES;

  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('sendBufferAsChunks: buffer must be a Buffer');
  }

  if (!res.headersSent) {
    res.flushHeaders?.();
  }

  let offset = 0;
  while (offset < buffer.length) {
    const end = Math.min(offset + chunkSizeBytes, buffer.length);
    const ok = res.write(buffer.subarray(offset, end));
    offset = end;
    if (!ok) {
      await once(res, 'drain');
    }
  }
  res.end();
}

module.exports = {
  sendBufferAsChunks,
};

