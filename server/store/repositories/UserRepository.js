'use strict';

/**
 * UserRepository — domain interface over the `users` table
 * (docs/spec/server/store/repository-contract.md).
 *
 * Absorbs the user half of the former
 * `server/infrastructure/adapters/metadata/*MetadataAdapter` classes. The
 * share-link half of those adapters was vestigial (dead `file_path` schema
 * column) and is dropped; share links live in `ShareLinkRepository`.
 *
 * Behaviour contract (kept identical to the former adapters):
 * - emails are normalised (trim + lowercase) before hashing/storing;
 * - create/updateEmail pre-check duplicates inside the same transaction and
 *   raise 409 `admin.usernameTaken` / `auth.emailTaken`;
 * - updatePassword bumps `token_version` (session invalidation);
 * - rows are returned domain-shaped via the shared user mapper.
 *
 * @typedef {Object} UserRepository
 * @property {(username: string) => Promise<Object|undefined>} findByUsername
 * @property {(email: string) => Promise<Object|undefined>} findByEmail
 * @property {(id: number|string) => Promise<Object|undefined>} findById
 * @property {() => Promise<Array<Object>>} findAll
 * @property {(status: string) => Promise<Array<Object>>} findByStatus
 * @property {({ username, email, passwordHash, isAdmin? }) => Promise<Object>} createUser
 * @property {(userId, status) => Promise<{ success: true }>} updateStatus
 * @property {(userId, newEmail) => Promise<{ success: true }>} updateEmail
 * @property {(userId, passwordHash) => Promise<{ success: true }>} updatePassword
 * @property {(userId) => Promise<{ success: true }>} deleteUser
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {UserRepository}
 */
module.exports = function createUserRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createUserRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/UserRepository.sqlite')
      : require('./postgres/UserRepository.postgres');
  return impl(executor);
};
