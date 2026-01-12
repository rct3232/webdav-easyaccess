/**
 * Global test setup for Jest
 * Initializes test environment, in-memory database, and environment variables
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.WEBDAV_URL = 'http://test-webdav-server.com';
process.env.WEBDAV_USERNAME = 'test-user';
process.env.WEBDAV_PASSWORD = 'test-password';

// Suppress console output during tests (optional - can be commented out for debugging)
global.console = {
  ...console,
  // Uncomment below to suppress logs during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  error: console.error, // Keep error logs for debugging
};

// Set longer timeout for integration tests
jest.setTimeout(10000);

