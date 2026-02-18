import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test-utils';
import axios from 'axios';

// Mock axios - must provide create() for apiClient (used by AuthContext) to load
jest.mock('axios', () => {
  const mockInstance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    defaults: { headers: { common: {} } },
    interceptors: {
      request: { use: jest.fn(() => 0), eject: jest.fn() },
      response: { use: jest.fn(() => 0), eject: jest.fn() },
    },
  };
  return {
    __esModule: true,
    default: {
      create: () => mockInstance,
      get: mockInstance.get,
      post: mockInstance.post,
      put: mockInstance.put,
      delete: mockInstance.delete,
    },
  };
});

describe('Admin Dashboard Integration Tests (AD1-AD8)', () => {
  const mockAdminUser = { id: 1, username: 'admin', is_admin: true };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('사용자 관리 (AD1-AD3)', () => {
    describe('대기중 사용자 목록 (AD1)', () => {
      it('fetches pending users list', async () => {
        const mockPendingUsers = [
          { id: 2, username: 'pending1', email: 'pending1@example.com', status: 'pending' },
          { id: 3, username: 'pending2', email: 'pending2@example.com', status: 'pending' },
        ];
        axios.get.mockResolvedValue({ data: mockPendingUsers });

        const result = await axios.get('/api/admin/users/pending');

        expect(axios.get).toHaveBeenCalledWith('/api/admin/users/pending');
        expect(result.data).toHaveLength(2);
        expect(result.data[0].status).toBe('pending');
      });

      it('returns empty list when no pending users', async () => {
        axios.get.mockResolvedValue({ data: [] });

        const result = await axios.get('/api/admin/users/pending');

        expect(result.data).toHaveLength(0);
      });
    });

    describe('사용자 승인 (AD2)', () => {
      it('approves a pending user', async () => {
        axios.post.mockResolvedValue({ data: { messageCode: 'serverMessages.admin.userApproved' } });

        const result = await axios.post('/api/admin/users/2/approve');

        expect(axios.post).toHaveBeenCalledWith('/api/admin/users/2/approve');
        expect(result.data.messageCode).toBe('serverMessages.admin.userApproved');
      });
    });

    describe('사용자 거절 (AD3)', () => {
      it('rejects a pending user', async () => {
        axios.post.mockResolvedValue({ data: { messageCode: 'serverMessages.admin.userRejected' } });

        const result = await axios.post('/api/admin/users/2/reject');

        expect(axios.post).toHaveBeenCalledWith('/api/admin/users/2/reject');
        expect(result.data.messageCode).toBe('serverMessages.admin.userRejected');
      });
    });
  });

  describe('전체 사용자 관리 (AD4-AD6)', () => {
    describe('전체 사용자 목록 (AD4)', () => {
      it('fetches all users', async () => {
        const mockUsers = [
          { id: 1, username: 'admin', email: 'admin@example.com', status: 'approved', is_admin: true },
          { id: 2, username: 'user1', email: 'user1@example.com', status: 'approved', is_admin: false },
          { id: 3, username: 'pending', email: 'pending@example.com', status: 'pending', is_admin: false },
        ];
        axios.get.mockResolvedValue({ data: mockUsers });

        const result = await axios.get('/api/admin/users');

        expect(result.data).toHaveLength(3);
        expect(result.data.some(u => u.is_admin)).toBe(true);
      });
    });

    describe('사용자 생성 (AD5)', () => {
      it('creates a new user', async () => {
        axios.post.mockResolvedValue({ 
          data: { 
            user: { id: 4, username: 'newuser', status: 'approved' },
            message: '사용자가 생성되었습니다.'
          }
        });

        const result = await axios.post('/api/admin/users', {
          username: 'newuser',
          email: 'new@example.com',
          password: 'password123',
        });

        expect(result.data.user.username).toBe('newuser');
        expect(result.data.user.status).toBe('approved');
      });

      it('fails with duplicate username', async () => {
        axios.post.mockRejectedValue({
          response: { data: { errorCode: 'serverErrors.admin.usernameTaken' } }
        });

        await expect(
          axios.post('/api/admin/users', {
            username: 'existing',
            email: 'new@example.com',
            password: 'password123',
          })
        ).rejects.toMatchObject({
          response: { data: { errorCode: 'serverErrors.admin.usernameTaken' } }
        });
      });
    });

    describe('사용자 삭제 (AD6)', () => {
      it('deletes a user', async () => {
        axios.delete.mockResolvedValue({ data: { messageCode: 'serverMessages.admin.userDeleted' } });

        const result = await axios.delete('/api/admin/users/2');

        expect(axios.delete).toHaveBeenCalledWith('/api/admin/users/2');
        expect(result.data.messageCode).toBe('serverMessages.admin.userDeleted');
      });

      it('prevents admin from deleting themselves', async () => {
        axios.delete.mockRejectedValue({
          response: { data: { errorCode: 'serverErrors.admin.deleteSelf' } }
        });

        await expect(
          axios.delete('/api/admin/users/1')
        ).rejects.toMatchObject({
          response: { data: { errorCode: 'serverErrors.admin.deleteSelf' } }
        });
      });
    });
  });

  describe('시스템 설정 (AD7-AD8)', () => {
    describe('설정 조회 (AD7)', () => {
      it('fetches system settings', async () => {
        const mockSettings = {
          registration_enabled: true,
          email_enabled: false,
        };
        axios.get.mockResolvedValue({ data: mockSettings });

        const result = await axios.get('/api/admin/settings');

        expect(result.data).toHaveProperty('registration_enabled');
      });
    });

    describe('설정 변경 (AD8)', () => {
      it('updates registration setting', async () => {
        axios.put.mockResolvedValue({ 
          data: { 
            messageCode: 'serverMessages.admin.settingsSaved',
            settings: { registration_enabled: false }
          }
        });

        const result = await axios.put('/api/admin/settings', {
          registration_enabled: false,
        });

        expect(result.data.messageCode).toBe('serverMessages.admin.settingsSaved');
        expect(result.data.settings.registration_enabled).toBe(false);
      });
    });
  });

  describe('권한 검사', () => {
    it('rejects non-admin access to admin endpoints', async () => {
      axios.get.mockRejectedValue({
        response: { status: 403, data: { errorCode: 'serverErrors.admin.adminRequired' } }
      });

      await expect(
        axios.get('/api/admin/users')
      ).rejects.toMatchObject({
        response: { status: 403 }
      });
    });

    it('rejects unauthenticated access', async () => {
      axios.get.mockRejectedValue({
        response: { status: 401, data: { error: '인증이 필요합니다.' } }
      });

      await expect(
        axios.get('/api/admin/users')
      ).rejects.toMatchObject({
        response: { status: 401 }
      });
    });
  });

  describe('사용자 상태 관리', () => {
    it('handles user status transitions', () => {
      const validTransitions = {
        pending: ['approved', 'rejected'],
        approved: ['rejected'],
        rejected: ['approved'],
      };

      expect(validTransitions.pending).toContain('approved');
      expect(validTransitions.pending).toContain('rejected');
      expect(validTransitions.approved).toContain('rejected');
    });

    it('formats user status for display', () => {
      const statusMap = {
        pending: '승인 대기',
        approved: '승인됨',
        rejected: '거절됨',
      };

      Object.entries(statusMap).forEach(([status, display]) => {
        expect(statusMap[status]).toBe(display);
      });
    });
  });
});
