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
  it('llmConfigured=false: knockout composite cloud + stroke magnifier', () => {
    renderWithProviders(<SearchActionButton {...baseProps} />);
    expect(screen.getByTestId('search-glyph')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-cloud')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-search')).toBeInTheDocument();
    expect(screen.queryByTestId('search-action-glyph-wand')).not.toBeInTheDocument();
  });

  it('llmConfigured=true: composite cloud + mirrored wand-stars group', () => {
    renderWithProviders(<SearchActionButton {...baseProps} llmConfigured />);
    expect(screen.getByTestId('search-action-glyph-cloud')).toBeInTheDocument();
    const wand = screen.getByTestId('search-action-glyph-wand');
    expect(wand).toBeInTheDocument();
    expect(wand.getAttribute('transform')).toContain('scale(-1,1)');
  });

  it('isPending: the composite stays intact and the orbit seam wraps the overlay', () => {
    renderWithProviders(<SearchActionButton {...baseProps} isPending />);
    expect(screen.getByTestId('search-action-glyph-orbit')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-cloud')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('search-action-glyph-orbit')).getByTestId(
        'search-action-glyph-search'
      )
    ).toBeInTheDocument();
  });

  it('isPending + llmConfigured: the orbiting overlay is the wand variant', () => {
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

// -- §2.6 knockout structure (cloud cut along the overlay lines, no plates) ----

describe('SearchActionButton knockout composite (§2.6 geometry)', () => {
  it('the cloud path is masked and the mask carries the knockout strokes', () => {
    renderWithProviders(<SearchActionButton {...baseProps} />);
    const cloud = screen.getByTestId('search-action-glyph-cloud');
    expect(cloud.getAttribute('mask')).toMatch(/^url\(#search-glyph-cloud-/);
    const svg = screen.getByTestId('search-glyph');
    const mask = svg.querySelector('mask');
    expect(mask).not.toBeNull();
    expect(mask.querySelectorAll('circle, line').length).toBeGreaterThanOrEqual(2);
    expect(mask.querySelector('rect')).toHaveAttribute('fill', '#fff');
  });

  it('no plate affordances remain in any state', () => {
    renderWithProviders(<SearchActionButton {...baseProps} />);
    expect(screen.queryByTestId('search-action-glyph-plate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('search-action-glyph-add-plate')).not.toBeInTheDocument();
  });

  it('results-empty composite knocks the Add plus through the cloud too', () => {
    renderWithProviders(<SearchActionButton {...baseProps} resultsModeActive searchQuery="" />);
    const mask = screen.getByTestId('search-glyph').querySelector('mask');
    expect(screen.getByTestId('search-action-glyph-add')).toBeInTheDocument();
    expect(mask.querySelectorAll('line').length).toBeGreaterThanOrEqual(3);
  });

  it('orbit (pending) variant keeps the cloud + mask composite', () => {
    renderWithProviders(<SearchActionButton {...baseProps} isPending />);
    expect(screen.getByTestId('search-glyph').querySelector('mask')).not.toBeNull();
    expect(screen.getByTestId('search-action-glyph-cloud')).toBeInTheDocument();
  });

  it('pending orbit drives the mask knockout in lockstep with the overlay', () => {
    renderWithProviders(<SearchActionButton {...baseProps} isPending />);
    const svg = screen.getByTestId('search-glyph');
    expect(svg.querySelectorAll('.search-glyph-orbit-anim')).toHaveLength(2);
    expect(
      screen.getByTestId('search-action-glyph-orbit').classList.contains('search-glyph-orbit-anim')
    ).toBe(true);
    expect(svg.querySelector('mask .search-glyph-orbit-anim')).not.toBeNull();
  });

  it('non-pending renders a single static knockout group (no orbit class in the mask)', () => {
    renderWithProviders(<SearchActionButton {...baseProps} />);
    const svg = screen.getByTestId('search-glyph');
    expect(svg.querySelectorAll('.search-glyph-orbit-anim')).toHaveLength(0);
  });

  it('orbit keyframes start at the home 3-oclock point and run counter-clockwise', () => {
    renderWithProviders(<SearchActionButton {...baseProps} />);
    const css = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText))
      .join('\n')
      .replace(/\s+/g, '');
    expect(css).toContain('translateX(-4.5px)');
    expect(css).toContain('rotate(-360deg)');
    expect(css).toContain('translateX(4.5px)');
    expect(css).toContain('overflow:visible');
  });

  it('multiple instances get distinct mask ids', () => {
    renderWithProviders(
      <div>
        <SearchActionButton {...baseProps} visible />
        <SearchActionButton {...baseProps} searchQuery="other" />
      </div>
    );
    const maskIds = Array.from(
      document.querySelectorAll('[data-testid="search-glyph"] mask'),
      (m) => m.id
    );
    expect(maskIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(maskIds).size).toBe(maskIds.length);
  });
});
