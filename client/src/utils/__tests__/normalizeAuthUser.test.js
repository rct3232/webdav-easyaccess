import { normalizeAuthUser } from '../normalizeAuthUser';

describe('normalizeAuthUser', () => {
  it('returns null for null and undefined', () => {
    expect(normalizeAuthUser(null)).toBeNull();
    expect(normalizeAuthUser(undefined)).toBeNull();
  });

  it('normalizes falsy is_admin values to false', () => {
    const result = normalizeAuthUser({ id: '1', is_admin: 0 });

    expect(result).toEqual({ id: '1', is_admin: false });
  });

  it('normalizes truthy is_admin values to true', () => {
    const result = normalizeAuthUser({ id: '1', is_admin: 'yes' });

    expect(result).toEqual({ id: '1', is_admin: true });
  });

  it('does not mutate the input object', () => {
    const user = { id: '1', is_admin: 1 };

    const result = normalizeAuthUser(user);

    expect(result).not.toBe(user);
    expect(user).toEqual({ id: '1', is_admin: 1 });
  });
});
