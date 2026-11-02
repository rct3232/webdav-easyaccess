/**
 * Theme token contract (M-5, 2026-09-30): the like palette token exists and the
 * SvgIcon `color="like"` variant resolves to it — the semantic split is
 * documented in `App.js` (delete/danger keeps `error`, likes are pink).
 * @see docs/spec/client/components/file-manager/FileContextMenu.md §2.x
 */
import { theme } from '../App';

describe('App theme — palette color tokens (like M-5, highlight SEARCH REWORK §6)', () => {
  it('exposes palette.like with the like-pink main', () => {
    expect(theme.palette.like).toBeDefined();
    expect(theme.palette.like.main).toBe('#FF3E55');
  });

  it('keeps the danger palette untouched (error ≠ like)', () => {
    expect(theme.palette.error.main).not.toBe(theme.palette.like.main);
  });

  // SEARCH REWORK §6 contract: `highlight` is the dedicated yellow token for
  // the LIVE browse-filter highlight (kind:'live' ranges); committed/search
  // ranges keep secondary.light (green).
  it('exposes palette.highlight with the live-filter yellow main', () => {
    expect(theme.palette.highlight).toBeDefined();
    expect(theme.palette.highlight.main).toBe('#F7D154');
  });

  it('keeps the highlight token distinct from like, secondary and the derived committed-green light', () => {
    expect(theme.palette.highlight.main).not.toBe(theme.palette.like.main);
    expect(theme.palette.highlight.main).not.toBe(theme.palette.secondary.main);
    expect(theme.palette.highlight.main).not.toBe(theme.palette.secondary.light);
  });
});
