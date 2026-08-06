import { renderHook, waitFor } from '@testing-library/react';

import { getPublicShareLinkInfo } from '../../../../services/shareLinkService';
import { getServerErrorDisplay } from '../../../../utils/errorUtils';
import { useShareLinkInfo } from '../useShareLinkInfo';

jest.mock('react-i18next', () => {
  const { createI18nModuleMock } = require('../../../../testing/mocks/i18nMock');
  return createI18nModuleMock();
});

jest.mock('../../../../services/shareLinkService', () => ({
  getPublicShareLinkInfo: jest.fn(),
}));

jest.mock('../../../../utils/errorUtils', () => {
  const { createErrorUtilsMock } = require('../../../../testing/mocks/serviceMocks');
  return createErrorUtilsMock({
    getServerErrorDisplay: jest.fn(),
  });
});

describe('useShareLinkInfo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.removeItem('token');
  });

  it('loads directory link info successfully (nodeId always present)', async () => {
    getPublicShareLinkInfo.mockResolvedValue({
      nodeId: 42,
      fileName: 'shared-folder',
      isDirectory: true,
      displayPath: '/shared/folder',
    });

    const { result } = renderHook(() => useShareLinkInfo('folder-token'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.linkInfo).toEqual({
      nodeId: 42,
      fileName: 'shared-folder',
      isDirectory: true,
      displayPath: '/shared/folder',
    });
  });

  it('passes through the server-provided nodeId for directory links', async () => {
    getPublicShareLinkInfo.mockResolvedValue({
      nodeId: 42,
      fileName: 'folder',
      isDirectory: true,
    });

    const { result } = renderHook(() => useShareLinkInfo('folder-token'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.linkInfo).toEqual({
      nodeId: 42,
      fileName: 'folder',
      isDirectory: true,
    });
  });

  it('returns an invalid-link error immediately when token is missing', async () => {
    const { result } = renderHook(() => useShareLinkInfo(''));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('shareLink.invalidLink');
    expect(getPublicShareLinkInfo).not.toHaveBeenCalled();
  });

  it('normalizes fetch errors into an error message', async () => {
    getServerErrorDisplay.mockReturnValue('Link expired');
    getPublicShareLinkInfo.mockRejectedValue({
      response: {
        data: { errorCode: 'serverErrors.share.shareLinkExpired' },
      },
    });

    const { result } = renderHook(() => useShareLinkInfo('expired-token'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.linkInfo).toBeNull();
    expect(result.current.error).toBe('Link expired');
  });
});
