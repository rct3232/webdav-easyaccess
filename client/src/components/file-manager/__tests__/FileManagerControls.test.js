/**
 * FileManagerControls tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FileManagerControls.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FileManagerControls from '../FileManagerControls';
import { VIEW_MODES, SORT_MODES } from '../../../constants/fileManager';

const defaultProps = {
  isMobile: false,
  selectionMode: false,
  handleSelectAll: jest.fn(),
  handleDeselectAll: jest.fn(),
  selectedFiles: new Set(),
  sortMode: SORT_MODES.NAME_ASC,
  setSortMode: jest.fn(),
  viewMode: VIEW_MODES.LIST,
  setViewMode: jest.fn(),
};

const bulkActionProps = {
  handleBulkMove: jest.fn(),
  handleBulkCopy: jest.fn(),
  handleBulkDownload: jest.fn(),
  openBulkDeleteDialog: jest.fn(),
  bulkWritePermission: true,
  hasReadOnlyInSelection: false,
  bulkActionsDisabled: false,
  downloadOnly: false,
};

describe('FileManagerControls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders sort button', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} />);
    expect(screen.getByTitle(/sort/i)).toBeInTheDocument();
  });

  it('opens the sort menu from local control state', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} />);

    fireEvent.click(screen.getByTitle(/sort/i));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
  });

  it('shows select all and deselect all when selectionMode', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} selectionMode />);
    expect(screen.getAllByText(/select all/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/deselect all/i).length).toBeGreaterThan(0);
  });

  it('calls handleSelectAll when select all clicked', () => {
    const handleSelectAll = jest.fn();
    renderWithProviders(
      <FileManagerControls {...defaultProps} selectionMode handleSelectAll={handleSelectAll} />
    );
    fireEvent.click(screen.getAllByText(/select all/i)[0]);
    expect(handleSelectAll).toHaveBeenCalledTimes(1);
  });

  it('calls handleDeselectAll when deselect all clicked', () => {
    const handleDeselectAll = jest.fn();
    renderWithProviders(
      <FileManagerControls {...defaultProps} selectionMode handleDeselectAll={handleDeselectAll} />
    );
    fireEvent.click(screen.getAllByText(/deselect all/i)[0]);
    expect(handleDeselectAll).toHaveBeenCalledTimes(1);
  });

  it('shows view mode buttons when !selectionMode', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} />);
    const viewButtons = screen.getAllByTitle(/list view|grid view|detail view/i);
    expect(viewButtons.length).toBeGreaterThan(0);
  });

  it('calls setViewMode when view mode button clicked', () => {
    const setViewMode = jest.fn();
    renderWithProviders(<FileManagerControls {...defaultProps} setViewMode={setViewMode} />);
    fireEvent.click(screen.getByTitle(/grid/i));
    expect(setViewMode).toHaveBeenCalledWith(VIEW_MODES.GRID);
  });

  it('shows detail view option on desktop', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} isMobile={false} />);
    expect(screen.getByTitle(/detail/i)).toBeInTheDocument();
  });

  it('disables selection actions when selectionActionsDisabled', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectionActionsDisabled
        {...bulkActionProps}
      />
    );
    const selectAllBtns = screen.getAllByText(/select all/i);
    expect(selectAllBtns[0].closest('button')).toBeDisabled();
  });

  it('hides sort button when selectionMode', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
      />
    );
    expect(screen.queryByTitle(/sort/i)).not.toBeInTheDocument();
  });

  it('hides view mode buttons when selectionMode', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
      />
    );
    expect(screen.queryByTitle(/list view/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/grid view/i)).not.toBeInTheDocument();
  });

  it('shows move, copy, download, delete when selectionMode with bulk handlers', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
      />
    );
    expect(screen.getByTitle(/move/i)).toBeInTheDocument();
    expect(screen.getByTitle(/copy/i)).toBeInTheDocument();
    expect(screen.getByTitle(/download/i)).toBeInTheDocument();
    expect(screen.getByTitle(/delete/i)).toBeInTheDocument();
  });

  it('hides move, copy, delete when selectionMode and downloadOnly', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        downloadOnly
      />
    );
    expect(screen.queryByTitle(/move/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/copy/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/delete/i)).not.toBeInTheDocument();
    expect(screen.getByTitle(/download/i)).toBeInTheDocument();
  });

  it('calls handleBulkMove when move clicked', () => {
    const handleBulkMove = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        handleBulkMove={handleBulkMove}
      />
    );
    fireEvent.click(screen.getByTitle(/move/i));
    expect(handleBulkMove).toHaveBeenCalledTimes(1);
  });

  it('calls handleBulkCopy when copy clicked', () => {
    const handleBulkCopy = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        handleBulkCopy={handleBulkCopy}
      />
    );
    fireEvent.click(screen.getByTitle(/copy/i));
    expect(handleBulkCopy).toHaveBeenCalledTimes(1);
  });

  it('calls handleBulkDownload when download clicked', () => {
    const handleBulkDownload = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        handleBulkDownload={handleBulkDownload}
      />
    );
    fireEvent.click(screen.getByTitle(/download/i));
    expect(handleBulkDownload).toHaveBeenCalledTimes(1);
  });

  it('calls openBulkDeleteDialog with file paths when delete clicked', () => {
    const openBulkDeleteDialog = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt', '/b.txt'])}
        {...bulkActionProps}
        openBulkDeleteDialog={openBulkDeleteDialog}
      />
    );
    fireEvent.click(screen.getByTitle(/delete/i));
    expect(openBulkDeleteDialog).toHaveBeenCalledWith(['/a.txt', '/b.txt']);
  });

  it('disables bulk action buttons when bulkActionsDisabled', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        bulkActionsDisabled
      />
    );
    expect(screen.getByTitle(/move/i).closest('button')).toBeDisabled();
    expect(screen.getByTitle(/copy/i).closest('button')).toBeDisabled();
    expect(screen.getByTitle(/download/i).closest('button')).toBeDisabled();
    expect(screen.getByTitle(/delete/i).closest('button')).toBeDisabled();
  });

  it('disables move and delete when bulkWritePermission is false', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        bulkWritePermission={false}
      />
    );
    expect(screen.getByTitle(/move/i).closest('button')).toBeDisabled();
    expect(screen.getByTitle(/delete/i).closest('button')).toBeDisabled();
  });

  it('shows read-only warning when hasReadOnlyInSelection', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set(['/a.txt'])}
        {...bulkActionProps}
        hasReadOnlyInSelection
      />
    );
    expect(screen.getByText(/read-only|selection/i)).toBeInTheDocument();
  });

  it('openBulkDeleteDialog not called when selectedFiles empty', () => {
    const openBulkDeleteDialog = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set()}
        {...bulkActionProps}
        openBulkDeleteDialog={openBulkDeleteDialog}
      />
    );
    const deleteBtn = screen.getByTitle(/delete/i);
    fireEvent.click(deleteBtn);
    expect(openBulkDeleteDialog).not.toHaveBeenCalled();
  });
});

describe('FileManagerControls collections sort surface (P-2)', () => {
  const collectionsProps = (overrides = {}) => ({
    ...defaultProps,
    sortSurface: 'collections',
    collectionSort: 'activity',
    onCollectionSortChange: jest.fn(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the same toolbar sort trigger on the collections surface', () => {
    renderWithProviders(<FileManagerControls {...collectionsProps()} />);
    expect(screen.getByTestId('file-manager-sort')).toBeInTheDocument();
  });

  it('renders the five server sort options with the current sort selected and no radio groups', () => {
    renderWithProviders(<FileManagerControls {...collectionsProps()} collectionSort="updated" />);
    fireEvent.click(screen.getByTestId('file-manager-sort'));

    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
    ['Activity', 'Name', 'Created', 'Updated', 'Similar'].forEach((label) => {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
    });
    expect(screen.getByTestId('collections-sort-option-updated')).toHaveClass('Mui-selected');
    expect(screen.getByTestId('collections-sort-option-activity')).not.toHaveClass('Mui-selected');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('dispatches onCollectionSortChange with the option value and closes the menu', () => {
    const props = collectionsProps();
    renderWithProviders(<FileManagerControls {...props} />);
    fireEvent.click(screen.getByTestId('file-manager-sort'));
    fireEvent.click(screen.getByTestId('collections-sort-option-similar'));

    expect(props.onCollectionSortChange).toHaveBeenCalledWith('similar');
    expect(props.setSortMode).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('files surface keeps the four radio options and dispatches setSortMode only', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} />);
    fireEvent.click(screen.getByTestId('file-manager-sort'));

    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.queryByTestId('collections-sort-option-name')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(defaultProps.setSortMode).toHaveBeenCalledWith(SORT_MODES.NAME_DESC);
    expect(defaultProps.onCollectionSortChange).toBeUndefined;
  });
});

describe('trash mode (DEF-16 P9)', () => {
  const trashBulkProps = {
    handleBulkRestore: jest.fn(),
    handleBulkPurge: jest.fn(),
  };

  it('selection toolbar shows restore/purge and hides move/copy/download/delete', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set([1, 2])}
        {...bulkActionProps}
        {...trashBulkProps}
        trashMode
      />
    );
    expect(screen.getByTestId('trash-bulk-restore')).toBeInTheDocument();
    expect(screen.getByTestId('trash-bulk-purge')).toBeInTheDocument();
    expect(screen.queryByTestId('bulk-action-move')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-action-copy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-action-download')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-action-delete')).not.toBeInTheDocument();
  });

  it('passes the selected node ids to the trash handlers', () => {
    const handleBulkRestore = jest.fn();
    const handleBulkPurge = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set([3, 4])}
        handleBulkRestore={handleBulkRestore}
        handleBulkPurge={handleBulkPurge}
        trashMode
      />
    );
    fireEvent.click(screen.getByTestId('trash-bulk-restore'));
    fireEvent.click(screen.getByTestId('trash-bulk-purge'));
    expect(handleBulkRestore).toHaveBeenCalledWith([3, 4]);
    expect(handleBulkPurge).toHaveBeenCalledWith([3, 4]);
  });

  it('disables restore/purge without bulk write permission', () => {
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        selectionMode
        selectedFiles={new Set([1])}
        {...trashBulkProps}
        trashMode
        bulkWritePermission={false}
      />
    );
    expect(screen.getByTestId('trash-bulk-restore')).toBeDisabled();
    expect(screen.getByTestId('trash-bulk-purge')).toBeDisabled();
  });

  it('renders the empty-trash icon when onEmptyTrash is provided and triggers it', () => {
    const onEmptyTrash = jest.fn();
    renderWithProviders(
      <FileManagerControls {...defaultProps} trashMode onEmptyTrash={onEmptyTrash} />
    );
    fireEvent.click(screen.getByTestId('trash-empty'));
    expect(onEmptyTrash).toHaveBeenCalledTimes(1);
  });

  it('omits the empty-trash icon when onEmptyTrash is not provided', () => {
    renderWithProviders(<FileManagerControls {...defaultProps} trashMode />);
    expect(screen.queryByTestId('trash-empty')).not.toBeInTheDocument();
  });
});

describe('FileManagerControls AI-platform bulk entries (BulkActionToolbar §3)', () => {
  const selection = { selectionMode: true, selectedFiles: new Set(['/a.txt', '/b.txt']) };

  beforeEach(() => jest.clearAllMocks());

  it('renders bulk-collection-add when onBulkAddToCollection is provided and passes the selection', () => {
    const onBulkAddToCollection = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        {...selection}
        onBulkAddToCollection={onBulkAddToCollection}
      />
    );

    fireEvent.click(screen.getByTestId('bulk-collection-add'));
    expect(onBulkAddToCollection).toHaveBeenCalledWith(['/a.txt', '/b.txt']);
  });

  it('hides the new entry in share-link (downloadOnly) and trash modes; absent without callback', () => {
    const onBulkAddToCollection = jest.fn();
    const { unmount } = renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        {...selection}
        downloadOnly
        onBulkAddToCollection={onBulkAddToCollection}
      />
    );
    expect(screen.queryByTestId('bulk-collection-add')).not.toBeInTheDocument();
    unmount();

    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        {...selection}
        trashMode
        onBulkAddToCollection={onBulkAddToCollection}
      />
    );
    expect(screen.queryByTestId('bulk-collection-add')).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<FileManagerControls {...defaultProps} {...selection} />);
    expect(screen.queryByTestId('bulk-collection-add')).not.toBeInTheDocument();
  });

  it('memberMode swaps the file actions: no move/copy/download/delete buttons render', () => {
    renderWithProviders(
      <FileManagerControls {...defaultProps} {...selection} {...bulkActionProps} memberMode />
    );

    expect(screen.queryByTestId('bulk-action-move')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-action-copy')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-action-download')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bulk-action-delete')).not.toBeInTheDocument();
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
  });

  it('memberMode offers batch exclude + Add to another collection launchers', () => {
    const onBulkMemberExclude = jest.fn();
    const onBulkAddToCollection = jest.fn();
    renderWithProviders(
      <FileManagerControls
        {...defaultProps}
        {...selection}
        memberMode
        onBulkMemberExclude={onBulkMemberExclude}
        onBulkAddToCollection={onBulkAddToCollection}
      />
    );

    fireEvent.click(screen.getByTestId('bulk-member-exclude'));
    expect(onBulkMemberExclude).toHaveBeenCalledWith(['/a.txt', '/b.txt']);
    fireEvent.click(screen.getByTestId('bulk-collection-add'));
    expect(onBulkAddToCollection).toHaveBeenCalledWith(['/a.txt', '/b.txt']);
  });
});
