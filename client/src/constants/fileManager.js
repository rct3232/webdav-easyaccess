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

// Collections list sort (server contract GET /api/collections?sort=…, docs/spec/
// server/routes/collections.md); state is ephemeral — never persisted
// (useCollections.md §2.3 decision). Labels: fileManager.collectionsSort<Option>.
export const COLLECTION_SORT_OPTIONS = ['activity', 'name', 'created', 'updated', 'similar'];

// Scroll container padding: height of FloatingSearchBar + FAB bottom area (offset + 56px)
// Keep in sync with FloatingSearchBar MOBILE_OFFSET/DESKTOP_OFFSET + FAB_SIZE
export const FLOATING_BOTTOM_HEIGHT_MOBILE = 72; // 16 + 56
export const FLOATING_BOTTOM_HEIGHT_DESKTOP = 104; // 48 + 56

// One full rotation of the pending search-glyph orbit. The submit pipeline
// holds `pending` for at least this long after a successful response
// (useSearchResults.md §2.3), and SearchGlyphIcon uses the same value for
// the animation duration.
export const SEARCH_ORBIT_CYCLE_MS = 1600;

// A user cancel is ignored inside this window after a submit so a submit
// double-click cannot immediately cancel itself (useSearchResults.md §2.3).
export const SEARCH_CANCEL_GUARD_MS = 300;

// Explicit bound for the single search POST: an unresponsive server surfaces
// through the absorbed-failure path instead of holding `pending` for the
// transport default (5 min). Timeouts are never retried by httpClient.
export const SEARCH_REQUEST_TIMEOUT_MS = 60_000;

export const PREVIEWABLE_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  'pdf',
  ...TEXT_EXTENSIONS,
];
