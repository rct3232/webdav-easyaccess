/**
 * CollectionsSection tests.
 * @see docs/spec/client/components/folder-tree/CollectionsSection.md (§2.7)
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import CollectionsSection from '../CollectionsSection';

const collectionRow = (overrides = {}) => ({
  collection_id: 1,
  name: 'Roadtrip',
  item_count: 12,
  origin: 'user',
  status: 'active',
  granted_role: null,
  pinned: false,
  pinned_by: null,
  created_at: '2026-09-01T00:00:00Z',
  ...overrides,
});

const defaultProps = () => ({
  collectionsExpanded: true,
  onCollectionsToggle: jest.fn(),
  onCollectionsClick: jest.fn(),
  collections: [collectionRow()],
  archiveCount: 0,
  currentPath: '/',
  onCollectionClick: jest.fn(),
  onArchiveClick: jest.fn(),
  newCollectionIds: [],
});

describe('CollectionsSection', () => {
  it('header row renders the localized section title', () => {
    renderWithProviders(<CollectionsSection {...defaultProps()} />);
    expect(screen.getByText('Collections')).toBeInTheDocument();
  });

  it('header click invokes onCollectionsClick and chevron click invokes onCollectionsToggle', () => {
    const props = defaultProps();
    renderWithProviders(<CollectionsSection {...props} />);
    fireEvent.click(screen.getByText('Collections'));
    expect(props.onCollectionsClick).toHaveBeenCalledTimes(1);
    expect(props.onCollectionsToggle).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('collections-toggle'));
    expect(props.onCollectionsToggle).toHaveBeenCalledTimes(1);
  });

  it('renders collection rows in the GIVEN order without re-sorting (depth-1, §3.1)', () => {
    const props = defaultProps();
    props.collections = [
      collectionRow({ collection_id: 3, name: 'Zebra' }),
      collectionRow({ collection_id: 1, name: 'Alpha' }),
      collectionRow({ collection_id: 2, name: 'Mango', pinned: true, pinned_by: 'user' }),
    ];
    const { container } = renderWithProviders(<CollectionsSection {...props} />);
    const names = Array.from(container.querySelectorAll('[data-testid^="collection-row-"]')).map(
      (el) => el.getAttribute('data-testid')
    );
    expect(names).toEqual([
      'collection-row-3',
      'collection-row-1',
      'collection-row-2', // pinned rows keep server order (gravity, not hoisting)
    ]);
    expect(screen.getByText('Zebra')).toBeInTheDocument();
    expect(screen.getByText('Mango')).toBeInTheDocument();
  });

  it('shows item_count on each row', () => {
    renderWithProviders(<CollectionsSection {...defaultProps()} />);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('granted_role rows get the shared chip only and are never hoisted', () => {
    const props = defaultProps();
    props.collections = [
      collectionRow({ collection_id: 1, name: 'Mine' }),
      collectionRow({ collection_id: 2, name: 'Received', granted_role: 'viewer' }),
    ];
    renderWithProviders(<CollectionsSection {...props} />);
    expect(screen.getByTestId('collection-shared-chip-2')).toBeInTheDocument();
    expect(screen.queryByTestId('collection-shared-chip-1')).not.toBeInTheDocument();
    const rows = document.querySelectorAll('[data-testid^="collection-row-"]');
    expect(rows[0].getAttribute('data-testid')).toBe('collection-row-1');
    expect(rows[1].getAttribute('data-testid')).toBe('collection-row-2');
  });

  it('row click invokes onCollectionClick with the collection id', () => {
    const props = defaultProps();
    renderWithProviders(<CollectionsSection {...props} />);
    fireEvent.click(screen.getByTestId('collection-row-1'));
    expect(props.onCollectionClick).toHaveBeenCalledWith(1);
  });

  it('row is selected when currentPath equals its collection route', () => {
    const props = defaultProps();
    props.currentPath = '/__collections__/collection/1';
    const { container } = renderWithProviders(<CollectionsSection {...props} />);
    expect(container.querySelector('[data-testid="collection-row-1"].Mui-selected')).toBeTruthy();
  });

  it('header is selected when currentPath equals /__collections__', () => {
    const props = defaultProps();
    props.currentPath = '/__collections__';
    const { container } = renderWithProviders(<CollectionsSection {...props} />);
    expect(container.querySelector('[data-testid="collections-section"].Mui-selected')).toBeTruthy();
  });

  it('ArchiveNode always renders while expanded — even at archiveCount 0 (§2.3 T0.4 decision)', () => {
    const props = defaultProps();
    props.archiveCount = 0;
    renderWithProviders(<CollectionsSection {...props} />);
    expect(screen.getByTestId('collections-archive-node')).toBeInTheDocument();
    expect(screen.getByText('Archive')).toBeInTheDocument();
  });

  it('ArchiveNode shows the badge only above zero and is last in the section', () => {
    const props = defaultProps();
    props.collections = [
      collectionRow({ collection_id: 1 }),
      collectionRow({ collection_id: 2, name: 'Second' }),
    ];
    props.archiveCount = 3;
    const { container } = renderWithProviders(<CollectionsSection {...props} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    const rows = container.querySelectorAll('.MuiListItem-root');
    expect(rows[rows.length - 1].querySelector('[data-testid="collections-archive-node"]')).toBeTruthy();
  });

  it('ArchiveNode click invokes onArchiveClick and selects on its route', () => {
    const props = defaultProps();
    renderWithProviders(<CollectionsSection {...props} />);
    fireEvent.click(screen.getByTestId('collections-archive-node'));
    expect(props.onArchiveClick).toHaveBeenCalledTimes(1);

    const selected = defaultProps();
    selected.currentPath = '/__collections__/__archive__';
    const { container } = renderWithProviders(<CollectionsSection {...selected} />);
    expect(
      container.querySelector('[data-testid="collections-archive-node"].Mui-selected')
    ).toBeTruthy();
  });

  it('new dots render exactly for newCollectionIds and follow prop changes only', () => {
    const props = defaultProps();
    props.collections = [collectionRow({ collection_id: 1 }), collectionRow({ collection_id: 2 })];
    const { rerender } = renderWithProviders(<CollectionsSection {...props} newCollectionIds={[2]} />);
    expect(screen.getByTestId('collection-new-dot-2')).toBeInTheDocument();
    expect(screen.queryByTestId('collection-new-dot-1')).not.toBeInTheDocument();

    rerender(<CollectionsSection {...props} newCollectionIds={[]} />);
    expect(screen.queryByTestId('collection-new-dot-2')).not.toBeInTheDocument();
  });

  it('empty list renders header + empty hint + always-present ArchiveNode', () => {
    const props = defaultProps();
    props.collections = [];
    renderWithProviders(<CollectionsSection {...props} />);
    expect(screen.getByText('No collections yet')).toBeInTheDocument();
    expect(screen.getByTestId('collections-archive-node')).toBeInTheDocument();
  });

  it('collapses rows when collectionsExpanded is false', () => {
    const props = defaultProps();
    props.collectionsExpanded = false;
    renderWithProviders(<CollectionsSection {...props} />);
    expect(screen.queryByTestId('collection-row-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('collections-archive-node')).not.toBeInTheDocument();
  });
});
