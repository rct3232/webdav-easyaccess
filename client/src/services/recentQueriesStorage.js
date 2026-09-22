/**
 * Browser-storage adapter seam for recent search queries
 * (useSearchResults.md §2.4 Decision: persistence goes through a tiny
 * browser-storage adapter inside the gateway layer, never sessionStorage in
 * the hook). Session-scoped storage mirrors the app's session-only auth
 * model; `clearRecentQueries` is the logout hook.
 */

const STORAGE_KEY = 'wea.recentSearchQueries';

function readStorage() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @returns {Array<{ id: string, query: string, resultRef?: string }>}
 */
export function loadRecentQueries() {
  return readStorage();
}

/**
 * @param {Array<{ id: string, query: string, resultRef?: string }>} queries
 */
export function saveRecentQueries(queries) {
  try {
    const list = Array.isArray(queries) ? queries.slice(0, 8) : [];
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable (private mode etc.) — chips stay in-memory
  }
}

/** Logout hook — cleared alongside the session-scoped auth state. */
export function clearRecentQueries() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
