/**
 * Jest polyfills - must run before any other test setup (e.g. MSW).
 * MSW requires TextEncoder, TextDecoder, TransformStream, ReadableStream.
 *
 * Override fetch with Node's undici: react-app-polyfill/jsdom loads whatwg-fetch
 * which throws when MSW handlers call request.formData(). Undici handles FormData correctly.
 */
const { TextEncoder, TextDecoder } = require('util');
const { TransformStream, ReadableStream, WritableStream } = require('stream/web');

if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;
if (typeof global.TransformStream === 'undefined') global.TransformStream = TransformStream;
if (typeof global.ReadableStream === 'undefined') global.ReadableStream = ReadableStream;
if (typeof global.WritableStream === 'undefined') global.WritableStream = WritableStream;

// undici expects MessagePort in Node test runtime; jsdom may not provide it.
// Keep polyfill surface minimal to reduce MessagePort open-handle noise in Jest.
if (typeof global.MessagePort === 'undefined') {
  const workerThreads = require('worker_threads');
  const { MessagePort, MessageChannel } = workerThreads;

  if (typeof global.MessagePort === 'undefined' && MessagePort) {
    global.MessagePort = MessagePort;
  }

  // Fallback for runtimes without direct MessagePort export.
  if (typeof global.MessagePort === 'undefined' && MessageChannel) {
    const ch = new MessageChannel();
    global.MessagePort = ch.port1.constructor;
    ch.port1.close?.();
    ch.port2.close?.();
    ch.port1.unref?.();
    ch.port2.unref?.();
  }
}

const { fetch, FormData, Request, Response } = require('undici');
globalThis.fetch = fetch;
globalThis.FormData = FormData;
globalThis.Request = Request;
globalThis.Response = Response;
if (typeof global.BroadcastChannel === 'undefined') {
  global.BroadcastChannel = class BroadcastChannel {
    constructor() {}
    postMessage() {}
    close() {}
  };
}

// JSDOM does not implement URL.createObjectURL/revokeObjectURL (used by fileService.downloadMultipleFiles)
if (typeof global.URL !== 'undefined' && !global.URL.createObjectURL) {
  const blobUrls = new Map();
  let idCounter = 0;
  global.URL.createObjectURL = function (blob) {
    const id = `blob:test-${++idCounter}`;
    blobUrls.set(id, blob);
    return id;
  };
  global.URL.revokeObjectURL = function (url) {
    blobUrls.delete(url);
  };
}
