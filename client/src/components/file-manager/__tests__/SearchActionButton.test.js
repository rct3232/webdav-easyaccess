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

  it('llmConfigured=true: composite cloud + mirrored wand-stars geometry', () => {
    renderWithProviders(<SearchActionButton {...baseProps} llmConfigured />);
    expect(screen.getByTestId('search-action-glyph-cloud')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-wand')).toBeInTheDocument();
    const mirror = document.querySelector('[data-testid="search-glyph-geom"] g[transform]');
    expect(mirror).not.toBeNull();
    expect(mirror.getAttribute('transform')).toContain('scale(-1,1)');
  });

  it('isPending: the composite stays intact and the SMIL pair mounts on the shared geometry', () => {
    renderWithProviders(<SearchActionButton {...baseProps} isPending />);
    expect(screen.getByTestId('search-action-glyph-orbit')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-cloud')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-search')).toBeInTheDocument();
    expect(document.querySelectorAll('animateTransform')).toHaveLength(2);
  });

  it('non-pending renders zero SMIL animations (static home composite)', () => {
    renderWithProviders(<SearchActionButton {...baseProps} />);
    expect(document.querySelectorAll('animateTransform')).toHaveLength(0);
    expect(screen.queryByTestId('search-action-glyph-orbit')).not.toBeInTheDocument();
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
    expect(mask.querySelectorAll('line').length).toBeGreaterThanOrEqual(2);
  });

  it('the visible line and the mask knockout reference the SAME geometry (single clock)', () => {
    renderWithProviders(<SearchActionButton {...baseProps} />);
    const hrefs = Array.from(document.querySelectorAll('[data-testid="search-glyph"] use')).map(
      (use) => use.getAttribute('href')
    );
    expect(hrefs).toHaveLength(2);
    expect(hrefs[0]).toBe(hrefs[1]);
    expect(hrefs[0]).toMatch(/^#search-glyph-overlay-/);
  });

  it('orbit (pending) keeps the mask composite and mounts both SMIL animations indefinite', () => {
    renderWithProviders(<SearchActionButton {...baseProps} isPending />);
    expect(screen.getByTestId('search-glyph').querySelector('mask')).not.toBeNull();
    expect(screen.getByTestId('search-action-glyph-cloud')).toBeInTheDocument();
    const anims = Array.from(document.querySelectorAll('animateTransform'));
    expect(anims).toHaveLength(2);
    anims.forEach((anim) => expect(anim.getAttribute('begin')).toBe('indefinite'));
    expect(anims[0].getAttribute('to')).toContain('-360');
    expect(anims[1].getAttribute('additive')).toBe('sum');
    expect(anims[1].getAttribute('to')).toContain('360');
  });

  it('the SMIL orbit center sits one radius left of the search home (3-oclock start)', () => {
    renderWithProviders(<SearchActionButton {...baseProps} isPending />);
    const anims = Array.from(document.querySelectorAll('animateTransform'));
    expect(anims[0].getAttribute('from')).toBe('0 12.9 6.4');
    expect(anims[1].getAttribute('from')).toBe('0 17.4 6.4');
  });

  it('the wand variant orbits around its own cluster center', () => {
    renderWithProviders(<SearchActionButton {...baseProps} isPending llmConfigured />);
    const anims = Array.from(document.querySelectorAll('animateTransform'));
    expect(anims[0].getAttribute('from')).toBe('0 13.1 7.4');
    expect(anims[1].getAttribute('from')).toBe('0 17.6 7.4');
  });

  it('the svg overflows its viewBox for the top of the sweep', () => {
    renderWithProviders(<SearchActionButton {...baseProps} />);
    const css = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText))
      .join('\n')
      .replace(/\s+/g, '');
    expect(css).toContain('overflow:visible');
  });

  it('multiple instances get distinct geometry and mask ids', () => {
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
    const geomHrefs = Array.from(
      document.querySelectorAll('[data-testid="search-glyph"] use'),
      (u) => u.getAttribute('href')
    );
    expect(maskIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(maskIds).size).toBe(maskIds.length);
    // Each instance renders its geometry TWICE (visible line + mask knockout)
    // through the SAME href by design (single clock); instances differ.
    expect(geomHrefs.length).toBe(2 * maskIds.length);
    expect(new Set(geomHrefs).size).toBe(maskIds.length);
  });
});
