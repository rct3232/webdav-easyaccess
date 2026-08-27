import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

import {
  buildShareManageErrorMessage,
  buildShareManageSuccessMessage,
  getShareManageHideDuration,
  HIDDEN_SHARE_MANAGE_MESSAGE,
} from '../shareManageMessageUtils';

import { getServerErrorDisplay } from '../errorUtils';

jest.mock('../errorUtils', () => ({
  getServerErrorDisplay: jest.fn(),
}));

describe('shareManageMessageUtils', () => {
  const t = (key, params) => {
    if (!params) {
      return key;
    }

    return `${key}:${JSON.stringify(params)}`;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds request success messages with the observable permission label', () => {
    const message = buildShareManageSuccessMessage({
      kind: 'requestSent',
      permission: PERMISSIONS.READ,
      t,
    });

    expect(message).toEqual({
      show: true,
      text: 'sharedManage.requestSentSuccess:{"permission":"mypage.read"}',
      type: 'success',
    });
  });

  it('prefers server error text and keeps error styling', () => {
    getServerErrorDisplay.mockReturnValue('server error');

    const message = buildShareManageErrorMessage({
      error: { response: { data: { errorCode: 'boom' } } },
      fallbackKey: 'sharedManage.requestSentFail',
      t,
    });

    expect(message).toEqual({
      show: true,
      text: 'server error',
      type: 'error',
    });
  });

  it('keeps success hides shorter than errors and preserves the hidden payload', () => {
    expect(getShareManageHideDuration('success')).toBe(3000);
    expect(getShareManageHideDuration('error')).toBe(5000);
    expect(HIDDEN_SHARE_MANAGE_MESSAGE).toEqual({
      show: false,
      text: '',
      type: 'success',
    });
  });
});
