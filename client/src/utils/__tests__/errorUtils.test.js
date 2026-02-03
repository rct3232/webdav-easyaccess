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
    it('returns appropriate message for known error types', () => {
      const error = { response: { status: 403 } };
      expect(getErrorMessage(error)).toBe('접근 권한이 없습니다.');
    });

    it('returns server error message if type is unknown', () => {
      const error = { response: { data: { error: 'Server says no' } } };
      expect(getErrorMessage(error)).toBe('Server says no');
    });

    it('returns default message if everything fails', () => {
      expect(getErrorMessage(null, 'default')).toBe('default');
    });
  });
});
