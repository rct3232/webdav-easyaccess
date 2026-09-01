# useFormState Spec

## 1. Overview

| Item                     | Description                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Generic form state management: values, validation, submit. Provides setValue, handleChange, handleSubmit, reset, getFieldError. |
| Used by components/pages | CreateFolderDialog, AccountEditDialog, other forms                                                                              |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useFormState.js`
- **Test file:** `client/src/hooks/__tests__/useFormState.test.js`

### 2.2 Input Parameters

| Name             | Type     | Required | Description              |
| ---------------- | -------- | -------- | ------------------------ |
| initialValues    | object   | N        | {}                       |
| validators       | object   | N        | {} field -> validator fn |
| options          | object   | N        | {}                       |
| options.onSubmit | function | N        | Submit handler           |

### 2.3 Return Value / State

| Key               | Type                     | Meaning                         |
| ----------------- | ------------------------ | ------------------------------- |
| values            | object                   | Form values                     |
| setValue          | (name, value) => void    | Set single field                |
| setValuesMultiple | (obj) => void            | Set multiple fields             |
| handleChange      | (name, value) => void    | Update field, clear error       |
| handleSubmit      | (e?) => void             | Validate and call onSubmit      |
| reset             | () => void               | Reset to initialValues          |
| handleBlur        | (name) => void           | Blur handler, validates on blur |
| validate          | () => boolean            | Validate all fields             |
| hasFieldError     | (name) => boolean        | Has error for field             |
| errors            | object                   | Field errors                    |
| touched           | object                   | Touched fields                  |
| isSubmitting      | boolean                  | Submit in progress              |
| getFieldError     | (name) => string \| null | Get error for field             |

### 2.4 Dependencies

- React useState, useCallback
- No external services

### 2.5 Side Effects

- onSubmit called on valid submit (async, setIsSubmitting)

### 2.6 Error Handling

- Validator throws: catch, return err.message or 'validation.genericError'
- onSubmit error: caller handles

### 2.7 Verification Scenarios

- [ ] Initial values
- [ ] setValue, handleChange update values
- [ ] Validators run, errors set
- [ ] handleSubmit validates, calls onSubmit when valid
- [ ] reset clears values/errors
- [ ] isSubmitting during submit

### 2.8 Edge Cases

- Empty validators
- setValue clears error for that field
