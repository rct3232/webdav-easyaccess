import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AccountEditDialog from '../AccountEditDialog';

describe('AccountEditDialog', () => {
  const defaultProps = {
    open: true,
    onClose: jest.fn(),
    email: 'test@example.com',
    onEmailChange: jest.fn(),
    password: '',
    onPasswordChange: jest.fn(),
    confirmPassword: '',
    onConfirmPasswordChange: jest.fn(),
    onSave: jest.fn(),
  };

  it('should render correctly with initial values', () => {
    render(<AccountEditDialog {...defaultProps} />);
    expect(screen.getByText('정보 변경')).toBeInTheDocument();
    expect(screen.getByLabelText('이메일')).toHaveValue('test@example.com');
  });

  it('should call onEmailChange when email input changes', () => {
    render(<AccountEditDialog {...defaultProps} />);
    const emailInput = screen.getByLabelText('이메일');
    fireEvent.change(emailInput, { target: { value: 'new@example.com' } });
    expect(defaultProps.onEmailChange).toHaveBeenCalledWith('new@example.com');
  });

  it('should show password mismatch error', () => {
    render(
      <AccountEditDialog 
        {...defaultProps} 
        password="password123" 
        confirmPassword="different" 
      />
    );
    expect(screen.getByText('비밀번호가 다릅니다.')).toBeInTheDocument();
  });

  it('should disable save button when canSave is false', () => {
    render(<AccountEditDialog {...defaultProps} canSave={false} />);
    const saveButton = screen.getByText('저장');
    expect(saveButton).toBeDisabled();
  });

  it('should enable save button when canSave is true', () => {
    render(<AccountEditDialog {...defaultProps} canSave={true} />);
    const saveButton = screen.getByText('저장');
    expect(saveButton).not.toBeDisabled();
  });

  it('should show message when provided', () => {
    const message = { text: 'Success!', type: 'success' };
    render(<AccountEditDialog {...defaultProps} message={message} />);
    expect(screen.getByText('Success!')).toBeInTheDocument();
  });

  it('should call onSave when save button is clicked', () => {
    render(<AccountEditDialog {...defaultProps} canSave={true} />);
    const saveButton = screen.getByText('저장');
    fireEvent.click(saveButton);
    expect(defaultProps.onSave).toHaveBeenCalled();
  });
});
