/**
 * SearchActionButton tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FloatingSearchBar.md §2.5–§2.6
 * (fab-slot ghost submit button: position math, click intents, icon composites).
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import SearchActionButton from '../SearchActionButton';

const baseProps = {
  visible: true,
  isMobile: false,
  searchQuery: '',
  onSubmitQuery: jest.fn(),
  resultsModeActive: false,
  isPending: false,
  llmConfigured: false,
};

const button = () => screen.getByTestId('search-action-button');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SearchActionButton position (FAB slot parity)', () => {
  it('sits at the desktop FAB spot as a 56px ghost circle above the pill', () => {
    renderWithProviders(<SearchActionButton {...baseProps} />);
    const style = getComputedStyle(button());
    expect(style.position).toBe('fixed');
    expect(style.bottom).toBe('48px');
    expect(style.right).toBe('48px');
    expect(style.width).toBe('56px');
    expect(style.height).toBe('56px');
    expect(style.zIndex).toBe('1050');
    expect(style.border).toBe('2px solid #52c597');
    expect(style.backgroundColor).toBe('rgba(255, 255, 255, 0.5)');
  });

  it('uses the mobile offset', () => {
    renderWithProviders(<SearchActionButton {...baseProps} isMobile />);
    const style = getComputedStyle(button());
    expect(style.bottom).toBe('16px');
    expect(style.right).toBe('16px');
  });

  it('is click-transparent while collapsed (exit-animation state)', () => {
    renderWithProviders(<SearchActionButton {...baseProps} visible={false} />);
    expect(getComputedStyle(button()).pointerEvents).toBe('none');
  });
});

describe('SearchActionButton click intents', () => {
  it('click fires onSubmitQuery with the current text', () => {
    const onSubmitQuery = jest.fn();
    renderWithProviders(
      <SearchActionButton {...baseProps} searchQuery="movie" onSubmitQuery={onSubmitQuery} />
    );
    fireEvent.click(button());
    expect(onSubmitQuery).toHaveBeenCalledTimes(1);
    expect(onSubmitQuery).toHaveBeenCalledWith('movie');
  });

  it('browse-mode empty click fires with the empty value (host decides)', () => {
    const onSubmitQuery = jest.fn();
    renderWithProviders(<SearchActionButton {...baseProps} onSubmitQuery={onSubmitQuery} />);
    fireEvent.click(button());
    expect(onSubmitQuery).toHaveBeenCalledWith('');
  });

  it('results mode + empty text: the click is a no-op (§2.6 owner ruling)', () => {
    const onSubmitQuery = jest.fn();
    renderWithProviders(
      <SearchActionButton
        {...baseProps}
        resultsModeActive
        searchQuery=""
        onSubmitQuery={onSubmitQuery}
      />
    );
    fireEvent.click(button());
    expect(onSubmitQuery).not.toHaveBeenCalled();
  });

  it('results mode + text: click is a chain submit', () => {
    const onSubmitQuery = jest.fn();
    renderWithProviders(
      <SearchActionButton
        {...baseProps}
        resultsModeActive
        searchQuery="refine"
        onSubmitQuery={onSubmitQuery}
      />
    );
    fireEvent.click(button());
    expect(onSubmitQuery).toHaveBeenCalledWith('refine');
  });

  it('without onSubmitQuery the click stays inert', () => {
    renderWithProviders(<SearchActionButton {...baseProps} onSubmitQuery={undefined} />);
    expect(() => {
      fireEvent.click(button());
    }).not.toThrow();
  });
});

describe('SearchActionButton icon states (§2.6)', () => {
  it('llmConfigured=false: composite cloud + search overlay', () => {
    renderWithProviders(<SearchActionButton {...baseProps} />);
    expect(screen.getByTestId('search-action-glyph-cloud')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-search')).toBeInTheDocument();
    expect(screen.queryByTestId('search-action-glyph-wand')).not.toBeInTheDocument();
  });

  it('llmConfigured=true: composite cloud + mirrored wand-stars', () => {
    renderWithProviders(<SearchActionButton {...baseProps} llmConfigured />);
    expect(screen.getByTestId('search-action-glyph-cloud')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-wand')).toHaveStyle({
      transform: 'scaleX(-1)',
    });
  });

  it('isPending: the glyph runs the orbit seam instead of the static composite', () => {
    renderWithProviders(<SearchActionButton {...baseProps} isPending />);
    expect(screen.getByTestId('search-action-glyph-orbit')).toBeInTheDocument();
    expect(screen.queryByTestId('search-action-glyph-cloud')).not.toBeInTheDocument();
  });

  it('isPending + llmConfigured: the orbiting glyph is the wand variant', () => {
    renderWithProviders(<SearchActionButton {...baseProps} isPending llmConfigured />);
    expect(screen.getByTestId('search-action-glyph-orbit')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-wand')).toBeInTheDocument();
  });

  it('results mode + empty text: the composite gains the Add overlay at left', () => {
    renderWithProviders(<SearchActionButton {...baseProps} resultsModeActive searchQuery="" />);
    expect(screen.getByTestId('search-action-glyph-cloud')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-add')).toBeInTheDocument();
  });

  it('results mode + non-empty text: no Add overlay (chain submit state)', () => {
    renderWithProviders(
      <SearchActionButton {...baseProps} resultsModeActive searchQuery="refine" />
    );
    expect(screen.queryByTestId('search-action-glyph-add')).not.toBeInTheDocument();
  });
});

// -- §2.6 composite legibility (overlay outside the cloud mass on a plate) ------

describe('SearchActionButton composite plate (§2.6 legibility)', () => {
  it('cloud+search composite renders the overlay on the contrast plate', () => {
    renderWithProviders(<SearchActionButton {...baseProps} />);
    const plate = screen.getByTestId('search-action-glyph-plate');
    expect(plate).toBeInTheDocument();
    expect(within(plate).getByTestId('search-action-glyph-search')).toBeInTheDocument();
  });

  it('cloud+wand composite renders the plate and keeps the mirror inside it', () => {
    renderWithProviders(<SearchActionButton {...baseProps} llmConfigured />);
    expect(screen.getByTestId('search-action-glyph-plate')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-wand')).toHaveStyle({
      transform: 'scaleX(-1)',
    });
  });

  it('results-empty composite plates the Add overlay too', () => {
    renderWithProviders(<SearchActionButton {...baseProps} resultsModeActive searchQuery="" />);
    expect(screen.getByTestId('search-action-glyph-plate')).toBeInTheDocument();
    const addPlate = screen.getByTestId('search-action-glyph-add-plate');
    expect(addPlate).toBeInTheDocument();
    expect(within(addPlate).getByTestId('search-action-glyph-add')).toBeInTheDocument();
  });

  it('orbit (pending) variant renders no plate', () => {
    renderWithProviders(<SearchActionButton {...baseProps} isPending />);
    expect(screen.queryByTestId('search-action-glyph-plate')).not.toBeInTheDocument();
  });
});
