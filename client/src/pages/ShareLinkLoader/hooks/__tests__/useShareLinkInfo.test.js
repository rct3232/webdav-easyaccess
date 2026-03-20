import { renderHook, waitFor } from '@testing-library/react';

import { useTranslation } from 'react-i18next';

import { getPublicShareLinkInfo } from '../../../../services/shareLinkService';
import { getServerErrorDisplay } from '../../../../utils/errorUtils';
import { useShareLinkInfo } from '../useShareLinkInfo';

jest.mock('react-i18next', () => ({
  useTranslation: jest.fn(),
}));

jest.mock('../../../../services/shareLinkService', () => ({
  getPublicShareLinkInfo: jest.fn(),
}));

jest.mock('../../../../utils/errorUtils', () => ({
  getServerErrorDisplay: jest.fn(),
}));

describe('useShareLinkInfo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useTranslation.mockReturnValue({ t: (key) => key });
  });

  it('loads directory link info successfully', async () => {
    getPublicShareLinkInfo.mockResolvedValue({
      fileName: 'shared-folder',
      isDirectory: true,
    });

    const { result } = renderHook(() => useShareLinkInfo('folder-token'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.linkInfo).toEqual({
      fileName: 'shared-folder',
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
