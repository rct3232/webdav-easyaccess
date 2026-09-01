/**
 * Simple access logger for Express API routes.
 *
 * - Logs one JSON line per request to stdout (console.log)
 * - Does NOT log Authorization header or request bodies
 */
/* eslint-disable no-console -- access-logging is the module's purpose */

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return String(xff[0] || '').trim();
  }
  return req.ip || '';
}

function requestLogger() {
  return function requestLoggerMiddleware(req, res, next) {
    const start = typeof process.hrtime.bigint === 'function' ? process.hrtime.bigint() : null;
    const startMsFallback = start ? 0 : Date.now();

    res.on('finish', () => {
      let durationMs = 0;
      if (start) {
        const end = process.hrtime.bigint();
        durationMs = Number(end - start) / 1_000_000;
      } else {
        durationMs = Date.now() - startMsFallback;
      }

      const entry = {
        ts: new Date().toISOString(),
        method: req.method,
        url: req.originalUrl || req.url,
        status: res.statusCode,
        duration_ms: Math.round(durationMs),
        ip: getClientIp(req),
        user_agent: req.headers['user-agent'] || '',
      };

      // Best-effort: if an auth middleware populated req.user, include it.
      if (req.user && typeof req.user === 'object') {
        if (req.user.id !== undefined) entry.user_id = req.user.id;
        if (req.user.username) entry.username = req.user.username;
      }

      console.log(JSON.stringify(entry));
    });

    next();
  };
}

module.exports = requestLogger;
