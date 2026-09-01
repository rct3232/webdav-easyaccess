# errorUtils Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Error message handling: determine error type from Error/response, map to i18n keys, extract display messages. Provides getServerErrorDisplay, getServerMessageDisplay, showErrorFromError. Note: For displaying messages, use useMessage hook. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/errorUtils.js`
- **Test file:** `client/src/utils/__tests__/errorUtils.test.js`

### 2.2 Function Signatures

| Function                | (input) => return                            |
| ----------------------- | -------------------------------------------- |
| determineErrorType      | (error) => string (ERROR_TYPES.\*)           |
| getErrorMessageByType   | (errorType) => string (i18n key)             |
| getErrorMessage         | (error, defaultKey?) => { key, raw? }        |
| getServerErrorDisplay   | (data, t) => string                          |
| getServerMessageDisplay | (data, t) => string                          |
| showErrorFromError      | (error, showErrorFn, t, defaultKey?) => void |

### 2.3 Exports

- **ERROR_TYPES:** FILE_NOT_FOUND, PERMISSION_DENIED, NETWORK_ERROR, DUPLICATE_FILE, INVALID_PATH, UNKNOWN
- **ERROR_MESSAGE_KEYS:** Maps error type to i18n key (e.g. errors.fileNotFound)

### 2.4 Dependencies

- `@webdav-easyaccess/shared/constants` (HTTP_STATUS)
- Axios error shape: error.response.status, error.response.data.errorCode, error.response.data.error

### 2.5 Verification Scenarios

- [ ] determineErrorType: 404/500 → FILE_NOT_FOUND; 403/401 → PERMISSION_DENIED; ECONNABORTED/ERR_NETWORK → NETWORK_ERROR
- [ ] getErrorMessage: when data.errorCode present, return that key
- [ ] getServerErrorDisplay: data.errorCode + t; fallback to data.error, then errors.unknown
- [ ] getServerMessageDisplay: data.messageCode + t; fallback to data.message
- [ ] showErrorFromError calls showErrorFn with appropriate string

### 2.6 Edge Cases

- null/undefined error → UNKNOWN
- Message-based fallback (message includes 'permission', 'not found', etc.)
