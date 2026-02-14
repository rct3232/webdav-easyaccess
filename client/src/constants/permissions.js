/**
 * Permission-related constants for UI (labels, order).
 * PERMISSIONS enum is re-exported from shared for convenience.
 */
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';

export { PERMISSIONS };

export const PERMISSION_LABELS = {
  [PERMISSIONS.ADMIN]: '소유자',
  [PERMISSIONS.WRITE]: '편집자',
  [PERMISSIONS.READ]: '열람자',
};

export const PERMISSION_ORDER = [PERMISSIONS.ADMIN, PERMISSIONS.WRITE, PERMISSIONS.READ];
