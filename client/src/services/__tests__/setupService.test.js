import { http, HttpResponse } from 'msw';
import { server } from '../../setupTests';

import { applySetup, getSetupStatus, testSetup } from '../setupService';

describe('setupService', () => {
  describe('getSetupStatus', () => {
    it('returns { setup_complete, missing, current } from GET /api/setup/status', async () => {
      const result = await getSetupStatus();

      expect(result).toEqual(
        expect.objectContaining({
          setup_complete: false,
          missing: expect.arrayContaining([
            'S3_BUCKET',
            'AWS_REGION',
            'AWS_ACCESS_KEY_ID',
            'AWS_SECRET_ACCESS_KEY',
          ]),
          current: expect.objectContaining({
            WEA_STORAGE_BACKEND: 'sqlite',
            WEA_FILE_STORAGE: 's3',
            PORT: '5001',
            JWT_SECRET: '',
            WEBDAV_URL: '',
            EMAIL_HOST: '',
          }),
        })
      );
    });
  });

  describe('testSetup', () => {
    it('resolves { ok: true } for a valid target with payload spread after target', async () => {
      const result = await testSetup('postgresql', {
        host: 'localhost',
        port: '5432',
        database: 'webdav',
        user: 'admin',
        password: 'secret',
      });

      expect(result).toEqual({ ok: true });
    });

    it('surfaces errorCode + message when the server rejects', async () => {
      server.use(
        http.post('/api/setup/test', () =>
          HttpResponse.json(
            {
              ok: false,
              errorCode: 'serverErrors.setup.complete',
              message: 'Setup already complete',
            },
            { status: 403 }
          )
        )
      );

      try {
        await testSetup('s3', { bucket: 'bucket' });
        throw new Error('Expected reject');
      } catch (err) {
        expect(err).toMatchObject({
          errorCode: 'serverErrors.setup.complete',
          message: 'Setup already complete',
        });
      }
    });

    it('normalizes reason from the failure response', async () => {
      server.use(
        http.post('/api/setup/test', () =>
          HttpResponse.json(
            {
              ok: false,
              errorCode: 'serverErrors.setup.test.pg.unreachable',
              message: 'Cannot reach the PostgreSQL server',
              reason: 'ECONNREFUSED 127.0.0.1:5432',
            },
            { status: 400 }
          )
        )
      );

      try {
        await testSetup('postgresql', { host: 'localhost' });
        throw new Error('Expected reject');
      } catch (err) {
        expect(err).toMatchObject({
          errorCode: 'serverErrors.setup.test.pg.unreachable',
          message: 'Cannot reach the PostgreSQL server',
          reason: 'ECONNREFUSED 127.0.0.1:5432',
        });
      }
    });
  });

  describe('applySetup', () => {
    it('resolves { restart_required: true } from POST /api/setup/apply', async () => {
      const result = await applySetup({
        file: {
          backend: 'webdav',
          url: 'https://example.com/webdav',
          username: 'admin',
          password: 'secret',
        },
        admin: { password: 'admin123' },
        jwt: { secret: 'x'.repeat(40), expiresIn: '30m' },
        server: { port: '5001', corsOrigins: '' },
        email: { host: '', port: '587', user: '', password: '', secure: false, fromName: '' },
      });

      expect(result).toEqual({ restart_required: true });
    });
  });
});
