import { determineErrorType, ERROR_TYPES, getErrorMessage } from '../errorUtils';

describe('errorUtils', () => {
  describe('determineErrorType', () => {
    it('identifies network errors', () => {
      expect(determineErrorType({ code: 'ECONNABORTED' })).toBe(ERROR_TYPES.NETWORK_ERROR);
      expect(determineErrorType(new Error('Network Error'))).toBe(ERROR_TYPES.NETWORK_ERROR);
    });

    it('identifies status code errors', () => {
      expect(determineErrorType({ response: { status: 404 } })).toBe(ERROR_TYPES.FILE_NOT_FOUND);
      expect(determineErrorType({ response: { status: 403 } })).toBe(ERROR_TYPES.PERMISSION_DENIED);
      expect(determineErrorType({ response: { status: 409 } })).toBe(ERROR_TYPES.DUPLICATE_FILE);
    });

    it('identifies errors by message', () => {
      expect(determineErrorType(new Error('permission denied'))).toBe(ERROR_TYPES.PERMISSION_DENIED);
      expect(determineErrorType(new Error('not found'))).toBe(ERROR_TYPES.FILE_NOT_FOUND);
    });
  });

  describe('getErrorMessage', () => {
    it('returns key for known error types', () => {
      const error = { response: { status: 403 } };
      expect(getErrorMessage(error)).toEqual({ key: 'errors.permissionDenied' });
    });

    it('returns key and raw when server provides error message', () => {
      const error = { response: { data: { error: 'Server says no' } } };
      const result = getErrorMessage(error);
      expect(result.key).toBe('errors.unknown');
      expect(result.raw).toBe('Server says no');
    });

    it('returns errorCode as key when server sends errorCode (no raw)', () => {
      const error = { response: { data: { errorCode: 'serverErrors.auth.invalidCredentials' } } };
      const result = getErrorMessage(error);
      expect(result.key).toBe('serverErrors.auth.invalidCredentials');
      expect(result).not.toHaveProperty('raw');
    });

    it('returns default key when error is null', () => {
      expect(getErrorMessage(null, 'errors.unknown')).toEqual({ key: 'errors.unknown' });
    });
  });
});
