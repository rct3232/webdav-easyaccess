/**
 * useFormState tests.
 * @see docs/spec/client/hooks/useFormState.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFormState } from '../useFormState';

describe('useFormState', () => {
  it('initial values equal initialValues', () => {
    const initial = { name: 'foo', age: 10 };
    const { result } = renderHook(() => useFormState(initial));

    expect(result.current.values).toEqual(initial);
    expect(result.current.errors).toEqual({});
    expect(result.current.isSubmitting).toBe(false);
  });

  it('setValue updates field and clears that field error', () => {
    const validator = (v) => (v ? null : 'required');
    const { result } = renderHook(() => useFormState({ name: '' }, { name: validator }));

    act(() => {
      result.current.handleSubmit();
    });
    expect(result.current.hasFieldError('name')).toBe(true);

    act(() => {
      result.current.setValue('name', 'updated');
    });

    expect(result.current.values.name).toBe('updated');
    expect(result.current.hasFieldError('name')).toBe(false);
  });

  it('handleChange updates values', () => {
    const { result } = renderHook(() => useFormState({ a: 1, b: 2 }));

    act(() => {
      result.current.handleChange('a', 10);
    });

    expect(result.current.values).toEqual({ a: 10, b: 2 });
  });

  it('validator errors reflected in hasFieldError and getFieldError', () => {
    const validator = (v) => (v && v.length >= 3 ? null : 'min 3 chars');
    const { result } = renderHook(() => useFormState({ name: 'ab' }, { name: validator }));

    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.hasFieldError('name')).toBe(true);
    expect(result.current.getFieldError('name')).toBe('min 3 chars');
  });

  it('handleSubmit validates and calls onSubmit when valid', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const validator = (v) => (v ? null : 'required');
    const { result } = renderHook(() =>
      useFormState({ name: 'valid' }, { name: validator }, { onSubmit })
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onSubmit).toHaveBeenCalledWith({ name: 'valid' });
    await waitFor(() => {
      expect(result.current.isSubmitting).toBe(false);
    });
  });

  it('handleSubmit does not call onSubmit when invalid', async () => {
    const onSubmit = jest.fn();
    const validator = () => 'error';
    const { result } = renderHook(() =>
      useFormState({ name: 'x' }, { name: validator }, { onSubmit })
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(result.current.isSubmitting).toBe(false);
  });

  it('isSubmitting true during submit', async () => {
    let resolveSubmit;
    const onSubmit = jest.fn(
      () =>
        new Promise((r) => {
          resolveSubmit = r;
        })
    );
    const { result } = renderHook(() => useFormState({ x: 'y' }, {}, { onSubmit }));

    let submitPromise;
    await act(async () => {
      submitPromise = result.current.handleSubmit();
    });

    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      resolveSubmit();
      await submitPromise;
    });

    await waitFor(() => {
      expect(result.current.isSubmitting).toBe(false);
    });
  });

  it('reset restores initialValues and clears errors', () => {
    const initial = { a: 1, b: 2 };
    const validator = () => 'error';
    const { result } = renderHook(() => useFormState(initial, { a: validator }));

    act(() => {
      result.current.handleChange('a', 99);
      result.current.handleSubmit();
    });
    expect(result.current.values.a).toBe(99);
    expect(result.current.hasFieldError('a')).toBe(true);

    act(() => {
      result.current.reset();
    });

    expect(result.current.values).toEqual(initial);
    expect(result.current.errors).toEqual({});
    expect(result.current.hasFieldError('a')).toBe(false);
  });

  it('validator throw uses err.message or genericError', () => {
    const validator = () => {
      throw new Error('custom validator error');
    };
    const { result } = renderHook(() => useFormState({ x: 1 }, { x: validator }));

    act(() => {
      result.current.handleSubmit();
    });

    expect(result.current.getFieldError('x')).toBe('custom validator error');
  });

  it('works with empty validators', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFormState({ a: 1 }, {}, { onSubmit }));

    act(() => {
      result.current.handleChange('a', 2);
    });
    expect(result.current.values.a).toBe(2);

    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(onSubmit).toHaveBeenCalledWith({ a: 2 });
    await waitFor(() => {
      expect(result.current.isSubmitting).toBe(false);
    });
  });

  it('setValues updates multiple fields and clears their errors', () => {
    const validator = (v) => (v ? null : 'required');
    const { result } = renderHook(() =>
      useFormState({ a: '', b: '' }, { a: validator, b: validator })
    );

    act(() => {
      result.current.handleSubmit();
    });
    expect(result.current.hasFieldError('a')).toBe(true);
    expect(result.current.hasFieldError('b')).toBe(true);

    act(() => {
      result.current.setValues({ a: 'x', b: 'y' });
    });

    expect(result.current.values).toEqual({ a: 'x', b: 'y' });
    expect(result.current.hasFieldError('a')).toBe(false);
    expect(result.current.hasFieldError('b')).toBe(false);
  });
});
