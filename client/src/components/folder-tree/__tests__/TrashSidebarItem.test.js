/**
 * TrashSidebarItem tests.
 * Verifies the bottom-pinned sidebar trash row per spec:
 * docs/spec/client/components/folder-tree/TrashSidebarItem.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import TrashSidebarItem from '../TrashSidebarItem';
import { notifyTrashChanged } from '../../../services/trashNotifier';

const defaultProps = {
  currentPath: '/',
  onTrashClick: jest.fn(),
};

describe('TrashSidebarItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the nav.trash label with the trash icon test id', () => {
    renderWithProviders(<TrashSidebarItem {...defaultProps} />);
    expect(screen.getByTestId('sidebar-trash')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-trash-icon')).toBeInTheDocument();
    expect(screen.getByText('Trash')).toBeInTheDocument();
  });

  it('click invokes onTrashClick', () => {
    renderWithProviders(<TrashSidebarItem {...defaultProps} />);
    fireEvent.click(screen.getByRole('button'));
    expect(defaultProps.onTrashClick).toHaveBeenCalledTimes(1);
  });

  it('applies the selected state when currentPath is /__trash__', () => {
    const { rerender } = renderWithProviders(<TrashSidebarItem {...defaultProps} />);
    expect(screen.getByTestId('sidebar-trash').querySelector('.Mui-selected')).toBeNull();

    rerender(<TrashSidebarItem {...defaultProps} currentPath="/__trash__" />);
    expect(screen.getByTestId('sidebar-trash').querySelector('.Mui-selected')).not.toBeNull();
  });

  it('plays one animation pulse per trash-change notification', () => {
    renderWithProviders(<TrashSidebarItem {...defaultProps} />);
    const icon = screen.getByTestId('sidebar-trash-icon');
    const staticClassName = icon.className;

    act(() => {
      notifyTrashChanged();
    });

    // The animated state re-renders with a new emotion class carrying the
    // one-shot keyframes, and the lid path is present for the lid rotation.
    const animated = screen.getByTestId('sidebar-trash-icon');
    expect(animated.className).not.toBe(staticClassName);
    expect(animated.querySelector('.trash-lid')).not.toBeNull();
  });
});
