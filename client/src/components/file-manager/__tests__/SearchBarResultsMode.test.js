/**
 * SearchBarResultsMode tests.
 * @see docs/spec/client/components/file-manager/SearchBarResultsMode.md
 */
import React from 'react';
import { screen, fireEvent, within } from '@testing-library/react';

import { renderWithProviders } from '../../../test-utils';
import SearchBarResultsMode from '../SearchBarResultsMode';

const NAME_ROWS = [
  {
    node_id: 11,
    name: 'Fun-MOVIE-notes.pdf',
    highlights: [{ start: 4, end: 9 }],
  },
  { node_id: 12, name: 'movie-night.jpg', highlights: [] },
];

const SEMANTIC_ROWS = [{ node_id: 90, name: 'fantasy-movie-night.jpg', score: 0.71 }];

const CHIPS = [
  { id: 'movie', query: 'movie', resultRef: 'sr1.a' },
  { id: 'sig', query: 'sig' },
];

const defaultProps = {
  query: 'movie',
  counts: { total: 2 },
  sections: { nameMatches: NAME_ROWS, semantic: [] },
  canSaveToCollection: false,
  onExit: jest.fn(),
  onFilterChange: jest.fn(),
  recentQueries: CHIPS,
  onChipSelect: jest.fn(),
  onChipSave: jest.fn(),
  onSave: jest.fn(),
};

function renderResults(props = {}) {
  return renderWithProviders(<SearchBarResultsMode {...defaultProps} {...props} />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SearchBarResultsMode header', () => {
  it('renders the quoted query, the server count and the exit button', () => {
    renderResults();

    expect(screen.getByTestId('search-results-mode')).toBeInTheDocument();
    expect(screen.getByText('"movie"')).toBeInTheDocument();
    expect(screen.getByTestId('search-results-count')).toHaveTextContent('2 results');
    expect(screen.getByTestId('search-results-exit')).toBeInTheDocument();
  });

  it('keeps the server count when the inline filter shrinks the displayed rows', () => {
    renderResults({ sections: { nameMatches: [NAME_ROWS[0]], semantic: [] } });

    expect(screen.getByTestId('search-results-count')).toHaveTextContent('2 results');
  });

  it('shows exactly one save button only when canSaveToCollection is true', () => {
    const first = renderResults();
    expect(screen.queryByTestId('search-results-save')).not.toBeInTheDocument();
    first.unmount();

    const second = renderResults({ canSaveToCollection: true });
    expect(screen.getAllByTestId('search-results-save')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('search-results-save'));
    expect(defaultProps.onSave).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it('invokes onExit from the close button', () => {
    renderResults();

    fireEvent.click(screen.getByTestId('search-results-exit'));
    expect(defaultProps.onExit).toHaveBeenCalledTimes(1);
  });
});

describe('SearchBarResultsMode sections', () => {
  it('renders name-section rows with client-side highlight spans only', () => {
    renderResults();

    const rows = screen.getAllByTestId('search-result-row');
    expect(rows).toHaveLength(2);

    const highlighted = within(rows[0]).getByTestId('search-highlight-range');
    expect(highlighted).toHaveTextContent('MOVIE');
    expect(within(rows[1]).queryByTestId('search-highlight-range')).not.toBeInTheDocument();
  });

  it('renders the semantic section score-free and without highlights', () => {
    renderResults({
      sections: { nameMatches: NAME_ROWS, semantic: SEMANTIC_ROWS },
      canSaveToCollection: true,
    });

    const semanticRows = screen.getAllByTestId('search-semantic-row');
    expect(semanticRows).toHaveLength(1);
    expect(semanticRows[0]).toHaveTextContent('fantasy-movie-night.jpg');
    expect(semanticRows[0].textContent).not.toContain('0.71');
    expect(within(semanticRows[0]).queryByTestId('search-highlight-range')).not.toBeInTheDocument();
  });

  it('renders nothing for empty sections and the no-results line when both are empty', () => {
    const withRows = renderResults({ sections: { nameMatches: NAME_ROWS, semantic: [] } });
    expect(screen.queryByTestId('search-no-results')).not.toBeInTheDocument();
    expect(screen.queryByTestId('search-semantic-row')).not.toBeInTheDocument();
    withRows.unmount();

    renderResults({ sections: { nameMatches: [], semantic: [] } });
    expect(screen.getByTestId('search-no-results')).toBeInTheDocument();
    expect(screen.queryByTestId('search-result-row')).not.toBeInTheDocument();
  });
});

describe('SearchBarResultsMode chips', () => {
  it('renders recent-query chips with a menu exposing re-search and save', () => {
    renderResults();

    const chips = screen.getAllByTestId('search-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('movie');

    fireEvent.click(within(chips[0]).getByTestId('search-chip-menu'));
    expect(screen.getByTestId('search-chip-research')).toBeInTheDocument();
    expect(screen.getByTestId('search-chip-save')).toBeInTheDocument();
  });

  it('dispatches chip actions to the host callbacks', () => {
    renderResults();

    const firstChip = screen.getAllByTestId('search-chip')[0];
    fireEvent.click(firstChip);
    expect(defaultProps.onChipSelect).toHaveBeenCalledWith(CHIPS[0]);

    // ⋮ opens the menu → save dispatches onChipSave
    fireEvent.click(within(firstChip).getByTestId('search-chip-menu'));
    fireEvent.click(screen.getByTestId('search-chip-save'));
    expect(defaultProps.onChipSave).toHaveBeenCalledWith(CHIPS[0]);
  });
});

describe('SearchBarResultsMode inline filter', () => {
  it('typing calls onFilterChange and never fetches (assert callback, not fetch)', () => {
    renderResults();

    const filter = screen.getByTestId('search-results-filter');
    fireEvent.change(filter, { target: { value: 'night' } });

    expect(defaultProps.onFilterChange).toHaveBeenCalledWith('night');
  });

  it('Enter inside the filter does not submit; re-submit stays in FloatingSearchBar', () => {
    renderResults();

    const filter = screen.getByTestId('search-results-filter');
    fireEvent.keyDown(filter, { key: 'Enter' });

    expect(defaultProps.onFilterChange).not.toHaveBeenCalled();
  });
});
