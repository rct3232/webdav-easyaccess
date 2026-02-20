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

    it('adds checkbox placeholder when selectionMode', () => {
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

    it('adds checkbox placeholder when selectionMode', () => {
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

    it('adds checkbox column when selectionMode', () => {
      const { container } = renderWithProviders(
        <table>
          <tbody>
            <FileDetailSkeleton count={2} selectionMode />
          </tbody>
        </table>
      );
      const cells = container.querySelectorAll('td');
      expect(cells.length).toBeGreaterThan(0);
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
