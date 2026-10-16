/**
 * AddToCollectionMenu tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/AddToCollectionMenu.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import AddToCollectionMenu from '../AddToCollectionMenu';
import { previewCollection } from '../../../services/collectionsRepository';

jest.mock('../../../services/collectionsRepository', () => ({
  previewCollection: jest.fn(),
}));

const collections = [
  { collection_id: 1, name: 'Europe trip', item_count: 4, origin: 'user', granted_role: 'owner' },
  {
    collection_id: 2,
    name: 'System picks',
    item_count: 9,
    origin: 'system',
    granted_role: 'editor',
  },
];

const singleTarget = [{ nodeId: 90210, name: 'beach.jpg' }];

const defaultProps = {
  open: true,
  anchorEl: null,
  targetNodes: singleTarget,
  collections,
  membershipIds: [],
  onAdd: jest.fn(),
  onCreateAndAdd: jest.fn(),
  onCreateSeed: jest.fn(),
  onClose: jest.fn(),
};

describe('AddToCollectionMenu submenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    previewCollection.mockResolvedValue({ count: 0, sample: [], sample_truncated: false });
  });

  it('renders writable collection rows with the NAME ONLY — no item-count secondary (F1, ex-M-1 straggler)', () => {
    renderWithProviders(<AddToCollectionMenu {...defaultProps} />);

    expect(screen.getByTestId('collection-option-1')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('collection-option-1')).getByText('Europe trip')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('collection-option-1')).queryByText('4')
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('collection-option-2')).queryByText('9')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('collection-option-2')).toBeInTheDocument();
    expect(previewCollection).not.toHaveBeenCalled();
  });

  it('long collection names MIDDLE-truncate inside the FIXED-width menu paper (F1)', () => {
    const longName = 'extremely-descriptive-vacation-photo-archive-file.png';
    renderWithProviders(
      <AddToCollectionMenu
        {...defaultProps}
        collections={[
          {
            collection_id: 7,
            name: longName,
            item_count: 3,
            origin: 'user',
            granted_role: 'owner',
          },
        ]}
      />
    );

    const shown = screen.getByTestId('collection-option-7').textContent;
    expect(shown.length).toBeLessThan(longName.length);
    expect(shown).toContain('...');
    expect(shown.startsWith('extremely-')).toBe(true);
    expect(shown.endsWith(longName.slice(-6))).toBe(true);

    const paper = document.querySelector('.MuiPopover-paper');
    expect(window.getComputedStyle(paper).width).toBe('280px');
  });

  it('short collection names render VERBATIM at the fixed menu width (F1)', () => {
    renderWithProviders(<AddToCollectionMenu {...defaultProps} />);
    expect(
      within(screen.getByTestId('collection-option-1')).getByText('Europe trip')
    ).toBeInTheDocument();
    expect(screen.getByText('System picks')).toBeInTheDocument();
  });

  it('checkmarks membership rows from prop data without extra network calls', () => {
    renderWithProviders(<AddToCollectionMenu {...defaultProps} membershipIds={[2]} />);

    expect(screen.getByTestId('collection-checked-2')).toBeInTheDocument();
    expect(screen.queryByTestId('collection-checked-1')).not.toBeInTheDocument();
    expect(previewCollection).not.toHaveBeenCalled();
  });

  it('clicking a collection row adds all target node ids then closes', () => {
    renderWithProviders(<AddToCollectionMenu {...defaultProps} />);

    fireEvent.click(screen.getByTestId('collection-option-1'));
    expect(defaultProps.onAdd).toHaveBeenCalledWith(1, [90210]);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('multi-select passes every selected node id', () => {
    renderWithProviders(
      <AddToCollectionMenu
        {...defaultProps}
        targetNodes={[
          { nodeId: 1, name: 'a.jpg' },
          { nodeId: 2, name: 'b.jpg' },
        ]}
      />
    );

    fireEvent.click(screen.getByTestId('collection-option-2'));
    expect(defaultProps.onAdd).toHaveBeenCalledWith(2, [1, 2]);
  });

  it('zero writable collections: only the inline New collection row remains', () => {
    renderWithProviders(<AddToCollectionMenu {...defaultProps} collections={[]} />);

    expect(screen.queryAllByTestId(/^collection-option-/)).toHaveLength(0);
    expect(screen.getByTestId('new-collection-row')).toBeInTheDocument();
  });

  it('inline New collection validates the name before chaining create→add', async () => {
    renderWithProviders(<AddToCollectionMenu {...defaultProps} />);

    fireEvent.click(screen.getByTestId('new-collection-row'));
    const input = screen.getByTestId('new-collection-input');

    fireEvent.change(input, { target: { value: 'bad/name' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(defaultProps.onCreateAndAdd).not.toHaveBeenCalled();
    expect(screen.getByTestId('new-collection-error')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Summer 2026' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(defaultProps.onCreateAndAdd).toHaveBeenCalledWith('Summer 2026', [90210]);
    });
  });

  it('seed row is ABSENT-not-disabled when seedItemVisible=false (spec default: true)', () => {
    const { rerender } = renderWithProviders(
      <AddToCollectionMenu {...defaultProps} seedItemVisible={false} />
    );
    expect(screen.queryByTestId('seed-create-row')).not.toBeInTheDocument();

    rerender(<AddToCollectionMenu {...defaultProps} seedItemVisible />);
    expect(screen.getByTestId('seed-create-row')).toBeInTheDocument();
  });

  it('member-row invocation behaves identically (same component, same rows)', () => {
    renderWithProviders(
      <AddToCollectionMenu {...defaultProps} targetNodes={[{ nodeId: 55, name: 'member.jpg' }]} />
    );

    fireEvent.click(screen.getByTestId('collection-option-1'));
    expect(defaultProps.onAdd).toHaveBeenCalledWith(1, [55]);
  });
});

describe('AddToCollectionMenu seed dialog (§4.5)', () => {
  const seedPreview = {
    count: 20,
    sample: Array.from({ length: 12 }, (_, i) => ({ node_id: 900 + i, name: `p${i}.jpg` })),
    sample_truncated: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    previewCollection.mockResolvedValue(seedPreview);
  });

  const openSeedDialog = async () => {
    renderWithProviders(<AddToCollectionMenu {...defaultProps} seedItemVisible />);
    fireEvent.click(screen.getByTestId('seed-create-row'));
    await waitFor(() => expect(screen.getByTestId('seed-dialog')).toBeInTheDocument());
  };

  it('opens the confirm dialog with the seed file and a prefilled template name', async () => {
    await openSeedDialog();

    expect(screen.getByText('beach.jpg')).toBeInTheDocument();
    expect(screen.getByTestId('seed-name-input')).toHaveValue('beach.jpg and similar files');
  });

  it('long sample names render MIDDLE-truncated — leading + trailing fragments (M-6)', async () => {
    const longName = 'extremely-descriptive-vacation-photo-archive-file.png';
    previewCollection.mockResolvedValueOnce({
      count: 1,
      sample: [{ node_id: 977, name: longName }],
      sample_truncated: false,
    });
    await openSeedDialog();

    const tile = screen.getByTestId('seed-sample-tile');
    const shown = tile.textContent;
    expect(shown.length).toBeLessThan(longName.length);
    expect(shown).toContain('...');
    expect(shown.startsWith('extremely-')).toBe(true);
    expect(shown.endsWith(longName.slice(-6))).toBe(true);
  });

  it('loads the member sample via POST /collections/preview with plus N more and the publish notice', async () => {
    await openSeedDialog();

    await waitFor(() => expect(previewCollection).toHaveBeenCalledWith({ seedNodeId: 90210 }));
    expect(screen.getAllByTestId('seed-sample-tile')).toHaveLength(12);
    expect(screen.getByTestId('seed-more-counter')).toHaveTextContent('plus 8 more');
    expect(screen.getByTestId('seed-publish-notice')).toBeInTheDocument();
  });

  it('keeps Create disabled until the preview resolves, then submits {name, seedNodeId}', async () => {
    await openSeedDialog();

    const submit = screen.getByTestId('seed-create-confirm');
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    expect(defaultProps.onCreateSeed).toHaveBeenCalledWith({
      name: 'beach.jpg and similar files',
      seedNodeId: 90210,
    });
    expect(screen.queryByTestId('seed-dialog')).not.toBeInTheDocument();
  });

  it('shows skeletons while the preview is in flight', () => {
    previewCollection.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<AddToCollectionMenu {...defaultProps} seedItemVisible />);
    fireEvent.click(screen.getByTestId('seed-create-row'));

    expect(screen.getByTestId('seed-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('seed-sample-skeleton')).toBeInTheDocument();
  });
});

describe('AddToCollectionMenu set-target mode (targetNodeIds)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    previewCollection.mockResolvedValue({ count: 0, sample: [], sample_truncated: false });
  });

  const setProps = (overrides = {}) => ({
    ...defaultProps,
    targetNodes: [],
    targetNodeIds: new Set([5, 11, 12]),
    membershipIds: [1],
    ...overrides,
  });

  it('onAdd receives the FULL provided id set', () => {
    const props = setProps();
    renderWithProviders(<AddToCollectionMenu {...props} />);

    fireEvent.click(screen.getByTestId('collection-option-1'));
    expect(props.onAdd).toHaveBeenCalledWith(1, [5, 11, 12]);
  });

  it('inline create chains the FULL id set through onCreateAndAdd', () => {
    const props = setProps();
    renderWithProviders(<AddToCollectionMenu {...props} />);

    fireEvent.click(screen.getByTestId('new-collection-row'));
    fireEvent.change(screen.getByTestId('new-collection-input'), {
      target: { value: 'Snapshot picks' },
    });
    fireEvent.keyDown(screen.getByTestId('new-collection-input'), { key: 'Enter' });

    expect(props.onCreateAndAdd).toHaveBeenCalledWith('Snapshot picks', [5, 11, 12]);
  });

  it('the seed row is ABSENT in set mode even with seedItemVisible (no single-file seed)', () => {
    renderWithProviders(
      <AddToCollectionMenu {...setProps({ targetNodes: singleTarget })} seedItemVisible />
    );

    expect(screen.queryByTestId('seed-create-row')).not.toBeInTheDocument();
  });

  it('checkmarks reflect the set via membershipIds without extra network calls', () => {
    renderWithProviders(<AddToCollectionMenu {...setProps()} />);

    expect(screen.getByTestId('collection-checked-1')).toBeInTheDocument();
    expect(screen.queryByTestId('collection-checked-2')).not.toBeInTheDocument();
    expect(previewCollection).not.toHaveBeenCalled();
  });
});
