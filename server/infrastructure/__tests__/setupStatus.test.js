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
});
