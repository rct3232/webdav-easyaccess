/**
 * FloatingSearchBar tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/FloatingSearchBar.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FloatingSearchBar from '../FloatingSearchBar';

// Records which hook each mounted effect callback registers with (pass-through
// to the real react; no behavior change). Used by the layout-phase test below.
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  const registry = { layout: [], effect: [] };
  global.FSB_HOOK_REGISTRY = registry;
  return {
    ...actual,
    useLayoutEffect: (fn, deps) => {
      registry.layout.push(fn);
      return actual.useLayoutEffect(fn, deps);
    },
    useEffect: (fn, deps) => {
      registry.effect.push(fn);
      return actual.useEffect(fn, deps);
    },
  };
});

const defaultProps = {
  searchQuery: '',
  setSearchQuery: jest.fn(),
  isMobile: false,
};

const startAdornmentBox = () => screen.getByTestId('search-start-icon');
const startAdornmentStyle = () => getComputedStyle(startAdornmentBox());
const searchInput = () => screen.getByPlaceholderText(/search/i);

describe('FloatingSearchBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders search input with placeholder', () => {
    renderWithProviders(<FloatingSearchBar {...defaultProps} />);
    expect(searchInput()).toBeInTheDocument();
  });

  it('calls setSearchQuery on input change', () => {
    const setSearchQuery = jest.fn();
    renderWithProviders(<FloatingSearchBar {...defaultProps} setSearchQuery={setSearchQuery} />);
    fireEvent.change(searchInput(), { target: { value: 'test' } });
    expect(setSearchQuery).toHaveBeenCalledWith('test');
  });

  it('shows clear button when searchQuery non-empty and clears on click', () => {
    const setSearchQuery = jest.fn();
    renderWithProviders(
      <FloatingSearchBar {...defaultProps} searchQuery="q" setSearchQuery={setSearchQuery} />
    );
    const clearButton = screen.getByRole('button', { name: /close|search close/i });
    expect(clearButton).toBeInTheDocument();
    fireEvent.click(clearButton);
    expect(setSearchQuery).toHaveBeenCalledWith('');
  });

  it('does not show clear button when searchQuery empty', () => {
    renderWithProviders(<FloatingSearchBar {...defaultProps} searchQuery="" />);
    expect(screen.queryByRole('button', { name: /close|search close/i })).not.toBeInTheDocument();
  });

  it('reserves FAB space on desktop when fabVisible', () => {
    const { container } = renderWithProviders(<FloatingSearchBar {...defaultProps} fabVisible />);
    const bar = container.querySelector('[data-testid="floating-search-bar"]');
    expect(getComputedStyle(bar).right).toBe('116px');
  });

  it('expands to the screen offset on desktop when fab is not visible', () => {
    const { container } = renderWithProviders(
      <FloatingSearchBar {...defaultProps} fabVisible={false} />
    );
    const bar = container.querySelector('[data-testid="floating-search-bar"]');
    expect(getComputedStyle(bar).right).toBe('48px');
  });

  it('expands to the mobile offset when fab is not visible on mobile', () => {
    const { container } = renderWithProviders(
      <FloatingSearchBar {...defaultProps} isMobile fabVisible={false} />
    );
    const bar = container.querySelector('[data-testid="floating-search-bar"]');
    expect(getComputedStyle(bar).right).toBe('16px');
  });

  it('animates right position changes', () => {
    const { container } = renderWithProviders(<FloatingSearchBar {...defaultProps} />);
    const bar = container.querySelector('[data-testid="floating-search-bar"]');
    expect(getComputedStyle(bar).transition).toContain('right');
  });
});

// -- §2.5 start-icon collapse/expand ------------------------------------------

describe('FloatingSearchBar §2.5 (start-icon morph states)', () => {
  it('start icon occupies its space in browse mode and fades out on focus', () => {
    renderWithProviders(<FloatingSearchBar {...defaultProps} />);
    expect(startAdornmentStyle().width).toBe('32px');
    expect(startAdornmentStyle().opacity).toBe('1');

    fireEvent.focus(searchInput());
    expect(startAdornmentStyle().width).toBe('0px');
    expect(startAdornmentStyle().opacity).toBe('0');
  });

  it('icon returns on blur with empty text in browse mode', () => {
    renderWithProviders(<FloatingSearchBar {...defaultProps} />);
    fireEvent.focus(searchInput());
    fireEvent.blur(searchInput());
    expect(startAdornmentStyle().width).toBe('32px');
  });

  it('collapse is gated on empty text AND browse mode: blur with text keeps it expanded', () => {
    renderWithProviders(<FloatingSearchBar {...defaultProps} searchQuery="movie" />);
    fireEvent.focus(searchInput());
    fireEvent.blur(searchInput());
    expect(startAdornmentStyle().width).toBe('0px');
  });

  it('resultsModeActive expands without focus (visual state only)', () => {
    renderWithProviders(
      <FloatingSearchBar {...defaultProps} onSubmitQuery={jest.fn()} resultsModeActive />
    );
    expect(startAdornmentStyle().width).toBe('0px');
    expect(screen.getByTestId('search-action-button')).toBeInTheDocument();
  });
});

// -- §2.7 submit and end cluster -------------------------------------------------

describe('FloatingSearchBar §2.7 (submit intents, end cluster)', () => {
  it('the pill has NO submit adornment even with onSubmitQuery', () => {
    renderWithProviders(
      <FloatingSearchBar {...defaultProps} searchQuery="movie" onSubmitQuery={jest.fn()} />
    );
    expect(screen.queryByTestId('search-submit')).not.toBeInTheDocument();
  });

  it('Enter calls onSubmitQuery once with the current value; typing alone never does', () => {
    const onSubmitQuery = jest.fn();
    const setSearchQuery = jest.fn();
    renderWithProviders(
      <FloatingSearchBar
        {...defaultProps}
        searchQuery="movie night"
        setSearchQuery={setSearchQuery}
        onSubmitQuery={onSubmitQuery}
      />
    );

    fireEvent.keyDown(searchInput(), { key: 'Enter' });
    expect(onSubmitQuery).toHaveBeenCalledTimes(1);
    expect(onSubmitQuery).toHaveBeenCalledWith('movie night');

    fireEvent.change(searchInput(), { target: { value: 'movie nights' } });
    expect(setSearchQuery).toHaveBeenCalledWith('movie nights');
    expect(onSubmitQuery).toHaveBeenCalledTimes(1);
  });

  it('Enter is inert without onSubmitQuery (share-link mode)', () => {
    renderWithProviders(<FloatingSearchBar {...defaultProps} searchQuery="movie" />);
    expect(() => {
      fireEvent.keyDown(searchInput(), { key: 'Enter' });
    }).not.toThrow();
  });

  it('✕ clears the text AND removes focus (collapse signal to the host)', () => {
    const setSearchQuery = jest.fn();
    const onSubmitQuery = jest.fn();
    renderWithProviders(
      <FloatingSearchBar
        {...defaultProps}
        searchQuery="movie"
        setSearchQuery={setSearchQuery}
        onSubmitQuery={onSubmitQuery}
      />
    );
    const input = searchInput();
    fireEvent.focus(input);

    fireEvent.click(screen.getByRole('button', { name: /close|search close/i }));

    expect(setSearchQuery).toHaveBeenCalledWith('');
    expect(document.activeElement).not.toBe(input);
    expect(onSubmitQuery).not.toHaveBeenCalled();
  });

  it('without onSubmitQuery (share link) the fab-slot button never renders', () => {
    renderWithProviders(<FloatingSearchBar {...defaultProps} searchQuery="movie" />);
    expect(screen.queryByTestId('search-action-button')).not.toBeInTheDocument();
  });
});

// -- §2.7 pending cancel surface (button is the cancel control, ✕ hidden) -------

describe('FloatingSearchBar §2.7 (pending cancel surface)', () => {
  it('hides the ✕ while a submit is pending and restores it afterwards', () => {
    const { rerender } = renderWithProviders(
      <FloatingSearchBar
        {...defaultProps}
        searchQuery="movie"
        onSubmitQuery={jest.fn()}
        onCancelQuery={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /close|search close/i })).toBeInTheDocument();

    rerender(
      <FloatingSearchBar
        {...defaultProps}
        searchQuery="movie"
        onSubmitQuery={jest.fn()}
        onCancelQuery={jest.fn()}
        isPending
      />
    );
    expect(screen.queryByRole('button', { name: /close|search close/i })).not.toBeInTheDocument();

    rerender(
      <FloatingSearchBar
        {...defaultProps}
        searchQuery="movie"
        onSubmitQuery={jest.fn()}
        onCancelQuery={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /close|search close/i })).toBeInTheDocument();
  });

  it('the 56px button routes to onCancelQuery while pending (no resubmit)', () => {
    const onSubmitQuery = jest.fn();
    const onCancelQuery = jest.fn();
    renderWithProviders(
      <FloatingSearchBar
        {...defaultProps}
        searchQuery="movie"
        onSubmitQuery={onSubmitQuery}
        onCancelQuery={onCancelQuery}
        isPending
      />
    );

    fireEvent.click(screen.getByTestId('search-action-button'));
    expect(onCancelQuery).toHaveBeenCalledTimes(1);
    expect(onSubmitQuery).not.toHaveBeenCalled();
  });

  it('Escape cancels while pending and keeps the typed text', () => {
    const onSubmitQuery = jest.fn();
    const onCancelQuery = jest.fn();
    const setSearchQuery = jest.fn();
    renderWithProviders(
      <FloatingSearchBar
        {...defaultProps}
        searchQuery="movie"
        setSearchQuery={setSearchQuery}
        onSubmitQuery={onSubmitQuery}
        onCancelQuery={onCancelQuery}
        isPending
      />
    );

    fireEvent.keyDown(searchInput(), { key: 'Escape' });
    expect(onCancelQuery).toHaveBeenCalledTimes(1);
    expect(onSubmitQuery).not.toHaveBeenCalled();
    expect(setSearchQuery).not.toHaveBeenCalled();
  });

  it('Escape outside pending is inert (no cancel, no submit)', () => {
    const onSubmitQuery = jest.fn();
    const onCancelQuery = jest.fn();
    renderWithProviders(
      <FloatingSearchBar
        {...defaultProps}
        searchQuery="movie"
        onSubmitQuery={onSubmitQuery}
        onCancelQuery={onCancelQuery}
      />
    );

    fireEvent.keyDown(searchInput(), { key: 'Escape' });
    expect(onCancelQuery).not.toHaveBeenCalled();
    expect(onSubmitQuery).not.toHaveBeenCalled();
  });
});

// -- §2.5 fab-slot search button mount ------------------------------------------

describe('FloatingSearchBar §2.5 (fab-slot button mount)', () => {
  it('focus mounts the search button; collapse unmounts it after the exit animation', async () => {
    renderWithProviders(<FloatingSearchBar {...defaultProps} onSubmitQuery={jest.fn()} />);
    expect(screen.queryByTestId('search-action-button')).not.toBeInTheDocument();

    fireEvent.focus(searchInput());
    expect(screen.getByTestId('search-action-button')).toBeInTheDocument();

    fireEvent.blur(searchInput());
    await waitFor(() => {
      expect(screen.queryByTestId('search-action-button')).not.toBeInTheDocument();
    });
  });

  it('passes isPending/llmConfigured through to the button glyph states', () => {
    renderWithProviders(
      <FloatingSearchBar
        {...defaultProps}
        onSubmitQuery={jest.fn()}
        isPending
        llmConfigured
        resultsModeActive
      />
    );
    expect(screen.getByTestId('search-action-glyph-orbit')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-cloud')).toBeInTheDocument();
    expect(screen.getByTestId('search-action-glyph-wand')).toBeInTheDocument();
  });
});

// -- morph truth signal for the host (FAB controlled-mount wiring) ----------------

describe('FloatingSearchBar §2.5 (onExpandedChange morph truth)', () => {
  it('emits the initial state, then tracks focus/blur with the empty-text gate', () => {
    const onExpandedChange = jest.fn();
    renderWithProviders(
      <FloatingSearchBar
        {...defaultProps}
        onSubmitQuery={jest.fn()}
        onExpandedChange={onExpandedChange}
      />
    );
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);

    fireEvent.focus(searchInput());
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);

    fireEvent.blur(searchInput());
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });

  it('results mode keeps the truth at true across blur', () => {
    const onExpandedChange = jest.fn();
    renderWithProviders(
      <FloatingSearchBar
        {...defaultProps}
        onSubmitQuery={jest.fn()}
        resultsModeActive
        onExpandedChange={onExpandedChange}
      />
    );
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);
    fireEvent.focus(searchInput());
    fireEvent.blur(searchInput());
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);
  });

  it('without a submit surface (share link) it never reports expanded', () => {
    const onExpandedChange = jest.fn();
    renderWithProviders(
      <FloatingSearchBar
        {...defaultProps}
        searchQuery="movie"
        onExpandedChange={onExpandedChange}
      />
    );
    fireEvent.focus(searchInput());
    expect(onExpandedChange.mock.calls.every(([value]) => value === false)).toBe(true);
  });

  // The host flips the FAB morph state from this signal and must receive it in
  // the SAME commit as the focus paint (FloatingSearchBar.md §2.5 — layout
  // phase). jsdom has no paint and React's act/scheduler flushes equalize any
  // timing probe (verified empirically: a passive emit is observable at the
  // same points as a layout one), so the documented mechanism itself is pinned:
  // the emit effect must register via useLayoutEffect, never via useEffect.
  it('registers the morph-truth emit effect in the layout phase (never passive)', () => {
    const registry = global.FSB_HOOK_REGISTRY;
    registry.layout.length = 0;
    registry.effect.length = 0;

    renderWithProviders(
      <FloatingSearchBar {...defaultProps} onSubmitQuery={jest.fn()} onExpandedChange={jest.fn()} />
    );

    const isEmitFn = (fn) => fn.toString().includes('onExpandedChange(morphActive)');
    expect(registry.layout.some(isEmitFn)).toBe(true);
    expect(registry.effect.some(isEmitFn)).toBe(false);
  });
});

// -- §2.7 native clear affordance suppression (single ✕) -----------------------

describe('FloatingSearchBar §2.7 (native clear affordance)', () => {
  const sheetText = () => {
    const rules = [];
    document.querySelectorAll('style').forEach((tag) => {
      if (tag.textContent) rules.push(tag.textContent);
      Array.from(tag.sheet && tag.sheet.cssRules ? tag.sheet.cssRules : []).forEach((rule) => {
        rules.push(rule.cssText);
      });
    });
    return rules.join('\n');
  };

  it('suppresses the browser-native search cancel button/decoration via the input selector', () => {
    renderWithProviders(<FloatingSearchBar {...defaultProps} searchQuery="q" />);
    expect(sheetText()).toContain('::-webkit-search-cancel-button');
    expect(sheetText()).toContain('::-webkit-search-decoration');
    expect(sheetText()).toMatch(/input::-webkit-search-cancel-button/);
  });
});
