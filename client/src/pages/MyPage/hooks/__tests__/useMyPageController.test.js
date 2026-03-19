import { act, renderHook, waitFor } from '@testing-library/react';

import { useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../../../../contexts/AuthContext';
import { useMyPageController } from '../useMyPageController';

jest.mock('../../../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('react-router-dom', () => ({
  useLocation: jest.fn(),
  useNavigate: jest.fn(),
}));

describe('useMyPageController', () => {
  const navigateMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useNavigate.mockReturnValue(navigateMock);
  });

  it('initializes category from legacy admin mapping for admins', async () => {
    useAuth.mockReturnValue({ user: { is_admin: true } });
    useLocation.mockReturnValue({ state: { category: 'admin' } });

    const { result } = renderHook(() => useMyPageController({ isMobile: false }));

    await waitFor(() => {
      expect(result.current.selectedCategory).toBe('admin-users');
    });
  });

  it('initializes category from legacy admin mapping for non-admins', async () => {
    useAuth.mockReturnValue({ user: { is_admin: false } });
    useLocation.mockReturnValue({ state: { category: 'admin' } });

    const { result } = renderHook(() => useMyPageController({ isMobile: false }));

    await waitFor(() => {
      expect(result.current.selectedCategory).toBe('account');
    });
  });

  it('prepares sidebar items for the current role', async () => {
    useAuth.mockReturnValue({ user: { is_admin: false } });
    useLocation.mockReturnValue({ state: { category: 'account' } });

    const { result } = renderHook(() => useMyPageController({ isMobile: false }));

    await waitFor(() => {
      expect(result.current.sidebarItems.map((item) => item.id)).toEqual([
        'account',
        'sharing',
        'preferences',
      ]);
    });
  });

  it('closes drawer and resets selectedContentItem when category is selected on mobile', async () => {
    useAuth.mockReturnValue({ user: { is_admin: false } });
    useLocation.mockReturnValue({ state: { category: 'sharing' } });

    const { result } = renderHook(() => useMyPageController({ isMobile: true }));

    act(() => {
      result.current.onOpenCategoryDrawer();
      result.current.onSelectContentItem('inbox');
    });

    expect(result.current.categoryDrawerOpen).toBe(true);
    expect(result.current.selectedContentItem).toBe('inbox');

    act(() => {
      result.current.onSelectCategory('preferences');
    });

    expect(result.current.selectedCategory).toBe('preferences');
    expect(result.current.selectedContentItem).toBeNull();
    expect(result.current.categoryDrawerOpen).toBe(false);
  });

  it('switches between list/detail based on onSelectContentItem', async () => {
    useAuth.mockReturnValue({ user: { is_admin: false } });
    useLocation.mockReturnValue({ state: { category: 'sharing' } });

    const { result } = renderHook(() => useMyPageController({ isMobile: false }));

    act(() => {
      result.current.onSelectContentItem('inbox');
    });

    await waitFor(() => {
      expect(result.current.selectedContentItem).toBe('inbox');
    });

    act(() => {
      result.current.onSelectContentItem(null);
    });

    await waitFor(() => {
      expect(result.current.selectedContentItem).toBeNull();
    });
  });

  it('navigates to / when onCloseMyPage is invoked', async () => {
    useAuth.mockReturnValue({ user: { is_admin: false } });
    useLocation.mockReturnValue({ state: { category: 'account' } });

    const { result } = renderHook(() => useMyPageController({ isMobile: false }));

    act(() => {
      result.current.onCloseMyPage();
    });

    expect(navigateMock).toHaveBeenCalledWith('/');
  });
});
