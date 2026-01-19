module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'utils/**/*.js',
    'models/**/*.js',
    'middleware/**/*.js',
    // NOTE: Route handlers and WebDAV/network integrations are covered by integration tests,
    // which we do not run in unit test CI. Exclude them from unit coverage thresholds.
    '!routes/**/*.js',
    '!utils/webdav.js',
    '!utils/email.js',
    '!utils/thumbnail.js',
    '!utils/paths.js',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/__tests__/**'
  ],
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 75,
      statements: 75
    }
  },
  setupFilesAfterEnv: ['<rootDir>/test-setup.js'],
  testTimeout: 10000,
  verbose: true
};

