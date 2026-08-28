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
        WEA_STORAGE_BACKEND: 'postgresql',
        WEA_PG_HOST: 'db.example.com',
        WEA_PG_PORT: '5432',
        WEA_PG_DATABASE: 'webdav',
        WEA_PG_USER: 'admin',
        WEA_PG_PASSWORD: 'pg-pass',
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

  describe('jwt in production', () => {
    it('is incomplete when JWT_SECRET equals the default', () => {
      const env = {
        NODE_ENV: 'production',
        JWT_SECRET: 'your-secret-key-change-in-production',
        S3_BUCKET: 'my-bucket',
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
        AWS_SECRET_ACCESS_KEY: 'secret-value',
      };
      const status = computeSetupStatus(env);
      expect(status.setup_complete).toBe(false);
      expect(status.missing).toContain('JWT_SECRET');
    });

    it('is complete with a non-default JWT_SECRET', () => {
      const env = {
        NODE_ENV: 'production',
        JWT_SECRET: 'a-real-secret',
        S3_BUCKET: 'my-bucket',
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
        AWS_SECRET_ACCESS_KEY: 'secret-value',
      };
      const status = computeSetupStatus(env);
      expect(status.setup_complete).toBe(true);
      expect(status.missing).toEqual([]);
    });

    it('does not require JWT_SECRET outside production', () => {
      const env = {
        NODE_ENV: 'development',
        JWT_SECRET: 'your-secret-key-change-in-production',
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

  describe('current prefill values', () => {
    it('masks secrets, hides unset secrets, and reflects non-secrets', () => {
      const env = {
        WEA_STORAGE_BACKEND: 'postgresql',
        PORT: '5001',
        JWT_SECRET: 'top-secret',
        WEA_PG_HOST: 'db.example.com',
        WEA_PG_PASSWORD: 'pg-pass',
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
        WEBDAV_PASSWORD: 'dav-pass',
        EMAIL_HOST: 'smtp.example.com',
      };
      const { current } = computeSetupStatus(env);
      expect(current.JWT_SECRET).toBe('****');
      expect(current.WEA_PG_PASSWORD).toBe('****');
      expect(current.AWS_SECRET_ACCESS_KEY).toBe('****');
      expect(current.WEBDAV_PASSWORD).toBe('****');
      expect(current.WEA_STORAGE_BACKEND).toBe('postgresql');
      expect(current.PORT).toBe('5001');
      expect(current.WEA_PG_HOST).toBe('db.example.com');
      expect(current.EMAIL_HOST).toBe('smtp.example.com');
      expect(current.EMAIL_PASSWORD).toBeUndefined();
      expect(current.ADMIN_DEFAULT_PASSWORD).toBeUndefined();
      expect(current.S3_ENDPOINT).toBe('');
      expect(current.WEBDAV_URL).toBe('');
    });
  });

  describe('postgresql backend', () => {
    it('lists missing WEA_PG_* keys when backend is postgresql', () => {
      const env = {
        WEA_STORAGE_BACKEND: 'postgresql',
        WEA_PG_HOST: 'db.example.com',
        WEA_FILE_STORAGE: 's3',
        S3_BUCKET: 'my-bucket',
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
        AWS_SECRET_ACCESS_KEY: 'secret-value',
      };
      const status = computeSetupStatus(env);
      expect(status.setup_complete).toBe(false);
      expect(status.missing).toEqual(['WEA_PG_PORT', 'WEA_PG_DATABASE', 'WEA_PG_USER', 'WEA_PG_PASSWORD']);
    });
  });

  describe('effectiveConfig view (env-first over DB)', () => {
    it('completes a config that raw env alone cannot (DB provides S3 keys)', () => {
      const env = {}; // no file/admin keys in env
      const effectiveConfig = {
        WEA_STORAGE_BACKEND: { value: 'sqlite', source: 'default', tier: 'T0', secret: false },
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

    it('respects metadata backend from effective view (postgresql requires WEA_PG_*)', () => {
      const env = {};
      const effectiveConfig = {
        WEA_STORAGE_BACKEND: { value: 'postgresql', source: 'env', tier: 'T0', secret: false },
        WEA_PG_HOST: { value: 'db.example.com', source: 'env', tier: 'T0', secret: false },
        WEA_FILE_STORAGE: { value: 's3', source: 'default', tier: 'T1', secret: false },
        S3_BUCKET: { value: 'my-bucket', source: 'db', tier: 'T1', secret: false },
        AWS_REGION: { value: 'us-east-1', source: 'db', tier: 'T1', secret: false },
        AWS_ACCESS_KEY_ID: { value: 'AKIAEXAMPLE', source: 'db', tier: 'T1', secret: false },
        AWS_SECRET_ACCESS_KEY: { value: '****', source: 'db', tier: 'T1', secret: true },
      };
      const status = computeSetupStatus(env, { effectiveConfig });
      expect(status.setup_complete).toBe(false);
      expect(status.missing).toEqual([
        'WEA_PG_PORT',
        'WEA_PG_DATABASE',
        'WEA_PG_USER',
        'WEA_PG_PASSWORD',
      ]);
    });

    it('honors webdav backend and masked password presence from DB', () => {
      const env = {};
      const effectiveConfig = {
        WEA_STORAGE_BACKEND: { value: 'sqlite', source: 'default', tier: 'T0', secret: false },
        WEA_FILE_STORAGE: { value: 'webdav', source: 'db', tier: 'T1', secret: false },
        WEBDAV_URL: { value: 'https://dav.example.com', source: 'db', tier: 'T1', secret: false },
        WEBDAV_USERNAME: { value: 'dav-user', source: 'db', tier: 'T1', secret: false },
        WEBDAV_PASSWORD: { value: '****', source: 'db', tier: 'T1', secret: true },
      };
      const status = computeSetupStatus(env, { effectiveConfig });
      expect(status.setup_complete).toBe(true);
      expect(status.missing).toEqual([]);
    });

    it('still requires JWT_SECRET in production when effective value is masked', () => {
      const env = { NODE_ENV: 'production' };
      const effectiveConfig = {
        NODE_ENV: { value: 'production', source: 'env', tier: 'T0', secret: false },
        WEA_STORAGE_BACKEND: { value: 'sqlite', source: 'default', tier: 'T0', secret: false },
        WEA_FILE_STORAGE: { value: 's3', source: 'default', tier: 'T1', secret: false },
        S3_BUCKET: { value: 'my-bucket', source: 'db', tier: 'T1', secret: false },
        AWS_REGION: { value: 'us-east-1', source: 'db', tier: 'T1', secret: false },
        AWS_ACCESS_KEY_ID: { value: 'AKIAEXAMPLE', source: 'db', tier: 'T1', secret: false },
        AWS_SECRET_ACCESS_KEY: { value: '****', source: 'db', tier: 'T1', secret: true },
      };
      const status = computeSetupStatus(env, { effectiveConfig });
      expect(status.setup_complete).toBe(false);
      expect(status.missing).toContain('JWT_SECRET');
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
