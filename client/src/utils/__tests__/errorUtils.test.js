/**
 * errorUtils tests: determineErrorType, getErrorMessageByType, getErrorMessage,
 * getServerErrorDisplay, getServerMessageDisplay, showErrorFromError
 * @see docs/spec/client/utils/errorUtils.md
 */
import {
  ERROR_TYPES,
  ERROR_MESSAGE_KEYS,
  determineErrorType,
  getErrorMessageByType,
  getErrorMessage,
  getServerErrorDisplay,
  getServerMessageDisplay,
  getConnectionClassFriendlyKey,
  showErrorFromError,
} from '../errorUtils';
import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';

describe('ERROR_TYPES and ERROR_MESSAGE_KEYS', () => {
  it('exports expected error types', () => {
    expect(ERROR_TYPES.FILE_NOT_FOUND).toBe('file_not_found');
    expect(ERROR_TYPES.PERMISSION_DENIED).toBe('permission_denied');
    expect(ERROR_TYPES.NETWORK_ERROR).toBe('network_error');
    expect(ERROR_TYPES.DUPLICATE_FILE).toBe('duplicate_file');
    expect(ERROR_TYPES.INVALID_PATH).toBe('invalid_path');
    expect(ERROR_TYPES.UNKNOWN).toBe('unknown');
  });

  it('maps error types to i18n keys', () => {
    expect(ERROR_MESSAGE_KEYS[ERROR_TYPES.FILE_NOT_FOUND]).toBe('errors.fileNotFound');
    expect(ERROR_MESSAGE_KEYS[ERROR_TYPES.PERMISSION_DENIED]).toBe('errors.permissionDenied');
  });
});

describe('determineErrorType', () => {
  it('returns FILE_NOT_FOUND for 404', () => {
    expect(determineErrorType({ response: { status: HTTP_STATUS.NOT_FOUND } })).toBe(
      ERROR_TYPES.FILE_NOT_FOUND
    );
  });

  it('returns FILE_NOT_FOUND for 500', () => {
    expect(determineErrorType({ response: { status: HTTP_STATUS.INTERNAL_SERVER_ERROR } })).toBe(
      ERROR_TYPES.FILE_NOT_FOUND
    );
  });

  it('returns PERMISSION_DENIED for 403', () => {
    expect(determineErrorType({ response: { status: HTTP_STATUS.FORBIDDEN } })).toBe(
      ERROR_TYPES.PERMISSION_DENIED
    );
  });

  it('returns PERMISSION_DENIED for 401', () => {
    expect(determineErrorType({ response: { status: HTTP_STATUS.UNAUTHORIZED } })).toBe(
      ERROR_TYPES.PERMISSION_DENIED
    );
  });

  it('returns NETWORK_ERROR for ECONNABORTED', () => {
    expect(determineErrorType({ code: 'ECONNABORTED' })).toBe(ERROR_TYPES.NETWORK_ERROR);
  });

  it('returns NETWORK_ERROR for ERR_NETWORK', () => {
    expect(determineErrorType({ code: 'ERR_NETWORK' })).toBe(ERROR_TYPES.NETWORK_ERROR);
  });

  it('returns NETWORK_ERROR when message includes Network Error', () => {
    expect(determineErrorType({ message: 'Network Error' })).toBe(ERROR_TYPES.NETWORK_ERROR);
  });

  it('returns NETWORK_ERROR when message includes timeout', () => {
    expect(determineErrorType({ message: 'request timeout' })).toBe(ERROR_TYPES.NETWORK_ERROR);
  });

  it('returns DUPLICATE_FILE for 409', () => {
    expect(determineErrorType({ response: { status: HTTP_STATUS.CONFLICT } })).toBe(
      ERROR_TYPES.DUPLICATE_FILE
    );
  });

  it('returns PERMISSION_DENIED when message includes permission', () => {
    expect(determineErrorType({ message: 'Permission denied' })).toBe(
      ERROR_TYPES.PERMISSION_DENIED
    );
  });

  it('returns FILE_NOT_FOUND when message includes not found', () => {
    expect(determineErrorType({ message: 'resource not found' })).toBe(ERROR_TYPES.FILE_NOT_FOUND);
  });

  it('returns INVALID_PATH when message includes invalid', () => {
    expect(determineErrorType({ message: 'invalid path' })).toBe(ERROR_TYPES.INVALID_PATH);
  });

  it('returns DUPLICATE_FILE when message includes already exists', () => {
    expect(determineErrorType({ message: 'file already exists' })).toBe(ERROR_TYPES.DUPLICATE_FILE);
  });

  it('returns UNKNOWN for null/undefined', () => {
    expect(determineErrorType(null)).toBe(ERROR_TYPES.UNKNOWN);
    expect(determineErrorType(undefined)).toBe(ERROR_TYPES.UNKNOWN);
  });

  it('returns UNKNOWN for unrecognized error', () => {
    expect(determineErrorType({ message: 'something else' })).toBe(ERROR_TYPES.UNKNOWN);
  });
});

