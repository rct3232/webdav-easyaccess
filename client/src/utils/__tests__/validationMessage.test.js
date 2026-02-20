/**
 * validationMessage tests: getValidationMessage
 * Resolves validation result (key string or { key, ...params }) to translated message.
 */
import { getValidationMessage } from '../validationMessage';

describe('getValidationMessage', () => {
  const t = (key, opts = {}) => {
    if (Object.keys(opts).length) return `t(${key}, ${JSON.stringify(opts)})`;
    return `t(${key})`;
  };

  it('returns null for null', () => {
    expect(getValidationMessage(null, t)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(getValidationMessage(undefined, t)).toBeNull();
  });

  it('returns t(key) for string key', () => {
    expect(getValidationMessage('validation.emailInvalid', t)).toBe('t(validation.emailInvalid)');
  });

  it('returns t(key, params) for object with key', () => {
    const result = getValidationMessage({ key: 'validation.required', fieldName: 'Email' }, t);
    expect(result).toContain('validation.required');
    expect(result).toContain('fieldName');
  });

  it('uses validation.field as default fieldName when not provided', () => {
    const result = getValidationMessage({ key: 'validation.required' }, t);
    expect(result).toContain('validation.field');
  });
});
