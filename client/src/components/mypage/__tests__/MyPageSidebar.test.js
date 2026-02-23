/**
 * MyPageSidebar tests.
 * Verifies observable outcomes per spec: category list, mobile logo, admin visibility,
 * sharing visibility, category selection callback, selected highlight.
 * @see docs/spec/client/components/mypage/MyPageSidebar.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import MyPageSidebar from '../MyPageSidebar';

describe('MyPageSidebar', () => {
  const defaultProps = {
    selectedCategory: 'account',
    onSelectCategory: jest.fn(),
    user: { is_admin: false },
    isMobile: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders category list (Account, Preferences)', () => {
    renderWithProviders(
      <MyPageSidebar {...defaultProps} user={{ is_admin: false }} />
    );
    expect(screen.getByText(/account info/i)).toBeInTheDocument();
    expect(screen.getByText(/preferences/i)).toBeInTheDocument();
  });

  it('renders logo when isMobile is true', () => {
    renderWithProviders(<MyPageSidebar {...defaultProps} isMobile={true} />);
    const logo = screen.getByRole('img', { name: /webdav easyaccess/i });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('src', '/logo.png');
  });

  it('shows admin categories (User Management, System Settings) when user is admin', () => {
    renderWithProviders(
      <MyPageSidebar {...defaultProps} user={{ is_admin: true }} />
    );
    expect(screen.getByText(/users/i)).toBeInTheDocument();
    expect(screen.getByText(/system settings/i)).toBeInTheDocument();
  });

  it('hides admin categories when user is not admin', () => {
    renderWithProviders(
      <MyPageSidebar {...defaultProps} user={{ is_admin: false }} />
    );
    expect(screen.queryByText(/system settings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^users$/i)).not.toBeInTheDocument();
  });

  it('shows Sharing category when user is not admin', () => {
    renderWithProviders(
      <MyPageSidebar {...defaultProps} user={{ is_admin: false }} />
    );
    expect(screen.getByText(/share management/i)).toBeInTheDocument();
  });

  it('hides Sharing category when user is admin', () => {
    renderWithProviders(
      <MyPageSidebar {...defaultProps} user={{ is_admin: true }} />
    );
    expect(screen.queryByText(/share management/i)).not.toBeInTheDocument();
  });

  it('calls onSelectCategory with categoryId when category clicked', async () => {
    const onSelectCategory = jest.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <MyPageSidebar
        {...defaultProps}
        onSelectCategory={onSelectCategory}
        user={{ is_admin: false }}
      />
    );
    await user.click(screen.getByText(/preferences/i));
    expect(onSelectCategory).toHaveBeenCalledWith('preferences');
  });

  it('calls onSelectCategory with sharing when Sharing clicked', async () => {
    const onSelectCategory = jest.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <MyPageSidebar
        {...defaultProps}
        onSelectCategory={onSelectCategory}
        user={{ is_admin: false }}
      />
    );
    await user.click(screen.getByText(/share management/i));
    expect(onSelectCategory).toHaveBeenCalledWith('sharing');
  });

  it('highlights selected category', () => {
    renderWithProviders(
      <MyPageSidebar {...defaultProps} selectedCategory="account" />
    );
    const accountButton = screen.getByRole('button', {
      name: /account info/i,
    });
    expect(accountButton).toHaveClass('Mui-selected');
  });
});
