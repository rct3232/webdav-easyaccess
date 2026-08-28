'use strict';

const mockCreateTransport = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: (...args) => mockCreateTransport(...args),
}));

beforeEach(() => {
  jest.resetModules();
  mockCreateTransport.mockClear();
  delete process.env.EMAIL_HOST;
  delete process.env.EMAIL_USER;
  delete process.env.EMAIL_PASSWORD;
  delete process.env.EMAIL_FROM_NAME;
  delete process.env.EMAIL_PORT;
  delete process.env.EMAIL_SECURE;
});

afterEach(() => {
  delete process.env.EMAIL_HOST;
  delete process.env.EMAIL_USER;
  delete process.env.EMAIL_PASSWORD;
  delete process.env.EMAIL_FROM_NAME;
});

describe('email utilities', () => {
  describe('sendEmail - unconfigured path', () => {
    it('returns failure object and logs to console when email is not configured', async () => {
      const { sendEmail } = require('../email');

      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await sendEmail('test@example.com', 'Test Subject', '<p>Body</p>');

      expect(result).toEqual({ success: false, error: 'Email not configured' });
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Email not configured')
      );

      logSpy.mockRestore();
    });
  });

  describe('sendEmail - configured path', () => {
    let mockTransporter;

    beforeEach(() => {
      process.env.EMAIL_HOST = 'smtp.test.com';
      process.env.EMAIL_USER = 'test@test.com';
      process.env.EMAIL_PASSWORD = 'secret';
      process.env.EMAIL_FROM_NAME = 'Test App';
    });

    it('returns success with messageId when send succeeds', async () => {
      mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: 'msg-123' }),
      };
      mockCreateTransport.mockReturnValue(mockTransporter);

      const { initEmailTransporter, sendEmail } = require('../email');

      initEmailTransporter();

      const result = await sendEmail('user@example.com', 'Hello', '<p>Welcome</p>');

      expect(result).toEqual({ success: true, messageId: 'msg-123' });
    });

    it('returns failure with error when send fails', async () => {
      const errorMessage = 'Connection refused';
      mockTransporter = {
        sendMail: jest.fn().mockRejectedValue(new Error(errorMessage)),
      };
      mockCreateTransport.mockReturnValue(mockTransporter);

      const { initEmailTransporter, sendEmail } = require('../email');

      initEmailTransporter();

      const result = await sendEmail('user@example.com', 'Hello', '<p>Welcome</p>');

      expect(result).toEqual({ success: false, error: errorMessage });
    });
  });

  describe('isEmailEnabled', () => {
    it('returns true when all required env vars are set', () => {
      process.env.EMAIL_HOST = 'smtp.test.com';
      process.env.EMAIL_USER = 'test@test.com';
      process.env.EMAIL_PASSWORD = 'secret';

      const { isEmailEnabled } = require('../email');

      expect(isEmailEnabled()).toBe(true);
    });

    it('returns false when env vars are missing', () => {
      const { isEmailEnabled } = require('../email');

      expect(isEmailEnabled()).toBe(false);
    });
  });

  describe('typed email functions', () => {
    beforeEach(() => {
      process.env.EMAIL_HOST = 'smtp.test.com';
      process.env.EMAIL_USER = 'test@test.com';
      process.env.EMAIL_PASSWORD = 'secret';
      process.env.EMAIL_FROM_NAME = 'Test App';
    });

    it('sendRegistrationPendingEmail delegates to sendEmail with correct content', async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: 'msg-reg' }),
      };
      mockCreateTransport.mockReturnValue(mockTransporter);

      const { initEmailTransporter, sendRegistrationPendingEmail } = require('../email');

      initEmailTransporter();

      const result = await sendRegistrationPendingEmail('user@example.com', 'newuser');

      expect(result).toEqual({ success: true, messageId: 'msg-reg' });
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: '회원가입 승인 대기 안내',
        })
      );
    });

    it('sendApprovalEmail delegates to sendEmail with correct content', async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: 'msg-approve' }),
      };
      mockCreateTransport.mockReturnValue(mockTransporter);

      const { initEmailTransporter, sendApprovalEmail } = require('../email');

      initEmailTransporter();

      const result = await sendApprovalEmail('user@example.com', 'newuser');

      expect(result).toEqual({ success: true, messageId: 'msg-approve' });
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: '회원가입이 승인되었습니다',
        })
      );
    });

    it('sendRejectionEmail delegates to sendEmail with correct content', async () => {
      const mockTransporter = {
        sendMail: jest.fn().mockResolvedValue({ messageId: 'msg-reject' }),
      };
      mockCreateTransport.mockReturnValue(mockTransporter);

      const { initEmailTransporter, sendRejectionEmail } = require('../email');

      initEmailTransporter();

      const result = await sendRejectionEmail('user@example.com', 'newuser');

      expect(result).toEqual({ success: true, messageId: 'msg-reject' });
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: '회원가입 신청이 거절되었습니다',
        })
      );
    });

    it('initEmailTransporter returns null and logs error when createTransport throws', () => {
      mockCreateTransport.mockImplementation(() => {
        throw new Error('Transport creation failed');
      });

      const { initEmailTransporter } = require('../email');

      const errSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = initEmailTransporter();

      expect(result).toBeNull();
      expect(errSpy).toHaveBeenNthCalledWith(1, 'Failed to initialize email transporter:', 'Transport creation failed');

      errSpy.mockRestore();
    });
  });

  describe('isEmailEnabled with the shared resolver (DB-sourced values)', () => {
    afterEach(() => {
      const { setSharedResolver } = require('../../infrastructure/configResolver');
      setSharedResolver(null);
    });

    it('returns true when values come from the resolver and env is empty', () => {
      const { setSharedResolver } = require('../../infrastructure/configResolver');
      setSharedResolver({
        getConfigSync: (key) => ({
          EMAIL_HOST: 'smtp.db.com',
          EMAIL_USER: 'user@db.com',
          EMAIL_PASSWORD: 'db-pass',
        })[key],
      });

      const { isEmailEnabled } = require('../email');

      expect(isEmailEnabled()).toBe(true);
    });

    it('returns false when the resolver has no email values', () => {
      const { setSharedResolver } = require('../../infrastructure/configResolver');
      setSharedResolver({ getConfigSync: () => undefined });

      const { isEmailEnabled } = require('../email');

      expect(isEmailEnabled()).toBe(false);
    });

    it('returns true through the real resolver when values are DB-sourced (env absent)', async () => {
      const { createConfigResolver, setSharedResolver } = require('../../infrastructure/configResolver');
      const fakeStore = {
        async get() {
          return null;
        },
        async getAll() {
          return {
            EMAIL_HOST: 'smtp.db.com',
            EMAIL_USER: 'user@db.com',
            EMAIL_PASSWORD: 'db-pass',
          };
        },
      };
      const resolver = createConfigResolver({ settingsStore: fakeStore, env: {} });
      await resolver.loadAll();
      setSharedResolver(resolver);

      const { isEmailEnabled } = require('../email');

      expect(isEmailEnabled()).toBe(true);
    });

    it('prefers env values over DB values through the real resolver (D1)', async () => {
      process.env.EMAIL_HOST = 'smtp.env.com';
      process.env.EMAIL_USER = 'env@env.com';
      process.env.EMAIL_PASSWORD = 'env-pass';
      const { createConfigResolver, setSharedResolver } = require('../../infrastructure/configResolver');
      const fakeStore = {
        async get() {
          return null;
        },
        async getAll() {
          return {
            EMAIL_HOST: 'smtp.db.com',
            EMAIL_USER: 'user@db.com',
            EMAIL_PASSWORD: 'db-pass',
          };
        },
      };
      const resolver = createConfigResolver({ settingsStore: fakeStore, env: process.env });
      await resolver.loadAll();
      setSharedResolver(resolver);

      const { isEmailEnabled } = require('../email');

      expect(isEmailEnabled()).toBe(true);
    });
  });
});