describe('getErrorMessageByType', () => {
  it('returns i18n key for known type', () => {
    expect(getErrorMessageByType(ERROR_TYPES.FILE_NOT_FOUND)).toBe('errors.fileNotFound');
    expect(getErrorMessageByType(ERROR_TYPES.PERMISSION_DENIED)).toBe('errors.permissionDenied');
  });

  it('returns errors.unknown for unknown type', () => {
    expect(getErrorMessageByType('unknown_type')).toBe(ERROR_MESSAGE_KEYS[ERROR_TYPES.UNKNOWN]);
  });
});

describe('getErrorMessage', () => {
  it('returns default key when error is null', () => {
    expect(getErrorMessage(null)).toEqual({ key: 'errors.unknown' });
    expect(getErrorMessage(null, 'custom.key')).toEqual({ key: 'custom.key' });
  });

  it('returns data.errorCode as key when present', () => {
    const err = { response: { data: { errorCode: 'serverErrors.files.accessDenied' } } };
    expect(getErrorMessage(err)).toEqual({ key: 'serverErrors.files.accessDenied' });
  });

  it('returns friendly key for connection-class errorCode', () => {
    const err = { response: { data: { errorCode: 'serverErrors.webdav.connectionRefused' } } };
    expect(getErrorMessage(err)).toEqual({ key: 'files.storageUnavailable' });
  });

  it('returns maintenance notice key for databaseUnavailable errorCode', () => {
    const err = {
      response: { data: { errorCode: 'serverErrors.errorHandler.databaseUnavailable' } },
    };
    expect(getErrorMessage(err)).toEqual({ key: 'files.maintenanceNotice' });
  });

  it('returns type-based key for HTTP status when no errorCode', () => {
    const err = { response: { status: HTTP_STATUS.NOT_FOUND } };
    expect(getErrorMessage(err)).toEqual({ key: 'errors.fileNotFound' });
  });

  it('returns default key with raw when data.error present for unknown type', () => {
    const err = { response: { data: { error: 'Custom server message' } } };
    expect(getErrorMessage(err)).toEqual({ key: 'errors.unknown', raw: 'Custom server message' });
  });

  it('returns default key with raw when error.message present for unknown type', () => {
    const err = { message: 'Some error message' };
    expect(getErrorMessage(err)).toEqual({ key: 'errors.unknown', raw: 'Some error message' });
  });
});

describe('getConnectionClassFriendlyKey', () => {
  it('maps webdav connection-class codes to files.storageUnavailable', () => {
    expect(getConnectionClassFriendlyKey('serverErrors.webdav.connectionRefused')).toBe(
      'files.storageUnavailable'
    );
    expect(getConnectionClassFriendlyKey('serverErrors.webdav.serverNotResponding')).toBe(
      'files.storageUnavailable'
    );
    expect(getConnectionClassFriendlyKey('serverErrors.webdav.cannotConnect')).toBe(
      'files.storageUnavailable'
    );
    expect(getConnectionClassFriendlyKey('serverErrors.webdav.allConnectionAttemptsFailed')).toBe(
      'files.storageUnavailable'
    );
    expect(getConnectionClassFriendlyKey('serverErrors.webdav.credentialsNotConfigured')).toBe(
      'files.storageUnavailable'
    );
    expect(getConnectionClassFriendlyKey('serverErrors.storage.postgresqlNotConfigured')).toBe(
      'files.storageUnavailable'
    );
  });

  it('maps databaseUnavailable to files.maintenanceNotice', () => {
    expect(getConnectionClassFriendlyKey('serverErrors.errorHandler.databaseUnavailable')).toBe(
      'files.maintenanceNotice'
    );
  });

  it('returns null for unrelated codes', () => {
    expect(getConnectionClassFriendlyKey('serverErrors.files.accessDenied')).toBeNull();
    expect(getConnectionClassFriendlyKey('serverErrors.webdav.sourceNotFound')).toBeNull();
    expect(getConnectionClassFriendlyKey(undefined)).toBeNull();
  });
});

