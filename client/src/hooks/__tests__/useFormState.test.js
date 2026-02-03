import { renderHook, act } from '@testing-library/react';
import { useFormState } from '../useFormState';

describe('useFormState', () => {
  const initialValues = { username: '', email: '' };
  const validators = {
    username: (val) => (!val ? 'Username is required' : null),
    email: (val) => (!val.includes('@') ? 'Invalid email' : null),
  };

  it('should initialize with provided values', () => {
    const { result } = renderHook(() => useFormState(initialValues));

    expect(result.current.values).toEqual(initialValues);
    expect(result.current.errors).toEqual({});
    expect(result.current.isSubmitting).toBe(false);
  });

  it('should update field value and clear error', () => {
    const { result } = renderHook(() => useFormState(initialValues, validators));

    // First trigger an error
    act(() => {
      result.current.handleBlur('username');
    });
    expect(result.current.errors.username).toBe('Username is required');

    // Update value
    act(() => {
      result.current.handleChange('username', 'testuser');
    });

    expect(result.current.values.username).toBe('testuser');
    expect(result.current.errors.username).toBeUndefined();
  });

  it('should validate all fields on validate()', () => {
    const { result } = renderHook(() => useFormState(initialValues, validators));

    let isValid;
    act(() => {
      isValid = result.current.validate();
    });

    expect(isValid).toBe(false);
    expect(result.current.errors).toEqual({
      username: 'Username is required',
      email: 'Invalid email',
    });
  });

  it('should handle blur validation', () => {
    const { result } = renderHook(() => useFormState(initialValues, validators));

    act(() => {
      result.current.handleBlur('email');
    });

    expect(result.current.errors.email).toBe('Invalid email');
    expect(result.current.touched.email).toBe(true);
  });

  it('should handle form submission', async () => {
    const onSubmit = jest.fn();
    const { result } = renderHook(() => 
      useFormState({ username: 'test', email: 'test@test.com' }, validators, { onSubmit })
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onSubmit).toHaveBeenCalledWith({ username: 'test', email: 'test@test.com' });
    expect(result.current.isSubmitting).toBe(false);
  });

  it('should not submit if validation fails', async () => {
    const onSubmit = jest.fn();
    const { result } = renderHook(() => 
      useFormState(initialValues, validators, { onSubmit })
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.errors.username).toBeDefined();
  });

  it('should reset form', () => {
    const { result } = renderHook(() => useFormState(initialValues, validators));

    act(() => {
      result.current.handleChange('username', 'new');
      result.current.handleBlur('email');
      result.current.reset();
    });

    expect(result.current.values).toEqual(initialValues);
    expect(result.current.errors).toEqual({});
    expect(result.current.touched).toEqual({});
  });

  it('should check if field has error only if touched', () => {
    const { result } = renderHook(() => useFormState(initialValues, validators));

    // Not touched yet, even if invalid, hasFieldError should be false
    act(() => {
      result.current.validate(); // this sets all to touched
    });
    expect(result.current.hasFieldError('username')).toBe(true);

    act(() => {
      result.current.reset();
      result.current.handleChange('username', ''); // invalid but not touched
    });
    expect(result.current.hasFieldError('username')).toBe(false);

    act(() => {
      result.current.handleBlur('username'); // now touched
    });
    expect(result.current.hasFieldError('username')).toBe(true);
  });
});
