/**
 * Permission-related constants for UI (labels, order).
 * Use getPermissionLabels(t) for i18n.
 * PERMISSIONS enum: import from '@webdav-easyaccess/shared/constants'.
 */
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

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
