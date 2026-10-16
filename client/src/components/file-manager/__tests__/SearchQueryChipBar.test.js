/**
 * SearchQueryChipBar tests.
 * @see docs/spec/client/components/file-manager/SearchQueryChipBar.md
 */
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '../../../test-utils';
import SearchQueryChipBar from '../SearchQueryChipBar';

function renderBar(overrides = {}) {
  const props = {
    terms: ['movie', 'pdf'],
    isMobile: false,
    onRevertToStep: jest.fn(),
    onExit: jest.fn(),
    onLibraryAdd: jest.fn(),
    ...overrides,
  };
  renderWithProviders(<SearchQueryChipBar {...props} />);
  return props;
}

describe('SearchQueryChipBar rendering', () => {
  it('renders one chip per committed term oldest→newest', () => {
    renderBar({ terms: ['first', 'second', 'third'] });

    expect(screen.getByTestId('search-chip-bar')).toBeInTheDocument();
    const chips = screen.getAllByTestId('search-chip');
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent('first');
    expect(chips[2]).toHaveTextContent('third');
  });

  it('renders nothing for an empty chain', () => {
    renderBar({ terms: [] });

    expect(screen.queryByTestId('search-chip-bar')).not.toBeInTheDocument();
  });

  it('renders the LibraryAdd button with the aria label', () => {
    renderBar();

    expect(screen.getByTestId('search-library-add')).toHaveAccessibleName(
      'Add results to collection'
    );
  });

  it('mobile: LibraryAdd occupies the expand-toggle slot (inExpandSlot)', () => {
    renderBar({ isMobile: true, inExpandSlot: true });

    expect(screen.getByTestId('search-library-add')).toBeInTheDocument();
  });
});

describe('SearchQueryChipBar reveal + activation (n >= 2)', () => {
  it('desktop: hover reveals the Undo action inside the chip; leaving restores the term', () => {
    renderBar({ terms: ['movie', 'pdf', 'notes'] });

    const chips = screen.getAllByTestId('search-chip');
    expect(chips[0]).toHaveTextContent('movie');
    expect(screen.queryByTestId('search-chip-undo')).not.toBeInTheDocument();

    fireEvent.mouseEnter(chips[0]);
    expect(chips[0]).toHaveTextContent('Undo');
    expect(screen.getByTestId('search-chip-undo')).toBeInTheDocument();

    fireEvent.mouseLeave(chips[0]);
    expect(chips[0]).toHaveTextContent('movie');
    expect(screen.queryByTestId('search-chip-undo')).not.toBeInTheDocument();
  });

  it('desktop: activating a revealed non-current chip calls onRevertToStep(i) once', () => {
    const props = renderBar({ terms: ['movie', 'pdf', 'notes'] });
    const chips = screen.getAllByTestId('search-chip');

    fireEvent.mouseEnter(chips[1]);
    fireEvent.click(screen.getByTestId('search-chip-undo'));

    expect(props.onRevertToStep).toHaveBeenCalledTimes(1);
    expect(props.onRevertToStep).toHaveBeenCalledWith(1);
    expect(props.onExit).not.toHaveBeenCalled();
  });

  it('desktop: the current chip (n-1 with n>=2) renders plain — no affordance, no reveal', () => {
    const props = renderBar({ terms: ['movie', 'pdf'] });
    const chips = screen.getAllByTestId('search-chip');

    fireEvent.mouseEnter(chips[1]);
    expect(chips[1]).toHaveTextContent('pdf');
    expect(screen.queryByTestId('search-chip-undo')).not.toBeInTheDocument();

    fireEvent.click(chips[1]);
    expect(props.onRevertToStep).not.toHaveBeenCalled();
    expect(props.onExit).not.toHaveBeenCalled();
  });

  it('mobile: first tap reveals Undo, second tap activates once', () => {
    const props = renderBar({ terms: ['movie', 'pdf'], isMobile: true });
    const chips = screen.getAllByTestId('search-chip');

    fireEvent.click(chips[0]);
    expect(props.onRevertToStep).not.toHaveBeenCalled();
    expect(chips[0]).toHaveTextContent('Undo');

    fireEvent.click(chips[0]);
    expect(props.onRevertToStep).toHaveBeenCalledTimes(1);
    expect(props.onRevertToStep).toHaveBeenCalledWith(0);
  });
});

describe('SearchQueryChipBar single-chip Exit (n === 1)', () => {
  it('hover reveals Exit + close icon; activation calls onExit, never onRevertToStep', () => {
    const props = renderBar({ terms: ['movie'] });
    const chip = screen.getByTestId('search-chip');

    fireEvent.mouseEnter(chip);
    expect(chip).toHaveTextContent('Exit');
    expect(screen.getByTestId('search-chip-exit')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('search-chip-exit'));
    expect(props.onExit).toHaveBeenCalledTimes(1);
    expect(props.onRevertToStep).not.toHaveBeenCalled();
  });

  it('mobile single chip: tap-to-reveal, second tap exits', () => {
    const props = renderBar({ terms: ['movie'], isMobile: true });
    const chip = screen.getByTestId('search-chip');

    fireEvent.click(chip);
    expect(props.onExit).not.toHaveBeenCalled();
    expect(chip).toHaveTextContent('Exit');

    fireEvent.click(chip);
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });
});

describe('SearchQueryChipBar LibraryAdd emission', () => {
  it('click emits onLibraryAdd with the anchor element and no other callback', () => {
    const props = renderBar();

    fireEvent.click(screen.getByTestId('search-library-add'));

    expect(props.onLibraryAdd).toHaveBeenCalledTimes(1);
    expect(props.onLibraryAdd.mock.calls[0][0]).toBeInstanceOf(window.HTMLElement);
    expect(props.onRevertToStep).not.toHaveBeenCalled();
    expect(props.onExit).not.toHaveBeenCalled();
  });

  it('is IO-free: no fetch/storage access from any interaction', () => {
    const fetchSpy = jest.spyOn(window, 'fetch').mockImplementation(() => {});
    const props = renderBar({ terms: ['movie'] });

    fireEvent.mouseEnter(screen.getByTestId('search-chip'));
    fireEvent.click(screen.getByTestId('search-library-add'));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);
    fetchSpy.mockRestore();
    expect(props.onLibraryAdd).toHaveBeenCalled();
  });
});

describe('SearchQueryChipBar i18n mirror literals', () => {
  it('chip Undo/Exit and the library aria label match BOTH locales exactly', () => {
    const en = require('../../../locales/en.json');
    const ko = require('../../../locales/ko.json');
    expect(en.fileManager.searchChipUndo).toBe('Undo');
    expect(ko.fileManager.searchChipUndo).toBe('돌아가기');
    expect(en.fileManager.searchChipExit).toBe('Exit');
    expect(ko.fileManager.searchChipExit).toBe('종료');
    expect(en.fileManager.searchLibraryAdd).toBe('Add results to collection');
    expect(ko.fileManager.searchLibraryAdd).toBe('결과를 컬렉션에 추가');
  });
});
