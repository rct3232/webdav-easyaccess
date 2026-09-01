/**
 * Auth navigation policy for 401/403 handling.
 * Centralizes excluded-endpoint decisions and browser-only side effects.
 */

function shouldSkipAuthNavigation(config) {
  const url = typeof config?.url === 'string' ? config.url : '';
  const isAuthAttempt = url.includes('/auth/login') || url.includes('/auth/register');

  const h = config?.headers;
  const isShareRequest = Boolean(
    h && (h instanceof Headers ? h.get('X-Share-Token') : h['X-Share-Token'] || h['x-share-token'])
  );

  const isSharePermissionCheck =
    typeof config?.url === 'string' &&
    config.url.includes('/share/') &&
    config.url.includes('/check-my-permission');

  return isAuthAttempt || isShareRequest || isSharePermissionCheck;
}

function is403RedirectableRequest(config) {
  const method = (config?.method || 'GET').toUpperCase();
  const url = typeof config?.url === 'string' ? config.url : '';
  if (method !== 'GET') return false;

  return url === '/api/files/list' || /^\/api\/admin(?:\/|$)/.test(url);
}

function handle403(config, error) {
  if (shouldSkipAuthNavigation(config)) {
    throw error;
  }

  if (!is403RedirectableRequest(config)) {
    throw error;
  }

  if (typeof window !== 'undefined' && window.history?.length > 1) {
    window.history.back();
  } else if (typeof window !== 'undefined') {
    window.location.href = '/';
  } else {
    throw error;
  }
}

function handle401RefreshFailure() {
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

export { shouldSkipAuthNavigation, is403RedirectableRequest, handle403, handle401RefreshFailure };
