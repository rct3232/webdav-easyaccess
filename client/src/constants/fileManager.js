import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  TEXT_EXTENSIONS,
} from '@webdav-easyaccess/shared/constants';

export const VIEW_MODES = {
  LIST: 'list',
  GRID: 'grid',
  DETAIL: 'detail',
};

export const SORT_MODES = {
  NAME_ASC: 'name_asc',
  NAME_DESC: 'name_desc',
  DATE_ASC: 'date_asc',
  DATE_DESC: 'date_desc',
};

// Scroll container padding: height of FloatingSearchBar + FAB bottom area (offset + 56px)
// Keep in sync with FloatingSearchBar MOBILE_OFFSET/DESKTOP_OFFSET + FAB_SIZE
export const FLOATING_BOTTOM_HEIGHT_MOBILE = 72; // 16 + 56
export const FLOATING_BOTTOM_HEIGHT_DESKTOP = 104; // 48 + 56

export const PREVIEWABLE_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  'pdf',
  ...TEXT_EXTENSIONS,
];
