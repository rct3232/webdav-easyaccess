/**
 * Pure auth user normalization.
 * - Converts `is_admin` into a strict boolean.
 * - Preserves all other fields.
 */
export function normalizeAuthUser(user) {
  if (user == null) return null;
  if (typeof user !== 'object') return null;
  return {
    ...user,
    is_admin: Boolean(user.is_admin),
  };
}

