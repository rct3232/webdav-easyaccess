import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Seed scratch sqlite `settings` rows BEFORE the scratch server boots
 * (T4.3 fake-LLM harness; same pre-boot pattern as `seedWebdavSettings`).
 *
 * `LLM_{EMBED,CHAT,VISION,ASR}_*` are `dbOnly` in the config registry, so a
 * value can only enter the child through the DB — ambient env can never point
 * a scratch server at a real provider. The settings table schema mirrors the
 * converted DDL (CREATE TABLE IF NOT EXISTS makes the boot re-init a no-op).
 */
export function seedScratchSettings(scratchDir: string, entries: Record<string, string>): void {
  fs.mkdirSync(scratchDir, { recursive: true });
  const db = new DatabaseSync(path.join(scratchDir, 'webdav.db'));
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(entries)) {
      insert.run(key, String(value));
    }
  } finally {
    db.close();
  }
}
