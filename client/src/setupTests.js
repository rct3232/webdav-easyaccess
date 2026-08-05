/**
 * Jest setup - runs before each test file.
 * MSW handlers from mocks/handlers.js are used when tests call the API.
 * Polyfills must run first so MSW has TextEncoder.
 * @see docs/TESTING_STRATEGY.md
 * @see docs/api.md
 */
import './jest-polyfills.js';
import { __setRetryConfigForTests } from './services/httpClient';

jest.mock('react-pdf', () => {
  const React = require('react');
  return {
    Document: ({ children }) => React.createElement('div', { 'data-testid': 'pdf-document' }, children),
    Page: () => React.createElement('div', { 'data-testid': 'pdf-page' }),
    pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
  };
});
import '@testing-library/jest-dom';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers';

__setRetryConfigForTests({ retryDelay: 0 });

export const server = setupServer(...handlers);

// React 18 expects this flag in custom Jest/jsdom setups so async updates can
// be tracked through act-aware helpers from React Testing Library.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
global.IS_REACT_ACT_ENVIRONMENT = true;
if (typeof window !== 'undefined') {
  window.IS_REACT_ACT_ENVIRONMENT = true;
}
if (typeof self !== 'undefined') {
  self.IS_REACT_ACT_ENVIRONMENT = true;
}

// IntersectionObserver mock for hooks that use it (e.g. useInfiniteScroll)
global.IntersectionObserver = class MockIntersectionObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe() { }
  disconnect() { }
  unobserve() { }
};

// Mock ResizeObserver for JSDOM
global.ResizeObserver = class ResizeObserver {
  observe() { }
  unobserve() { }
  disconnect() { }
};

// JSDOM does not implement canvas.getContext(). Return null so string-width
// helpers use their existing no-canvas fallback without noisy warnings.
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: jest.fn(() => null),
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
