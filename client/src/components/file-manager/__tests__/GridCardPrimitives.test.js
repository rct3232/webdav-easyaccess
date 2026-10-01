/**
 * Shared grid/tile primitives tests (P-3 extraction surface).
 * @see docs/spec/client/components/file-manager/ResponsiveCardGrid.md
 * @see docs/spec/client/components/file-manager/CardTile.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import ResponsiveCardGrid, { CardGridSpan } from '../ResponsiveCardGrid';
import CardTile from '../CardTile';

// emotion inserts rules through the CSSOM — read them back via cssRules, not textContent.
function styleSheetText() {
  return Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText);
      } catch {
        return [];
      }
    })
    .join('\n');
}

describe('ResponsiveCardGrid', () => {
  it('renders children inside a CSS-grid container', () => {
    renderWithProviders(
      <ResponsiveCardGrid>
        <div data-testid="cell-a">A</div>
        <div data-testid="cell-b">B</div>
      </ResponsiveCardGrid>
    );
    const grid = screen.getByTestId('cell-a').parentElement;
    expect(grid).toHaveStyle({ display: 'grid' });
    expect(screen.getByTestId('cell-b')).toBeInTheDocument();
  });

  it('attaches the forwarded container ref', () => {
    const ref = { current: null };
    renderWithProviders(
      <ResponsiveCardGrid ref={ref}>
        <div>x</div>
      </ResponsiveCardGrid>
    );
    expect(ref.current).toBeTruthy();
    expect(ref.current).toHaveStyle({ display: 'grid' });
  });

  it('CardGridSpan spans the full row and forwards its ref', () => {
    const spanRef = { current: null };
    renderWithProviders(
      <ResponsiveCardGrid>
        <CardGridSpan ref={spanRef}>
          <div data-testid="span-child">full width</div>
        </CardGridSpan>
      </ResponsiveCardGrid>
    );
    // emotion compiles sx to a class — assert the rule reached the sheet and the
    // ref landed on the span element itself.
    expect(spanRef.current).toContainElement(screen.getByTestId('span-child'));
    expect(styleSheetText()).toMatch(/grid-column:\s*1\s*\/\s*-1/);
  });
});

describe('CardTile', () => {
  it('renders the media area, optional content and the footer slot', () => {
    renderWithProviders(
      <CardTile
        media={<div data-testid="tile-media">media</div>}
        content={<div data-testid="tile-content">content</div>}
        footer={<div data-testid="tile-footer">footer</div>}
      />
    );
    expect(screen.getByTestId('tile-media')).toBeInTheDocument();
    expect(screen.getByTestId('tile-content')).toBeInTheDocument();
    expect(screen.getByTestId('tile-footer')).toBeInTheDocument();
    // The more-action overlay lives inside the media box (top-right contract).
    expect(document.querySelector('.MuiCardContent-root')).toBeInTheDocument();
  });

  it('renders nothing in the overlay slot when moreAction is absent (files DOM parity)', () => {
    const { container } = renderWithProviders(
      <CardTile media={<span>m</span>} footer={<span>f</span>} />
    );
    expect(container.querySelector('button')).not.toBeInTheDocument();
  });

  it('places moreAction inside the media box and forwards footerRef', () => {
    const footerRef = { current: null };
    renderWithProviders(
      <CardTile
        media={<div data-testid="tile-media">m</div>}
        moreAction={
          <button type="button" data-testid="tile-more">
            ⋮
          </button>
        }
        footer={<div>f</div>}
        footerRef={footerRef}
      />
    );
    const media = screen.getByTestId('tile-media');
    expect(media.parentElement).toContainElement(screen.getByTestId('tile-more'));
    expect(footerRef.current).toBeTruthy();
    expect(footerRef.current.className).toMatch('MuiCardContent-root');
  });

  it('renders cornerBadges in the media box opposite the More action (M-4 slot)', () => {
    renderWithProviders(
      <CardTile
        media={<div data-testid="tile-media-corner">m</div>}
        moreAction={
          <button type="button" data-testid="tile-more-corner">
            ⋮
          </button>
        }
        cornerBadges={<div data-testid="tile-corner-badge">b</div>}
        footer={<div>f</div>}
      />
    );
    const mediaBox = screen.getByTestId('tile-media-corner').parentElement;
    const badge = screen.getByTestId('tile-corner-badge');
    expect(mediaBox).toContainElement(badge);
    expect(mediaBox).toContainElement(screen.getByTestId('tile-more-corner'));
    // corner overlay is absolutely anchored top-left, inside the media box
    expect(badge.parentElement).toHaveStyle({ position: 'absolute', top: '4px', left: '4px' });
  });

  it('no cornerBadges ⇒ zero DOM delta (files parity)', () => {
    const { rerender } = renderWithProviders(
      <CardTile media={<div data-testid="tile-media-plain">m</div>} footer={<div>f</div>} />
    );
    const mediaBox = screen.getByTestId('tile-media-plain').parentElement;
    expect(mediaBox.querySelectorAll('[data-testid^="corner"], button')).toHaveLength(0);
    rerender(
      <CardTile
        media={<div data-testid="tile-media-plain">m</div>}
        cornerBadges={null}
        footer={<div>f</div>}
      />
    );
    expect(
      screen.getByTestId('tile-media-plain').parentElement.querySelectorAll('button')
    ).toHaveLength(0);
  });

  it('shows the light primary selected background (FileGridItem parity)', () => {
    renderWithProviders(<CardTile isSelected media={<span>m</span>} footer={<span>f</span>} />);
    const card = document.querySelector('.MuiCard-root');
    expect(card).toHaveStyle({ backgroundColor: 'rgba(65, 103, 186, 0.12)' });
  });

  it('renders the processing overlay when isProcessing', () => {
    renderWithProviders(
      <CardTile isProcessing processingType="move" media={<span>m</span>} footer={<span>f</span>} />
    );
    expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
  });

  it('applies the mobile touch styles when isMobile', () => {
    renderWithProviders(<CardTile isMobile media={<span>m</span>} footer={<span>f</span>} />);
    expect(styleSheetText()).toMatch(/touch-action:\s*manipulation/);
    expect(styleSheetText()).toMatch(/user-select:\s*none/);
  });
});
