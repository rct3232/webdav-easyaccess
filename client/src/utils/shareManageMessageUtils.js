import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

import { getServerErrorDisplay } from './errorUtils';

export const HIDDEN_SHARE_MANAGE_MESSAGE = {
  show: false,
  text: '',
  type: 'success',
};

export function getShareManageHideDuration(type) {
  return type === 'error' ? 5000 : 3000;
}

function getPermissionLabel(permission, t) {
  return permission === PERMISSIONS.READ ? t('mypage.read') : t('mypage.write');
}

export function buildShareManageSuccessMessage({
  kind,
  permission,
  displayName,
  isDirectory,
  t,
} = {}) {
  switch (kind) {
    case 'requestSent':
      return {
        show: true,
        text: t('sharedManage.requestSentSuccess', {
          permission: getPermissionLabel(permission, t),
        }),
        type: 'success',
      };
    case 'requestCancelled':
      return {
        show: true,
        text: t('sharedManage.requestCancelledSuccess', {
          permission: getPermissionLabel(permission, t),
        }),
        type: 'success',
      };
    case 'revoke':
      return {
        show: true,
        text: isDirectory
          ? t('sharedManage.revokeFolderSuccess', { name: displayName })
          : t('sharedManage.revokeFileSuccess', { name: displayName }),
        type: 'success',
      };
    default:
      return HIDDEN_SHARE_MANAGE_MESSAGE;
  }
}

export function buildShareManageErrorMessage({ error, fallbackKey, t } = {}) {
  return {
    show: true,
    text: getServerErrorDisplay(error?.response?.data, t) || t(fallbackKey),
    type: 'error',
  };
}
