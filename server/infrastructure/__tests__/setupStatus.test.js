const { computeSetupStatus } = require('../setupStatus');

describe('computeSetupStatus', () => {
  describe('fresh / no env', () => {
    it('is incomplete with the exact s3 default missing list', () => {
      const status = computeSetupStatus({});
      expect(status.setup_complete).toBe(false);
      expect(status.missing).toEqual([
        'S3_BUCKET',
        'AWS_REGION',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
      ]);
    });
  });

  describe('full s3 + sqlite', () => {
    it('is complete', () => {
      const env = {
        S3_BUCKET: 'my-bucket',
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
        AWS_SECRET_ACCESS_KEY: 'secret-value',
      };
      const status = computeSetupStatus(env);
      expect(status.setup_complete).toBe(true);
      expect(status.missing).toEqual([]);
    });
  });

  describe('full postgresql + webdav', () => {
    it('is complete', () => {
      const env = {
        WEA_DB_HOST: 'db.example.com',
        WEA_DB_PORT: '5432',
        WEA_DB_DATABASE: 'webdav',
        WEA_DB_USER: 'admin',
        WEA_DB_PASSWORD: 'pg-pass',
        WEA_FILE_STORAGE: 'webdav',
        WEBDAV_URL: 'https://dav.example.com',
        WEBDAV_USERNAME: 'dav-user',
        WEBDAV_PASSWORD: 'dav-pass',
      };
      const status = computeSetupStatus(env);
      expect(status.setup_complete).toBe(true);
      expect(status.missing).toEqual([]);
    });
  });

  describe('JWT_SECRET is never a completeness condition (any NODE_ENV)', () => {
    // JWT_SECRET is optional (docs/features/config-source-resolution.md): an
    // unset secret falls back to an ephemeral per-boot random in auth.js, so it
    // never gates setup_complete and never appears in `missing`.
    const fullS3Env = {
      S3_BUCKET: 'my-bucket',
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'secret-value',
    };

    it('is complete in production when JWT_SECRET is unset', () => {
      const status = computeSetupStatus({ NODE_ENV: 'production', ...fullS3Env });
      expect(status.setup_complete).toBe(true);
      expect(status.missing).toEqual([]);
      expect(status.missing).not.toContain('JWT_SECRET');
    });

    it('is complete in production when JWT_SECRET equals the legacy placeholder', () => {
      const status = computeSetupStatus({
        NODE_ENV: 'production',
        JWT_SECRET: 'your-secret-key-change-in-production',
        ...fullS3Env,
      });
      expect(status.setup_complete).toBe(true);
      expect(status.missing).toEqual([]);
    });

    it('is complete in production with a non-default JWT_SECRET', () => {
      const status = computeSetupStatus({ NODE_ENV: 'production', JWT_SECRET: 'a-real-secret', ...fullS3Env });
      expect(status.setup_complete).toBe(true);
      expect(status.missing).toEqual([]);
    });

    it('is complete in non-production environments too (no special-casing)', () => {
      const status = computeSetupStatus({
        NODE_ENV: 'development',
        JWT_SECRET: 'your-secret-key-change-in-production',
        ...fullS3Env,
      });
      expect(status.setup_complete).toBe(true);
      expect(status.missing).toEqual([]);
    });
  });

  describe('current prefill values', () => {
    it('masks secrets, hides unset secrets, and reflects non-secrets', () => {
      const env = {
        WEA_DB_HOST: 'db.example.com',
        WEA_DB_PASSWORD: 'pg-pass',
        PORT: '5001',
        JWT_SECRET: 'top-secret',
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
        WEBDAV_PASSWORD: 'dav-pass',
        EMAIL_HOST: 'smtp.example.com',
      };
      const { current } = computeSetupStatus(env);
      expect(current.JWT_SECRET).toBe('****');
      expect(current.AWS_SECRET_ACCESS_KEY).toBe('****');
      expect(current.WEBDAV_PASSWORD).toBe('****');
      // Metadata/T0 keys are no longer wizard-writable (D7) — never in `current`.
      expect(current.WEA_DB_HOST).toBeUndefined();
      expect(current.WEA_DB_PASSWORD).toBeUndefined();
      expect(current.PORT).toBe('5001');
      expect(current.EMAIL_HOST).toBe('smtp.example.com');
      expect(current.EMAIL_PASSWORD).toBeUndefined();
      expect(current.ADMIN_DEFAULT_PASSWORD).toBeUndefined();
      expect(current.S3_ENDPOINT).toBe('');
      expect(current.WEBDAV_URL).toBe('');
    });
  });

  describe('postgresql backend (presence-based)', () => {
    it('lists missing WEA_DB_* identity keys when only some WEA_DB_* are set', () => {
      const env = {
        WEA_DB_HOST: 'db.example.com',
        WEA_DB_PORT: '5432',
        WEA_FILE_STORAGE: 's3',
        S3_BUCKET: 'my-bucket',
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
        AWS_SECRET_ACCESS_KEY: 'secret-value',
      };
      const status = computeSetupStatus(env);
      expect(status.setup_complete).toBe(false);
      expect(status.missing).toEqual(['WEA_DB_DATABASE', 'WEA_DB_USER', 'WEA_DB_PASSWORD']);
    });
  });

  describe('effectiveConfig view (env-first over DB)', () => {
    it('completes a config that raw env alone cannot (DB provides S3 keys)', () => {
      const env = {}; // no file/admin keys in env
      const effectiveConfig = {
        WEA_FILE_STORAGE: { value: 's3', source: 'default', tier: 'T1', secret: false },
        S3_BUCKET: { value: 'my-bucket', source: 'db', tier: 'T1', secret: false },
        AWS_REGION: { value: 'us-east-1', source: 'db', tier: 'T1', secret: false },
        AWS_ACCESS_KEY_ID: { value: 'AKIAEXAMPLE', source: 'db', tier: 'T1', secret: false },
        AWS_SECRET_ACCESS_KEY: { value: '****', source: 'db', tier: 'T1', secret: true },
      };
      const status = computeSetupStatus(env, { effectiveConfig });
      expect(status.setup_complete).toBe(true);
      expect(status.missing).toEqual([]);
    });

    it('respects the metadata backend from the effective view (partial WEA_DB_* yields missing identity keys)', () => {
      const env = {};
      const effectiveConfig = {
        WEA_DB_HOST: { value: 'db.example.com', source: 'env', tier: 'T0', secret: false },
        WEA_FILE_STORAGE: { value: 's3', source: 'default', tier: 'T1', secret: false },
        S3_BUCKET: { value: 'my-bucket', source: 'db', tier: 'T1', secret: false },
        AWS_REGION: { value: 'us-east-1', source: 'db', tier: 'T1', secret: false },
        AWS_ACCESS_KEY_ID: { value: 'AKIAEXAMPLE', source: 'db', tier: 'T1', secret: false },
        AWS_SECRET_ACCESS_KEY: { value: '****', source: 'db', tier: 'T1', secret: true },
      };
      const status = computeSetupStatus(env, { effectiveConfig });
      expect(status.setup_complete).toBe(false);
      expect(status.missing).toEqual(['WEA_DB_DATABASE', 'WEA_DB_USER', 'WEA_DB_PASSWORD']);
    });

    it('honors webdav backend and masked password presence from DB', () => {
      const env = {};
      const effectiveConfig = {
        WEA_FILE_STORAGE: { value: 'webdav', source: 'db', tier: 'T1', secret: false },
        WEBDAV_URL: { value: 'https://dav.example.com', source: 'db', tier: 'T1', secret: false },
        WEBDAV_USERNAME: { value: 'dav-user', source: 'db', tier: 'T1', secret: false },
        WEBDAV_PASSWORD: { value: '****', source: 'db', tier: 'T1', secret: true },
      };
      const status = computeSetupStatus(env, { effectiveConfig });
      expect(status.setup_complete).toBe(true);
      expect(status.missing).toEqual([]);
    });

    it('does not treat a masked effective JWT_SECRET as a completeness gap in production', () => {
      const env = { NODE_ENV: 'production' };
      const effectiveConfig = {
        NODE_ENV: { value: 'production', source: 'env', tier: 'T0', secret: false },
        WEA_FILE_STORAGE: { value: 's3', source: 'default', tier: 'T1', secret: false },
        S3_BUCKET: { value: 'my-bucket', source: 'db', tier: 'T1', secret: false },
        AWS_REGION: { value: 'us-east-1', source: 'db', tier: 'T1', secret: false },
        AWS_ACCESS_KEY_ID: { value: 'AKIAEXAMPLE', source: 'db', tier: 'T1', secret: false },
        AWS_SECRET_ACCESS_KEY: { value: '****', source: 'db', tier: 'T1', secret: true },
      };
      const status = computeSetupStatus(env, { effectiveConfig });
      expect(status.setup_complete).toBe(true);
      expect(status.missing).toEqual([]);
      expect(status.missing).not.toContain('JWT_SECRET');
    });

    it('keeps backward compatibility when no effectiveConfig is given', () => {
      const env = {
        S3_BUCKET: 'my-bucket',
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
        AWS_SECRET_ACCESS_KEY: 'secret-value',
      };
      const status = computeSetupStatus(env);
      expect(status.setup_complete).toBe(true);
      expect(status.missing).toEqual([]);
    });
  });
});
