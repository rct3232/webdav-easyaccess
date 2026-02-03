import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from '../../test-utils';
import Login from '../../pages/Login';
import axios from 'axios';

// Mock axios
jest.mock('axios');

// Create a mock navigate function
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}));

describe('Login Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock for settings
    axios.get.mockImplementation((url) => {
      if (url === '/api/settings/public') {
        return Promise.resolve({ data: { registration_enabled: true } });
      }
      return Promise.reject(new Error('Not found'));
    });
  });

  it('renders login page correctly', async () => {
    renderWithProviders(<Login />);
    
    expect(screen.getByLabelText(/사용자명/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/비밀번호/i)).toBeInTheDocument();
    
    // Wait for settings to load and show registration link
    await waitFor(() => {
      expect(screen.getByText(/회원가입/i)).toBeInTheDocument();
    });
  });

  it('handles successful login', async () => {
    const mockLogin = jest.fn().mockResolvedValue({ success: true });
    
    renderWithProviders(<Login />, {
      authContextValue: { login: mockLogin }
    });

    fireEvent.change(screen.getByLabelText(/사용자명/i), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText(/비밀번호/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('testuser', 'password123');
      expect(mockNavigate).toHaveBeenCalledWith('/files');
    });
  });

  it('handles login failure', async () => {
    const mockLogin = jest.fn().mockResolvedValue({ 
      success: false, 
      error: 'Invalid credentials' 
    });
    
    renderWithProviders(<Login />, {
      authContextValue: { login: mockLogin }
    });

    fireEvent.change(screen.getByLabelText(/사용자명/i), { target: { value: 'wronguser' } });
    fireEvent.change(screen.getByLabelText(/비밀번호/i), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
    });
  });

  it('handles pending account warning', async () => {
    const mockLogin = jest.fn().mockResolvedValue({ 
      success: false, 
      status: 'pending',
      message: 'Waiting for approval' 
    });
    
    renderWithProviders(<Login />, {
      authContextValue: { login: mockLogin }
    });

    fireEvent.change(screen.getByLabelText(/사용자명/i), { target: { value: 'pendinguser' } });
    fireEvent.change(screen.getByLabelText(/비밀번호/i), { target: { value: 'pass123' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => {
      expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveClass('MuiAlert-standardWarning');
  });

  it('hides registration link if disabled in settings', async () => {
    axios.get.mockImplementation((url) => {
      if (url === '/api/settings/public') {
        return Promise.resolve({ data: { registration_enabled: false } });
      }
      return Promise.reject(new Error('Not found'));
    });

    renderWithProviders(<Login />);

    await waitFor(() => {
      expect(screen.queryByText(/회원가입/i)).not.toBeInTheDocument();
    });
  });
});
