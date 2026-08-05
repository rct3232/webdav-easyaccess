/**
 * Jest global setup - runs before each test file.
 * Ensures test environment uses FS storage backend and skips default admin bootstrap.
 * @see docs/TEST_GIT_GUIDE.md
 * @see docs/TESTING_STRATEGY.md
 */
process.env.NODE_ENV = 'test';
process.env.WEA_DISABLE_DEFAULT_ADMIN = 'true';
process.env.WEA_STORAGE_BACKEND = process.env.WEA_STORAGE_BACKEND || 'sqlite';
process.env.WEA_SKIP_BULK_WORKER = '1';

jest.spyOn(console, 'log').mockImplementation(() => {});
