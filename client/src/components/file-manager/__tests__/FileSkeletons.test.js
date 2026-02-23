/**
 * FileSkeletons tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileSkeletons.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import {
  FileListSkeleton,
  FileGridSkeleton,
  FileDetailSkeleton,
  FileTreeSkeleton,
} from '../FileSkeletons';

jest.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false }),
}));

describe('FileSkeletons', () => {
  describe('FileListSkeleton', () => {
    it('renders grid with skeleton items', () => {
      const { container } = renderWithProviders(<FileListSkeleton count={3} />);
      const skeletons = container.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('renders skeleton items when selectionMode', () => {
      const { container } = renderWithProviders(<FileListSkeleton count={2} selectionMode />);
      const skeletons = container.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('FileGridSkeleton', () => {
    it('renders grid with card-like items', () => {
      const { container } = renderWithProviders(<FileGridSkeleton count={4} />);
      const skeletons = container.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it('applies gradual opacity: count=2 last at 50%', () => {
      const { container } = renderWithProviders(<FileGridSkeleton count={2} />);
      const grid = Array.from(container.querySelectorAll('*')).find(
        (el) => el.children?.length === 2 && getComputedStyle(el).display === 'grid'
      );
      expect(grid).toBeTruthy();
      const lastItem = grid.children[grid.children.length - 1];
      expect(getComputedStyle(lastItem).opacity).toBe('0.5');
    });

    it('applies gradual opacity: count=4 last three at 75%, 50%, 25%', () => {
      const { container } = renderWithProviders(<FileGridSkeleton count={4} />);
      const grid = Array.from(container.querySelectorAll('*')).find(
        (el) => el.children?.length === 4 && getComputedStyle(el).display === 'grid'
      );
      expect(grid).toBeTruthy();
      const items = grid.children;
      expect(getComputedStyle(items[1]).opacity).toBe('0.75');
      expect(getComputedStyle(items[2]).opacity).toBe('0.5');
      expect(getComputedStyle(items[3]).opacity).toBe('0.25');
    });

    it('applies gradual opacity: count=5 last three at 75%, 50%, 25%', () => {
      const { container } = renderWithProviders(<FileGridSkeleton count={5} />);
      const grid = Array.from(container.querySelectorAll('*')).find(
        (el) => el.children?.length === 5 && getComputedStyle(el).display === 'grid'
      );
      expect(grid).toBeTruthy();
      const items = grid.children;
      expect(getComputedStyle(items[2]).opacity).toBe('0.75');
      expect(getComputedStyle(items[3]).opacity).toBe('0.5');
      expect(getComputedStyle(items[4]).opacity).toBe('0.25');
    });

    it('renders skeleton items when selectionMode', () => {
      const { container } = renderWithProviders(<FileGridSkeleton count={2} selectionMode />);
      const skeletons = container.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('FileDetailSkeleton', () => {
    it('renders table rows', () => {
      const { container } = renderWithProviders(
        <table>
          <tbody>
            <FileDetailSkeleton count={4} />
          </tbody>
        </table>
      );
      const rows = container.querySelectorAll('tr');
      expect(rows.length).toBe(4);
    });

    it('renders table rows when selectionMode', () => {
      const { container } = renderWithProviders(
        <table>
          <tbody>
            <FileDetailSkeleton count={2} selectionMode />
          </tbody>
        </table>
      );
      const rows = container.querySelectorAll('tr');
      expect(rows.length).toBe(2);
    });
  });

  describe('FileTreeSkeleton', () => {
    it('renders indented tree items', () => {
      const { container } = renderWithProviders(<FileTreeSkeleton count={3} level={1} />);
      const boxes = container.querySelectorAll('.MuiBox-root');
      expect(boxes.length).toBeGreaterThan(0);
    });

    it('renders default count when not specified', () => {
      const { container } = renderWithProviders(<FileTreeSkeleton />);
      const skeletons = container.querySelectorAll('.MuiSkeleton-root');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });
});
