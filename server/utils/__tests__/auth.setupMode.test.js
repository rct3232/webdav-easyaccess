/**
 * auth.js JWT_SECRET optional-resolution tests (D7 / PLAN W-11).
 *
 * JWT_SECRET is now an optional, .env-owned T0 key resolved at require time:
 * - a set (non-empty) env value is used verbatim; the well-known legacy
 *   placeholder only logs a "default value" warning — never an error, no matter
 *   the setup state;
 * - an unset/empty env value falls back to an ephemeral `crypto.randomBytes`
 *   secret generated per boot: a restart (fresh module load) signs with a new
 *   secret and invalidates every outstanding session.
 *
 * Each case loads auth.js in an isolated module registry and restores
 * process.env afterwards so the existing auth.test.js suite is unaffected.
 * @see docs/features/config-source-resolution.md "ephemeral fallback"
 * @see docs/spec/server/utils/auth.md
 */
const DEFAULT_JWT_SECRET = 'your-secret-key-change-in-production';
const CUSTOM_JWT_SECRET = 'a-custom-non-default-secret-value';

const USER = { id: 1, username: 'alice', token_version: 0, is_admin: 0 };

function loadAuth() {
  let mod;
  jest.isolateModules(() => {
    mod = require('../auth');
  });
  return mod;
}

// A fully configured production env (sqlite metadata + s3 file backend). Under
// the old contract this was the state that made a default/unset JWT_SECRET
// fail fast; setup completeness no longer gates boot at all.
function setProductionSetupCompleteEnv() {
  process.env.NODE_ENV = 'production';
  process.env.WEA_FILE_STORAGE = 's3';
  process.env.S3_BUCKET = 'my-bucket';
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID = 'AKIAEXAMPLE';
  process.env.AWS_SECRET_ACCESS_KEY = 'secret-value';
}

describe('auth.js JWT_SECRET optional resolution', () => {
  let originalNodeEnv;
  let originalJwtSecret;
  let originalFileKeys;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalJwtSecret = process.env.JWT_SECRET;
    originalFileKeys = {
      WEA_FILE_STORAGE: process.env.WEA_FILE_STORAGE,
      S3_BUCKET: process.env.S3_BUCKET,
      AWS_REGION: process.env.AWS_REGION,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    };
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    for (const [key, value] of Object.entries(originalFileKeys)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  it('loads without throwing in production with an unset JWT_SECRET (setup complete) and round-trips', () => {
    setProductionSetupCompleteEnv();
    delete process.env.JWT_SECRET;
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = loadAuth();
    const token = mod.generateToken(USER);
    expect(mod.verifyToken(token)).toMatchObject(USER);
  });

  it('loads without throwing in production when JWT_SECRET equals the legacy placeholder and warns with "default value"', () => {
    setProductionSetupCompleteEnv();
    process.env.JWT_SECRET = DEFAULT_JWT_SECRET;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => loadAuth()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('default value'));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('ephemeral'));
  });

  it('loads with a real custom secret, logs no warning, and round-trips', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = CUSTOM_JWT_SECRET;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = loadAuth();
    expect(warnSpy).not.toHaveBeenCalled();

    const token = mod.generateToken(USER);
    expect(mod.verifyToken(token)).toMatchObject(USER);
  });

  it('uses a fresh ephemeral secret per boot: an unset secret differs across isolated module loads', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.JWT_SECRET;
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const modA = loadAuth();
    const modB = loadAuth();

    // Within one boot the tokens verify...
    const tokenA = modA.generateToken(USER);
    expect(modA.verifyToken(tokenA)).toMatchObject(USER);
    const tokenB = modB.generateToken(USER);
    expect(modB.verifyToken(tokenB)).toMatchObject(USER);

    // ...but a token signed by load A must NOT verify under load B: a restart
    // (fresh require) invalidates every outstanding session.
    expect(modB.verifyToken(tokenA)).toBeNull();
    expect(modA.verifyToken(tokenB)).toBeNull();
  });

  it('logs nothing when the secret is unset and NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.JWT_SECRET;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    loadAuth();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns about an ephemeral secret when unset and NODE_ENV is not test', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    loadAuth();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ephemeral'));
  });

  it('treats an empty-string JWT_SECRET exactly like an unset one (ephemeral fallback)', () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = '   ';
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const modA = loadAuth();
    delete process.env.JWT_SECRET;
    const modB = loadAuth();

    const tokenA = modA.generateToken(USER);
    expect(modA.verifyToken(tokenA)).toMatchObject(USER);
    expect(modB.verifyToken(tokenA)).toBeNull();
  });
});
