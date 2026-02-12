import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test-utils';
import Register from '../../pages/Register';
import * as settingsService from '../../services/settingsService';

jest.mock('../../services/settingsService');

// Mock navigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}));

describe('Registration Integration Tests (A3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsService.getPublicSettings.mockResolvedValue({ email_enabled: false });
  });

  describe('회원가입 폼 렌더링', () => {
    it('renders registration form correctly', async () => {
      renderWithProviders(<Register />);

      // Wait for settings to load and form to be visible
      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: /사용자명/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('textbox', { name: /이메일/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /회원가입/i })).toBeInTheDocument();
    });

    it('shows login link', async () => {
      renderWithProviders(<Register />);
      await waitFor(() => {
        expect(screen.getByText(/로그인/i)).toBeInTheDocument();
      });
    });
  });

  describe('입력 검증', () => {
    it('validates password confirmation matches', async () => {
      const mockRegister = jest.fn();
      renderWithProviders(<Register />, {
        authContextValue: { register: mockRegister }
      });

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: /사용자명/i })).toBeInTheDocument();
      });
      fireEvent.change(screen.getByRole('textbox', { name: /사용자명/i }), { target: { value: 'testuser' } });
      fireEvent.change(screen.getByRole('textbox', { name: /이메일/i }), { target: { value: 'test@example.com' } });
      
      // Get password fields by placeholder or label - they may not be role textbox due to type="password"
      const passwordFields = screen.getAllByLabelText(/비밀번호/i);
      fireEvent.change(passwordFields[0], { target: { value: 'password123' } });
      fireEvent.change(passwordFields[1], { target: { value: 'differentpass' } });

      fireEvent.click(screen.getByRole('button', { name: /회원가입/i }));

      await waitFor(() => {
        expect(screen.getByText(/비밀번호가 일치하지 않습니다/i)).toBeInTheDocument();
      });
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('validates password minimum length', async () => {
      const mockRegister = jest.fn();
      renderWithProviders(<Register />, {
        authContextValue: { register: mockRegister }
      });

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: /사용자명/i })).toBeInTheDocument();
      });
      fireEvent.change(screen.getByRole('textbox', { name: /사용자명/i }), { target: { value: 'testuser' } });
      fireEvent.change(screen.getByRole('textbox', { name: /이메일/i }), { target: { value: 'test@example.com' } });
      
      const passwordFields = screen.getAllByLabelText(/비밀번호/i);
      fireEvent.change(passwordFields[0], { target: { value: '123' } }); // Too short
      fireEvent.change(passwordFields[1], { target: { value: '123' } });

      fireEvent.click(screen.getByRole('button', { name: /회원가입/i }));

      await waitFor(() => {
        expect(screen.getByText(/6자 이상/i)).toBeInTheDocument();
      });
      expect(mockRegister).not.toHaveBeenCalled();
    });
  });

  describe('회원가입 처리', () => {
    it('handles successful registration with immediate login', async () => {
      const mockRegister = jest.fn().mockResolvedValue({ 
        success: true, 
        status: 'approved',
        user: { id: 1, username: 'newuser' }
      });
      
      renderWithProviders(<Register />, {
        authContextValue: { register: mockRegister }
      });

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: /사용자명/i })).toBeInTheDocument();
      });
      fireEvent.change(screen.getByRole('textbox', { name: /사용자명/i }), { target: { value: 'newuser' } });
      fireEvent.change(screen.getByRole('textbox', { name: /이메일/i }), { target: { value: 'new@example.com' } });
      
      const passwordFields = screen.getAllByLabelText(/비밀번호/i);
      fireEvent.change(passwordFields[0], { target: { value: 'password123' } });
      fireEvent.change(passwordFields[1], { target: { value: 'password123' } });

      fireEvent.click(screen.getByRole('button', { name: /회원가입/i }));

      await waitFor(() => {
        expect(mockRegister).toHaveBeenCalledWith('newuser', 'new@example.com', 'password123');
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/files');
      });
    });

    it('handles successful registration with pending approval', async () => {
      const mockRegister = jest.fn().mockResolvedValue({ 
        success: true, 
        status: 'pending',
        message: '관리자 승인 대기 중입니다.'
      });
      
      renderWithProviders(<Register />, {
        authContextValue: { register: mockRegister }
      });

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: /사용자명/i })).toBeInTheDocument();
      });
      fireEvent.change(screen.getByRole('textbox', { name: /사용자명/i }), { target: { value: 'newuser' } });
      fireEvent.change(screen.getByRole('textbox', { name: /이메일/i }), { target: { value: 'new@example.com' } });
      
      const passwordFields = screen.getAllByLabelText(/비밀번호/i);
      fireEvent.change(passwordFields[0], { target: { value: 'password123' } });
      fireEvent.change(passwordFields[1], { target: { value: 'password123' } });

      fireEvent.click(screen.getByRole('button', { name: /회원가입/i }));

      await waitFor(() => {
        expect(mockRegister).toHaveBeenCalled();
      });

      // Should show success state (not navigate)
      await waitFor(() => {
        // When pending, the form should show success state
        expect(mockNavigate).not.toHaveBeenCalledWith('/files');
      });
    });

    it('handles registration failure with error message', async () => {
      const mockRegister = jest.fn().mockResolvedValue({ 
        success: false, 
        error: '이미 사용 중인 사용자명입니다.'
      });
      
      renderWithProviders(<Register />, {
        authContextValue: { register: mockRegister }
      });

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: /사용자명/i })).toBeInTheDocument();
      });
      fireEvent.change(screen.getByRole('textbox', { name: /사용자명/i }), { target: { value: 'existinguser' } });
      fireEvent.change(screen.getByRole('textbox', { name: /이메일/i }), { target: { value: 'new@example.com' } });
      
      const passwordFields = screen.getAllByLabelText(/비밀번호/i);
      fireEvent.change(passwordFields[0], { target: { value: 'password123' } });
      fireEvent.change(passwordFields[1], { target: { value: 'password123' } });

      fireEvent.click(screen.getByRole('button', { name: /회원가입/i }));

      await waitFor(() => {
        expect(screen.getByText(/이미 사용 중인 사용자명/i)).toBeInTheDocument();
      });
    });
  });
});
