/**
 * FAB tests.
 * Verifies observable outcomes per spec: SpeedDial actions, shareLinkMode (login vs add-to-shared),
 * returns null when no write permission, disabled disables Fab.
 * @see docs/spec/client/components/file-manager/FAB.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FAB from '../FAB';

describe('FAB', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders SpeedDial with create folder and upload actions when hasWritePermission', () => {
    const onCreateFolder = jest.fn();
    const onUpload = jest.fn();
    renderWithProviders(
      <FAB onCreateFolder={onCreateFolder} onUpload={onUpload} hasWritePermission={true} />
    );
    const fab = screen.getByRole('button', { name: /file actions/i });
    expect(fab).toBeInTheDocument();
    fireEvent.click(fab);
    expect(screen.getByRole('menuitem', { name: /create folder/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /upload file/i })).toBeInTheDocument();
  });

  it('calls onCreateFolder when create folder action clicked', () => {
    const onCreateFolder = jest.fn();
    const onUpload = jest.fn();
    renderWithProviders(<FAB onCreateFolder={onCreateFolder} onUpload={onUpload} />);
    fireEvent.click(screen.getByRole('button', { name: /file actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /create folder/i }));
    expect(onCreateFolder).toHaveBeenCalled();
  });

  it('calls onUpload when upload action clicked', () => {
    const onCreateFolder = jest.fn();
    const onUpload = jest.fn();
    renderWithProviders(<FAB onCreateFolder={onCreateFolder} onUpload={onUpload} />);
    fireEvent.click(screen.getByRole('button', { name: /file actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /upload file/i }));
    expect(onUpload).toHaveBeenCalled();
  });

  it('returns null when hasWritePermission is false', () => {
    renderWithProviders(
      <FAB onCreateFolder={jest.fn()} onUpload={jest.fn()} hasWritePermission={false} />
    );
    expect(screen.queryByRole('button', { name: /file actions/i })).not.toBeInTheDocument();
  });

  it('renders Login Fab in shareLinkMode when user not logged in', () => {
    const onLoginClick = jest.fn();
    renderWithProviders(
      <FAB
        shareLinkMode={{
          user: null,
          onLoginClick,
          onAddToSharedClick: jest.fn(),
        }}
      />
    );
    const loginFab = screen.getByRole('button', { name: /login/i });
    expect(loginFab).toBeInTheDocument();
    fireEvent.click(loginFab);
    expect(onLoginClick).toHaveBeenCalled();
  });

  it('renders Add to shared Fab in shareLinkMode when user logged in', () => {
    const onAddToSharedClick = jest.fn();
    renderWithProviders(
      <FAB
        shareLinkMode={{
          user: { id: '1', username: 'u' },
          onLoginClick: jest.fn(),
          onAddToSharedClick,
        }}
      />
    );
    const addFab = screen.getByRole('button', { name: /add to shared/i });
    expect(addFab).toBeInTheDocument();
    fireEvent.click(addFab);
    expect(onAddToSharedClick).toHaveBeenCalled();
  });

  it('disables Fab when disabled prop is true', () => {
    renderWithProviders(<FAB onCreateFolder={jest.fn()} onUpload={jest.fn()} disabled={true} />);
    const fab = screen.getByRole('button', { name: /file actions/i });
    expect(fab).toBeDisabled();
  });

  it('opens the SpeedDial from trigger click on mobile', () => {
    renderWithProviders(<FAB onCreateFolder={jest.fn()} onUpload={jest.fn()} isMobile={true} />);

    const fab = screen.getByRole('button', { name: /file actions/i });
    expect(fab).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(fab);

    expect(fab).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: /create folder/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /upload file/i })).toBeInTheDocument();
  });

  it('reports visibility true when rendered and false when unmounted', () => {
    const onVisibilityChange = jest.fn();
    const { unmount } = renderWithProviders(
      <FAB
        onCreateFolder={jest.fn()}
        onUpload={jest.fn()}
        hasWritePermission={true}
        onVisibilityChange={onVisibilityChange}
      />
    );
    expect(onVisibilityChange).toHaveBeenCalledWith(true);
    unmount();
    expect(onVisibilityChange).toHaveBeenLastCalledWith(false);
  });

  it('reports visibility false when it self-hides on permission loss', () => {
    const onVisibilityChange = jest.fn();
    const { rerender } = renderWithProviders(
      <FAB
        onCreateFolder={jest.fn()}
        onUpload={jest.fn()}
        hasWritePermission={true}
        onVisibilityChange={onVisibilityChange}
      />
    );
    expect(onVisibilityChange).toHaveBeenCalledWith(true);
    rerender(
      <FAB
        onCreateFolder={jest.fn()}
        onUpload={jest.fn()}
        hasWritePermission={false}
        onVisibilityChange={onVisibilityChange}
      />
    );
    expect(onVisibilityChange).toHaveBeenLastCalledWith(false);
  });

  it('stays silent when it never becomes visible', () => {
    const onVisibilityChange = jest.fn();
    renderWithProviders(
      <FAB
        onCreateFolder={jest.fn()}
        onUpload={jest.fn()}
        hasWritePermission={false}
        onVisibilityChange={onVisibilityChange}
      />
    );
    expect(onVisibilityChange).not.toHaveBeenCalled();
  });

  it('reports visibility true in shareLinkMode', () => {
    const onVisibilityChange = jest.fn();
    renderWithProviders(
      <FAB
        shareLinkMode={{ user: null, onLoginClick: jest.fn(), onAddToSharedClick: jest.fn() }}
        onVisibilityChange={onVisibilityChange}
      />
    );
    expect(onVisibilityChange).toHaveBeenCalledWith(true);
  });
});

// -- controlled-mount morph (search bar focus swap, FloatingSearchBar.md §2.5) ----

describe('FAB morphed visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderMorphable = (props = {}) =>
    renderWithProviders(
      <FAB
        onCreateFolder={jest.fn()}
        onUpload={jest.fn()}
        hasWritePermission
        onVisibilityChange={jest.fn()}
        {...props}
      />
    );

  it('stays mounted while morphed but is visually/interactionally hidden', () => {
    renderMorphable({ morphed: true });
    const root = screen.getByTestId('file-actions-speed-dial');
    expect(root).toBeInTheDocument();
    const style = getComputedStyle(root);
    expect(style.opacity).toBe('0');
    expect(style.pointerEvents).toBe('none');
  });

  // jsdom does not cascade transform declarations, so the in-place shrink is
  // asserted on the generated emotion rule for each element's own class:
  // the disc carries transform, the SpeedDial root carries opacity only
  // (E2E reads the root opacity seam).
  it('scales the dial disc itself in place — no transform on the SpeedDial root', () => {
    renderMorphable({ morphed: true });
    const ruleTextFor = (el) => {
      const cls = Array.from(el.classList).find((name) => name.startsWith('css-'));
      const lines = [];
      document.querySelectorAll('style').forEach((tag) => {
        if (tag.textContent) lines.push(tag.textContent);
        Array.from((tag.sheet && tag.sheet.cssRules) || []).forEach((rule) =>
          lines.push(rule.cssText)
        );
      });
      return lines.filter((line) => cls && line.includes(`.${cls} {`)).join('\n');
    };
    const root = screen.getByTestId('file-actions-speed-dial');
    const disc = screen.getByTestId('file-actions-fab');
    expect(ruleTextFor(root)).not.toContain('transform');
    expect(ruleTextFor(root)).toContain('opacity 0.16s ease-in');
    expect(ruleTextFor(root)).toContain('pointer-events: none');
    expect(ruleTextFor(disc)).toMatch(/transform: scale\(0\.6\)/);
    expect(ruleTextFor(disc)).toContain('transition: transform 0.16s ease-in');
    // MUI pins pointer-events:auto on the SpeedDial fab — the morphed disc must
    // override it to none or it swallows the ghost submit button's clicks.
    expect(ruleTextFor(disc)).toContain('pointer-events: none');
  });

  it('keeps its visibility self-report at true while morphed (the fab slot stays occupied)', () => {
    const onVisibilityChange = jest.fn();
    const { rerender } = renderWithProviders(
      <FAB
        onCreateFolder={jest.fn()}
        onUpload={jest.fn()}
        hasWritePermission
        onVisibilityChange={onVisibilityChange}
      />
    );
    rerender(
      <FAB
        onCreateFolder={jest.fn()}
        onUpload={jest.fn()}
        hasWritePermission
        onVisibilityChange={onVisibilityChange}
        morphed
      />
    );
    expect(onVisibilityChange).toHaveBeenCalledWith(true);
    expect(onVisibilityChange).not.toHaveBeenCalledWith(false);
  });

  it('still reports false when unmounted while morphed', () => {
    const onVisibilityChange = jest.fn();
    const { unmount } = renderWithProviders(
      <FAB
        onCreateFolder={jest.fn()}
        onUpload={jest.fn()}
        hasWritePermission
        onVisibilityChange={onVisibilityChange}
        morphed
      />
    );
    unmount();
    expect(onVisibilityChange).toHaveBeenLastCalledWith(false);
  });

  it('closes an open speed dial when the morph engages', () => {
    const view = renderMorphable();
    const fab = screen.getByRole('button', { name: /file actions/i });
    fireEvent.click(fab);
    expect(fab).toHaveAttribute('aria-expanded', 'true');

    view.rerender(
      <FAB
        onCreateFolder={jest.fn()}
        onUpload={jest.fn()}
        hasWritePermission
        onVisibilityChange={jest.fn()}
        morphed
      />
    );
    expect(screen.getByRole('button', { name: /file actions/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('applies the same hidden state to the share-link Fab', () => {
    const { container } = renderWithProviders(
      <FAB
        shareLinkMode={{ user: null, onLoginClick: jest.fn(), onAddToSharedClick: jest.fn() }}
        morphed
      />
    );
    const shareFab = container.querySelector('[data-testid="share-link-fab"]');
    expect(shareFab).toBeInTheDocument();
    expect(getComputedStyle(shareFab).opacity).toBe('0');
  });
});
