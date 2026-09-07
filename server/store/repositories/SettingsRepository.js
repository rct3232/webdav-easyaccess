'use strict';

/**
 * SettingsRepository — domain interface over the `settings` table
 * (docs/spec/server/store/repository-contract.md).
 *
 * The settings table stores plaintext string values (D11). The dialect
 * implementations own the storage shape difference (PG `jsonb` vs sqlite
 * `TEXT`) and return the stored value as the resolver expects it.
 *
 * @typedef {Object} SettingsRepository
 * @property {(key: string) => Promise<string|null>} get
 *   The stored value for `key`, or `null` when absent.
 * @property {() => Promise<Record<string, string>>} getAll
 *   All settings rows as `{ [key]: value }`.
 * @property {(key: string, value: string) => Promise<{ success: true }>} set
 *   Upsert (INSERT … ON CONFLICT), updating `updated_at`.
 * @property {() => Promise<Array<{ key: string, value: string, updated_at: any }>>} listRows
 *   Raw rows for the admin/config-sync surfaces (`updated_at` as the backend
 *   stores it — Date on PG, ISO-ish TEXT on sqlite; the facade reports it as-is).
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {SettingsRepository}
 */
module.exports = function createSettingsRepository(executor) {
  if (!executor || executor.dialect !== 'sqlite' && executor.dialect !== 'postgres') {
    throw new TypeError('createSettingsRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/SettingsRepository.sqlite')
      : require('./postgres/SettingsRepository.postgres');
  return impl(executor);
};
