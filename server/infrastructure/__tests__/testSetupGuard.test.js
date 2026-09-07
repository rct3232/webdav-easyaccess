/**
 * Guards the jest entry contract (server/test-setup.js): production WEA_DB_*
 * identity keys are always blanked and the legacy WEA_TEST_REMOTE /
 * WEA_DB_TEST_DATABASE markers are removed, so no jest suite can run against a
 * production database; a real-PG leg must use the dedicated WEA_TEST_PG_*
 * namespace with an allowlisted disposable DB name.
 */
const IDENTITY_KEYS = ['WEA_DB_HOST', 'WEA_DB_DATABASE', 'WEA_DB_USER', 'WEA_DB_PASSWORD'];

describe('test-setup.js env guard', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...savedEnv };
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    delete require.cache[require.resolve('../../test-setup')];
  });

  it('blanks WEA_DB_* identity keys and removes the legacy markers', () => {
    process.env.WEA_DB_HOST = 'prod.example';
    process.env.WEA_DB_PASSWORD = 'secret';
    process.env.WEA_TEST_REMOTE = '1';
    process.env.WEA_DB_TEST_DATABASE = 'webdav-easyaccess';

    jest.isolateModules(() => {
      require('../../test-setup');
    });

    for (const key of IDENTITY_KEYS) {
      expect(process.env[key]).toBe('');
    }
    expect(process.env.WEA_TEST_REMOTE).toBeUndefined();
    expect(process.env.WEA_DB_TEST_DATABASE).toBeUndefined();
  });

  it('throws when WEA_TEST_PG_DATABASE is not an allowlisted disposable DB', () => {
    process.env.WEA_TEST_PG_DATABASE = 'webdav-easyaccess';

    expect(() => {
      jest.isolateModules(() => {
        require('../../test-setup');
      });
    }).toThrow(/Refusing real-PG test run/);
  });

  it('accepts an allowlisted WEA_TEST_PG_DATABASE without touching WEA_DB_*', () => {
    process.env.WEA_TEST_PG_DATABASE = 'webdav_test';
    process.env.WEA_DB_HOST = 'should-still-be-blanked.example';

    jest.isolateModules(() => {
      require('../../test-setup');
    });

    expect(process.env.WEA_TEST_PG_DATABASE).toBe('webdav_test');
    expect(process.env.WEA_DB_HOST).toBe('');
  });
});
