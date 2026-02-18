/**
 * Generic form state management hook
 * Provides form state, validation, and error handling
 */

import { useState, useCallback } from 'react';

/**
 * Form state management hook
 * @param {Object} initialValues - Initial form values
 * @param {Object} validators - Validation functions (key: field name, value: validator function)
 * @param {Object} options - Additional options
 * @param {Function} options.onSubmit - Submit handler
 * @returns {Object} Form state and handlers
 */
export const useFormState = (initialValues = {}, validators = {}, options = {}) => {
  const { onSubmit } = options;
  
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Update field value
   * @param {string} name - Field name
   * @param {*} value - Field value
   */
  const setValue = useCallback((name, value) => {
    setValues(prev => ({ ...prev, [name]: value }));
    
    // Clear error when field is updated
    if (errors[name]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  }, [errors]);

  /**
   * Update multiple field values
   * @param {Object} newValues - Object with field names and values
   */
  const setValuesMultiple = useCallback((newValues) => {
    setValues(prev => ({ ...prev, ...newValues }));
    
    // Clear errors for updated fields
    setErrors(prev => {
      const newErrors = { ...prev };
      Object.keys(newValues).forEach(key => {
        delete newErrors[key];
      });
      return newErrors;
    });
  }, []);

  /**
   * Validate a single field
   * @param {string} name - Field name
   * @param {*} value - Field value
   * @returns {string|null} Error message or null
   */
  const validateField = useCallback((name, value) => {
    const validator = validators[name];
    if (!validator) return null;
    
    try {
      const error = validator(value, values);
      return error || null;
    } catch (err) {
      return err.message || 'validation.genericError';
    }
  }, [validators, values]);

  /**
   * Validate all fields
   * @returns {boolean} True if form is valid
   */
  const validate = useCallback(() => {
    const newErrors = {};
    let isValid = true;

    Object.keys(validators).forEach(name => {
      const error = validateField(name, values[name]);
      if (error) {
        newErrors[name] = error;
        isValid = false;
      }
    });

    setErrors(newErrors);
    setTouched(Object.keys(validators).reduce((acc, key) => {
      acc[key] = true;
      return acc;
    }, {}));
    
    return isValid;
  }, [validators, values, validateField]);

  /**
   * Handle field change
   * @param {string} name - Field name
   * @param {*} value - Field value
   */
  const handleChange = useCallback((name, value) => {
    setValue(name, value);
  }, [setValue]);

  /**
   * Handle field blur
   * @param {string} name - Field name
   */
  const handleBlur = useCallback((name) => {
    setTouched(prev => ({ ...prev, [name]: true }));
    const error = validateField(name, values[name]);
    if (error) {
      setErrors(prev => ({ ...prev, [name]: error }));
    }
  }, [values, validateField]);

  /**
   * Handle form submit
   * @param {Event} e - Form event
   */
  const handleSubmit = useCallback(async (e) => {
    if (e) {
      e.preventDefault();
    }

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    try {
      if (onSubmit) {
        await onSubmit(values);
      }
    } catch (error) {
      // Handle submit error
      console.error('Form submit error:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [validate, values, onSubmit]);

  /**
   * Reset form to initial values
   */
  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
    setIsSubmitting(false);
  }, [initialValues]);

  /**
   * Get field error (only if touched)
   * @param {string} name - Field name
   * @returns {string|undefined} Error message
   */
  const getFieldError = useCallback((name) => {
    return touched[name] ? errors[name] : undefined;
  }, [touched, errors]);

  /**
   * Check if field has error
   * @param {string} name - Field name
   * @returns {boolean} True if field has error
   */
  const hasFieldError = useCallback((name) => {
    return Boolean(touched[name] && errors[name]);
  }, [touched, errors]);

  return {
    values,
    errors,
    touched,
    isSubmitting,
    setValue,
    setValues: setValuesMultiple,
    handleChange,
    handleBlur,
    handleSubmit,
    validate,
    reset,
    getFieldError,
    hasFieldError,
  };
};
