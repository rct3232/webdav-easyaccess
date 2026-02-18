/**
 * Permission-related constants for UI (labels, order).
 * PERMISSIONS enum is re-exported from shared for convenience.
 * Use getPermissionLabels(t) for i18n; PERMISSION_LABELS is deprecated.
 */
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

export { PERMISSIONS };

/** @deprecated Use getPermissionLabels(t) for translated labels */
export const PERMISSION_LABELS = {
  [PERMISSIONS.ADMIN]: '소유자',
  [PERMISSIONS.WRITE]: '편집자',
  [PERMISSIONS.READ]: '열람자',
};

/**
 * Returns permission labels using the given i18n t function.
 * @param {(key: string) => string} t - useTranslation().t
 * @returns {{ [key: string]: string }}
 */
export function getPermissionLabels(t) {
  return {
    [PERMISSIONS.ADMIN]: t('permissions.owner'),
    [PERMISSIONS.WRITE]: t('permissions.editor'),
    [PERMISSIONS.READ]: t('permissions.viewer'),
  };
}

export const PERMISSION_ORDER = [PERMISSIONS.ADMIN, PERMISSIONS.WRITE, PERMISSIONS.READ];
