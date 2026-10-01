/**
 * Theme token contract (M-5, 2026-09-30): the like palette token exists and the
 * SvgIcon `color="like"` variant resolves to it — the semantic split is
 * documented in `App.js` (delete/danger keeps `error`, likes are pink).
 * @see docs/spec/client/components/file-manager/FileContextMenu.md §2.x
 */
import { theme } from '../App';

describe('App theme — like color token (M-5)', () => {
  it('exposes palette.like with the like-pink main', () => {
    expect(theme.palette.like).toBeDefined();
    expect(theme.palette.like.main).toBe('#FF3E55');
  });

  it('keeps the danger palette untouched (error ≠ like)', () => {
    expect(theme.palette.error.main).not.toBe(theme.palette.like.main);
  });
});