describe('getServerErrorDisplay', () => {
  const t = (key, params = {}) =>
    params && Object.keys(params).length ? `${key}(${JSON.stringify(params)})` : key;

  it('returns t(errors.unknown) when data is null', () => {
    expect(getServerErrorDisplay(null, t)).toBe('errors.unknown');
  });

  it('returns t(errorCode, params) when errorCode present', () => {
    expect(getServerErrorDisplay({ errorCode: 'serverErrors.auth.invalid' }, t)).toBe(
      'serverErrors.auth.invalid'
    );
    expect(
      getServerErrorDisplay(
        { errorCode: 'serverErrors.files.accessDenied', params: { path: '/x' } },
        t
      )
    ).toBe('serverErrors.files.accessDenied({"path":"/x"})');
  });

  it('returns friendly key for connection-class errorCode', () => {
    expect(getServerErrorDisplay({ errorCode: 'serverErrors.webdav.connectionRefused' }, t)).toBe(
      'files.storageUnavailable'
    );
    expect(getServerErrorDisplay({ errorCode: 'serverErrors.webdav.cannotConnect' }, t)).toBe(
      'files.storageUnavailable'
    );
  });

  it('returns maintenance notice key for databaseUnavailable errorCode', () => {
    expect(
      getServerErrorDisplay({ errorCode: 'serverErrors.errorHandler.databaseUnavailable' }, t)
    ).toBe('files.maintenanceNotice');
  });

  it('keeps own translation for unrelated errorCode', () => {
    expect(getServerErrorDisplay({ errorCode: 'serverErrors.webdav.sourceNotFound' }, t)).toBe(
      'serverErrors.webdav.sourceNotFound'
    );
  });

  it('returns data.error when no errorCode', () => {
    expect(getServerErrorDisplay({ error: 'Raw message' }, t)).toBe('Raw message');
  });

  it('falls back to t(errors.unknown) when t returns non-string for errorCode', () => {
    const tBad = (key) => (key === 'errors.unknown' ? 'errors.unknown' : {});
    expect(getServerErrorDisplay({ errorCode: 'x' }, tBad)).toBe('errors.unknown');
  });
});

describe('getServerMessageDisplay', () => {
  const t = (key, params = {}) =>
    params && Object.keys(params).length ? `${key}(${JSON.stringify(params)})` : key;

  it('returns empty string when data is null', () => {
    expect(getServerMessageDisplay(null, t)).toBe('');
  });

  it('returns t(messageCode, params) when messageCode present', () => {
    expect(getServerMessageDisplay({ messageCode: 'serverMessages.auth.loginSuccess' }, t)).toBe(
      'serverMessages.auth.loginSuccess'
    );
  });

  it('returns data.message when no messageCode', () => {
    expect(getServerMessageDisplay({ message: 'Success!' }, t)).toBe('Success!');
  });

  it('returns empty string when t returns non-string', () => {
    const tBad = () => ({});
    expect(getServerMessageDisplay({ messageCode: 'x' }, tBad)).toBe('');
  });
});

describe('showErrorFromError', () => {
  const t = (key) => key;
  let showErrorFn;

  beforeEach(() => {
    showErrorFn = jest.fn();
  });

  it('calls showErrorFn with translated server error when errorCode present', () => {
    const err = { response: { data: { errorCode: 'serverErrors.auth.invalid' } } };
    showErrorFromError(err, showErrorFn, t);
    expect(showErrorFn).toHaveBeenCalledWith('serverErrors.auth.invalid');
  });

  it('calls showErrorFn with raw message when available', () => {
    const err = { response: { data: { error: 'Custom error' } } };
    showErrorFromError(err, showErrorFn, t);
    expect(showErrorFn).toHaveBeenCalledWith('Custom error');
  });

  it('calls showErrorFn with t(key) when type known and no raw', () => {
    const err = { response: { status: HTTP_STATUS.NOT_FOUND } };
    showErrorFromError(err, showErrorFn, t);
    expect(showErrorFn).toHaveBeenCalledWith('errors.fileNotFound');
  });
});
