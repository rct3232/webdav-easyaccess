/**
 * auth.js production JWT relaxation tests (D7 / PLAN §5.2.1).
 *
 * Covers: prod + default JWT_SECRET + incomplete setup → loads, warns, does not
 * throw; prod + non-default JWT_SECRET → unchanged; defense-in-depth → still
 * throws in production when setup is complete.
 *
 * Each case loads auth.js in an isolated module registry and restores
 * process.env afterwards so the existing auth.test.js suite is unaffected.
 * @see docs/features/setup-wizard.md "Production JWT relaxation (D7)"
 */
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

const DEFAULT_JWT_SECRET = 'your-secret-key-change-in-production';
const CUSTOM_JWT_SECRET = 'a-custom-non-default-secret-value';

describe('auth.js production JWT relaxation', () => {
  let originalNodeEnv;
  let originalJwtSecret;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalJwtSecret = process.env.JWT_SECRET;
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    jest.restoreAllMocks();
  });

  it('loads (does not throw) and warns in production with default JWT_SECRET when setup is incomplete', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = DEFAULT_JWT_SECRET;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    let mod;
    expect(() => {
      jest.isolateModules(() => {
        mod = require('../auth');
      });
    }).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[setup-mode]'));
    expect(mod.generateToken).toBeDefined();
    expect(mod.verifyToken).toBeDefined();
  });

  it('loads unchanged in production with a non-default JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = CUSTOM_JWT_SECRET;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    let mod;
    expect(() => {
      jest.isolateModules(() => {
        mod = require('../auth');
      });
    }).not.toThrow();

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('[setup-mode]'));
    const token = mod.generateToken({ id: 1, username: 'alice', token_version: 0, is_admin: 0 });
    expect(mod.verifyToken(token)).toMatchObject({ id: 1, username: 'alice' });
  });

  it('still throws in production with default JWT_SECRET when setup is complete (defense-in-depth)', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = DEFAULT_JWT_SECRET;

    jest.isolateModules(() => {
      jest.doMock('../../infrastructure/setupStatus', () => ({
        computeSetupStatus: () => ({ setup_complete: true }),
      }));
      expect(() => require('../auth')).toThrow('JWT_SECRET must be set in production');
    });
  });

  it('keeps JWT consts frozen at require time and unchanged', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = CUSTOM_JWT_SECRET;

    let mod;
    jest.isolateModules(() => {
      mod = require('../auth');
    });

    const token = mod.generateToken({ id: 9, username: 'bob', token_version: 1, is_admin: 0 });
    expect(mod.verifyToken(token)).toMatchObject({ id: 9, username: 'bob', token_version: 1 });
    expect(SERVER_ERROR_CODES.setup.incomplete).toBeDefined();
  });
});
