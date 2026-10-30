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
        'collections',
        'storage',
        'preferences',
      ]);
    });
  });

  // PIVOT (PLAN §14 client half): the owner-approved operator rule supersedes
  // the T0.10 "visibility all" contract — admin is a pure operator and never
  // a collections/dashboard participant.
  it('hides the storage entry for admins (operator rule — nonAdminOnly)', async () => {
    useAuth.mockReturnValue({ user: { is_admin: true } });
    useLocation.mockReturnValue({ state: { category: 'account' } });

    const { result } = renderHook(() => useMyPageController({ isMobile: false }));

    await waitFor(() => {
      expect(result.current.sidebarItems.map((item) => item.id)).not.toContain('storage');
    });
    expect(result.current.sidebarItems.map((item) => item.id)).not.toContain('collections');
    expect(result.current.sidebarItems.map((item) => item.id)).toEqual([
      'account',
      'admin-users',
      'admin-settings',
      'admin-ai',
      'preferences',
    ]);
  });

  it('accepts the admin-ai deep-link for admins and rewrites it for non-admins', async () => {
    useAuth.mockReturnValue({ user: { is_admin: true } });
    useLocation.mockReturnValue({ state: { category: 'admin-ai' } });
    const admin = renderHook(() => useMyPageController({ isMobile: false }));
    await waitFor(() => expect(admin.result.current.selectedCategory).toBe('admin-ai'));

    useAuth.mockReturnValue({ user: { is_admin: false } });
    useLocation.mockReturnValue({ state: { category: 'admin-ai' } });
    const user = renderHook(() => useMyPageController({ isMobile: false }));
    await waitFor(() => expect(user.result.current.selectedCategory).toBe('account'));
  });

  it('rewrites the storage deep-link to the default section for admins (operator rule)', async () => {
    useAuth.mockReturnValue({ user: { is_admin: true } });
    useLocation.mockReturnValue({ state: { category: 'storage' } });

    const { result } = renderHook(() => useMyPageController({ isMobile: false }));

    await waitFor(() => {
      expect(result.current.selectedCategory).toBe('account');
    });
  });

  it('rewrites the collections deep-link to the default section for admins (operator rule)', async () => {
    useAuth.mockReturnValue({ user: { is_admin: true } });
    useLocation.mockReturnValue({ state: { category: 'collections' } });

    const { result } = renderHook(() => useMyPageController({ isMobile: false }));

    await waitFor(() => {
      expect(result.current.selectedCategory).toBe('account');
    });
  });

  it('accepts the collections deep-link category id for non-admins without rewriting it', async () => {
    useAuth.mockReturnValue({ user: { is_admin: false } });
    useLocation.mockReturnValue({ state: { category: 'collections' } });

    const { result } = renderHook(() => useMyPageController({ isMobile: false }));

    await waitFor(() => {
      expect(result.current.selectedCategory).toBe('collections');
    });
  });

  it('accepts the storage deep-link category id for non-admins without rewriting it (T0.10)', async () => {
    useAuth.mockReturnValue({ user: { is_admin: false } });
    useLocation.mockReturnValue({ state: { category: 'storage' } });

    const { result } = renderHook(() => useMyPageController({ isMobile: false }));

    await waitFor(() => {
      expect(result.current.selectedCategory).toBe('storage');
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
