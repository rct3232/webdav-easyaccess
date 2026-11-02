/**
 * SearchSaveDialog — the §2.6 save confirm dialog (the dialog IS the batch
 * approval): member preview (count + semantic rows' names) + the batch-publish
 * copy, mirroring the seed dialog idiom.
 * @see docs/spec/client/hooks/useSearchResults.md §2.3
 * @see docs/spec/client/components/file-manager/SearchQueryChipBar.md §2.4a
 */
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import SearchSaveDialog from '../SearchSaveDialog';

const rows = [
  { node_id: 90, name: 'alpha.jpg' },
  { node_id: 91, name: 'zeta.jpg' },
  { node_id: 92, name: 'mid.jpg' },
];

const renderDialog = (props = {}) =>
  renderWithProviders(
    <SearchSaveDialog
      open
      term="banana harvest festival"
      rows={rows}
      onClose={jest.fn()}
      onConfirm={jest.fn()}
      {...props}
    />
  );

describe('SearchSaveDialog (search save confirm, §2.6)', () => {
  it('renders the member preview (semantic rows) with the batch-publish notice', async () => {
    renderDialog();

    expect(await screen.findByTestId('search-save-dialog')).toBeInTheDocument();
    expect(screen.getByText('alpha.jpg')).toBeInTheDocument();
    expect(screen.getByTestId('search-save-member-count')).toHaveTextContent('3 files');
    expect(screen.getByTestId('search-save-publish-notice')).toBeInTheDocument();
  });

  it('confirm fires onConfirm alone (the host closes the dialog); cancel closes', async () => {
    const onConfirm = jest.fn();
    const onClose = jest.fn();
    renderDialog({ onConfirm, onClose });

    fireEvent.click(screen.getByTestId('search-save-confirm'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    // the host owns the close (FileManager closes in its confirm handler)
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders plus N more when the preview is capped and stays closed when open=false', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ node_id: 100 + i, name: `f${i}.jpg` }));
    renderWithProviders(
      <SearchSaveDialog
        open={false}
        term="x"
        rows={many}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />
    );
    expect(screen.queryByTestId('search-save-dialog')).not.toBeInTheDocument();

    renderWithProviders(
      <SearchSaveDialog open term="x" rows={many} onClose={jest.fn()} onConfirm={jest.fn()} />
    );
    expect(screen.getByTestId('search-save-member-count')).toHaveTextContent('14 files');
    expect(screen.getByTestId('search-save-more-counter')).toBeInTheDocument();
  });
});
