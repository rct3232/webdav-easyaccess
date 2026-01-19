const { withLock } = require('./locks');
const { SETTINGS_PATH, META_ROOT } = require('./metaPaths');
const { ensureDir, exists, readFile, writeFile } = require('./storage');

function nowIso() {
  return new Date().toISOString();
}

async function ensureSettingsFile() {
  await ensureDir(META_ROOT);
  const ok = await exists(SETTINGS_PATH);
  if (!ok) {
    const initial = {
      registration_enabled: 'false',
      updated_at: nowIso(),
    };
    await writeFile(SETTINGS_PATH, JSON.stringify(initial, null, 2), {
      overwrite: true,
      contentType: 'application/json; charset=utf-8',
    });
  }
}

async function readSettings() {
  await ensureSettingsFile();
  const buf = await readFile(SETTINGS_PATH);
  const text = Buffer.from(buf).toString('utf8');
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') return obj;
  } catch {
    // fall through
  }
  // If corrupted, reset to safe defaults
  const fallback = {
    registration_enabled: 'false',
    updated_at: nowIso(),
  };
  await writeFile(SETTINGS_PATH, JSON.stringify(fallback, null, 2), {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
  return fallback;
}

async function writeSettings(obj) {
  obj.updated_at = nowIso();
  await writeFile(SETTINGS_PATH, JSON.stringify(obj, null, 2), {
    overwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
}

async function get(key) {
  const s = await readSettings();
  return Object.prototype.hasOwnProperty.call(s, key) ? s[key] : null;
}

async function set(key, value) {
  await ensureSettingsFile();
  return await withLock('settings', async () => {
    const s = await readSettings();
    s[key] = String(value);
    await writeSettings(s);
    return { success: true };
  });
}

async function getAll() {
  const s = await readSettings();
  const { updated_at, ...rest } = s;
  return rest;
}

async function isRegistrationEnabled() {
  const v = await get('registration_enabled');
  return v === 'true';
}

module.exports = {
  ensureSettingsFile,
  get,
  set,
  getAll,
  isRegistrationEnabled,
};

