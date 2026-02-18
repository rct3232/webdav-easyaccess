/**
 * Resolves validation result (key string or { key, ...params }) to a translated message.
 * @param {string | { key: string, [k: string]: any } | null} result - Return value from shared/validation
 * @param {(key: string, opts?: object) => string} t - i18n t function
 * @returns {string | null} Translated message or null
 */
export function getValidationMessage(result, t) {
  if (result == null) return null;
  if (typeof result === 'object' && result.key) {
    const params = { ...result };
    if (params.fieldName == null) {
      params.fieldName = t('validation.field');
    }
    return t(params.key, params);
  }
  return t(result);
}
