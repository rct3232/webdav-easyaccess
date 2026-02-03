import React from 'react';
import { render } from '@testing-library/react';
import { highlightText } from '../searchUtils';

describe('searchUtils', () => {
  describe('highlightText', () => {
    it('should return original text if query is empty', () => {
      const text = 'Hello World';
      expect(highlightText(text, '')).toBe(text);
      expect(highlightText(text, null)).toBe(text);
    });

    it('should return original text if text is empty', () => {
      expect(highlightText('', 'query')).toBe('');
    });

    it('should highlight matching text', () => {
      const text = 'This is a test';
      const query = 'test';
      const result = highlightText(text, query);
      
      const { container } = render(<div>{result}</div>);
      const highlighted = container.querySelector('span');
      
      expect(highlighted).toBeInTheDocument();
      expect(highlighted).toHaveTextContent('test');
      expect(container.textContent).toBe('This is a test');
    });

    it('should handle case-insensitive matching', () => {
      const text = 'Hello World';
      const query = 'hello';
      const result = highlightText(text, query);
      
      const { container } = render(<div>{result}</div>);
      const highlighted = container.querySelector('span');
      
      expect(highlighted).toHaveTextContent('Hello');
    });

    it('should highlight multiple matches', () => {
      const text = 'test test test';
      const query = 'test';
      const result = highlightText(text, query);
      
      const { container } = render(<div>{result}</div>);
      const highlighted = container.querySelectorAll('span');
      
      expect(highlighted.length).toBe(3);
    });

    it('should handle special regex characters in query', () => {
      const text = 'File (copy).txt';
      const query = '(copy)';
      const result = highlightText(text, query);
      
      const { container } = render(<div>{result}</div>);
      const highlighted = container.querySelector('span');
      
      expect(highlighted).toHaveTextContent('(copy)');
    });
  });
});
