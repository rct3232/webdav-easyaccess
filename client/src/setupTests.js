import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';
import { ReadableStream, TransformStream, WritableStream } from 'stream/web';

// Polyfill for MSW - must be before MSW imports
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.ReadableStream = ReadableStream;
global.WritableStream = WritableStream;
global.TransformStream = TransformStream;

// Mock BroadcastChannel for MSW
global.BroadcastChannel = class BroadcastChannel {
  constructor(name) {
    this.name = name;
  }
  postMessage() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
};

// Polyfill fetch if needed
if (typeof global.fetch === 'undefined') {
  const { fetch, Headers, Request, Response } = require('undici');
  global.fetch = fetch;
  global.Headers = Headers;
  global.Request = Request;
  global.Response = Response;
}

// Now import MSW server
const { server } = require('./mocks/server');

// MSW 서버 설정
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// window.URL.createObjectURL 모킹 (파일 다운로드용)
global.URL.createObjectURL = jest.fn(() => 'mock-url');
global.URL.revokeObjectURL = jest.fn();

// window.confirm 모킹
global.confirm = jest.fn(() => true);
global.alert = jest.fn();

// FormData 모킹
if (!global.FormData) {
  global.FormData = class FormData {
    constructor() {
      this.data = {};
    }
    append(key, value) {
      this.data[key] = value;
    }
    get(key) {
      return this.data[key];
    }
    has(key) {
      return key in this.data;
    }
  };
}

// HTMLElement.prototype.scrollIntoView 모킹
if (typeof HTMLElement.prototype.scrollIntoView === 'undefined') {
  HTMLElement.prototype.scrollIntoView = jest.fn();
}
