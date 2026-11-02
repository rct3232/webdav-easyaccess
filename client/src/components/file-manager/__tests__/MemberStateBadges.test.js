/**
 * MemberStateBadges tests — shared member-state badge markers (§11 follow-up 3).
 * Verifies observable outcomes per spec:
 * docs/spec/client/components/file-manager/MemberStateBadges.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Box } from '@mui/material';
import PublicReference from '@mui/icons-material/Public';
import PendingReference from '@mui/icons-material/Pending';
import VpnLockReference from '@mui/icons-material/VpnLock';
import { renderWithProviders } from '../../../test-utils';
import MemberStateBadges, { PublishPendingIcon, getMemberStateBadges } from '../MemberStateBadges';

const en = require('../../../locales/en.json');
const ko = require('../../../locales/ko.json');

const memberRow = (overrides = {}) => ({
  nodeId: 90210,
  path: '',
  basename: 'poster.pdf',
  type: 'file',
  isCollectionMember: true,
  published: true,
  shared_excluded: false,
  state: 'normal',
  ...overrides,
});

const svgPathD = (Component) => {
  const { container } = render(<Component />);
  return container.querySelector('path').getAttribute('d');
};

describe('PublishPendingIcon — composite marker (owner decision 2026-10-01)', () => {
  it('Public globe with the Pending glyph overlaid top-left inside a relative wrapper', () => {
    const { container } = renderWithProviders(<PublishPendingIcon />);
    const wrapper = container.firstChild;
    const svgs = wrapper.querySelectorAll('.MuiSvgIcon-root');
    expect(svgs).toHaveLength(2);
    expect(getComputedStyle(wrapper).position).toBe('relative');
    expect(getComputedStyle(wrapper).display).toBe('inline-flex');
    const [globe, overlay] = svgs;
    expect(globe.querySelector('path').getAttribute('d')).toBe(svgPathD(PublicReference));
    expect(overlay.querySelector('path').getAttribute('d')).toBe(svgPathD(PendingReference));
    expect(getComputedStyle(overlay).position).toBe('absolute');
    // ~10-12px overlay inside a 16px base (owner wording) — inline style is
    // immune to the TileCornerBadge `& .MuiSvgIcon-root { fontSize: 16 }` rule.
    expect(overlay.style.fontSize).toBe('10px');
    expect(globe.style.fontSize).toBe('16px');
    expect(overlay.style.top).toBe('-2px');
    expect(overlay.style.left).toBe('-2px');
  });

  it('inherits currentColor (no explicit color anywhere in the composition)', () => {
    // jsdom getComputedStyle does not resolve INHERITED color — the observable
    // contract is instead: the wrapper/svg carry no inline or sx color, so the
    // MuiSvgIcon `fill: currentColor` paints with whatever the row provides.
    const { container } = renderWithProviders(
      <span style={{ color: 'rgb(255, 0, 0)' }}>
        <PublishPendingIcon />
      </span>
    );
    const wrapper = container.querySelector('span > span');
    expect(wrapper.style.color).toBe('');
    const svgs = container.querySelectorAll('.MuiSvgIcon-root');
    expect(svgs).toHaveLength(2);
    svgs.forEach((svg) => {
      expect(svg.style.color).toBe('');
    });
  });
});

describe('getMemberStateBadges — gating matrix (MemberStateBadges.md §2.3)', () => {
  const identityT = (key) => key;

  it('member, published+shared ⇒ NO badges', () => {
    expect(getMemberStateBadges(memberRow(), identityT)).toEqual([]);
  });

  it('publish-pending member ⇒ pending badge ONLY', () => {
    const badges = getMemberStateBadges(memberRow({ published: false }), identityT);
    expect(badges).toHaveLength(1);
    expect(badges[0].kind).toBe('publish-pending');
    expect(badges[0].testid).toBe('member-publish-pending-badge-90210');
    expect(badges[0].title).toBe('fileManager.memberUnpublishedBadge');
  });

  it('shared-excluded member (published) ⇒ excluded badge ONLY', () => {
    const badges = getMemberStateBadges(memberRow({ shared_excluded: true }), identityT);
    expect(badges).toHaveLength(1);
    expect(badges[0].kind).toBe('excluded');
    expect(badges[0].testid).toBe('member-excluded-badge-90210');
    expect(badges[0].title).toBe('fileManager.memberNotShared');
  });

  it('excluded AND pending ⇒ excluded (VpnLock) badge ONLY — pending suppressed (§2.3, 2026-10-01)', () => {
    const badges = getMemberStateBadges(
      memberRow({ published: false, shared_excluded: true }),
      identityT
    );
    expect(badges.map((b) => b.kind)).toEqual(['excluded']);
    expect(badges[0].testid).toBe('member-excluded-badge-90210');
  });

  it('revoked member ⇒ NO badges even with published:false (the chip-era leak)', () => {
    expect(
      getMemberStateBadges(memberRow({ state: 'revoked', published: false }), identityT)
    ).toEqual([]);
  });

  it('revoked AND excluded member ⇒ NO badges', () => {
    expect(
      getMemberStateBadges(memberRow({ state: 'revoked', shared_excluded: true }), identityT)
    ).toEqual([]);
  });

  it('plain FILE row (flags absent) ⇒ NO badges (undefined-safe)', () => {
    expect(getMemberStateBadges({ path: '/a.txt', basename: 'a.txt' }, identityT)).toEqual([]);
  });

  it('liked-surface row (published never serializes) ⇒ NO badges', () => {
    expect(
      getMemberStateBadges(memberRow({ published: undefined, shared_excluded: false }), identityT)
    ).toEqual([]);
  });
});

describe('MemberStateBadges — list variant (leading icon column overlay)', () => {
  const renderList = (file) =>
    renderWithProviders(
      <Box sx={{ position: 'relative' }}>
        <MemberStateBadges file={file} variant="list" />
      </Box>
    );

  it('renders the excluded badge over the icon column with the badge testid + aria/tooltip string', () => {
    renderList(memberRow({ shared_excluded: true }));
    const badge = screen.getByTestId('member-excluded-badge-90210');
    expect(badge.getAttribute('aria-label')).toBe(en.fileManager.memberNotShared);
    // the excluded marker is the VpnLock icon (owner decision)
    expect(badge.querySelector('path').getAttribute('d')).toBe(svgPathD(VpnLockReference));
    const overlayRow = badge.parentElement;
    expect(getComputedStyle(overlayRow).position).toBe('absolute');
    expect(getComputedStyle(overlayRow).top).toBe('2px');
    expect(getComputedStyle(overlayRow).left).toBe('2px');
    expect(getComputedStyle(overlayRow).zIndex).toBe('1');
  });

  it('renders the pending badge with the memberUnpublishedBadge string while published === false', () => {
    renderList(memberRow({ published: false }));
    const badge = screen.getByTestId('member-publish-pending-badge-90210');
    expect(badge.getAttribute('aria-label')).toBe(en.fileManager.memberUnpublishedBadge);
    expect(badge.querySelectorAll('.MuiSvgIcon-root')).toHaveLength(2);
  });

  it('revoked row ⇒ zero badge DOM', () => {
    renderList(memberRow({ state: 'revoked', published: false, shared_excluded: true }));
    expect(screen.queryByTestId('member-excluded-badge-90210')).toBeNull();
    expect(screen.queryByTestId('member-publish-pending-badge-90210')).toBeNull();
  });

  it('plain file row ⇒ zero badge DOM', () => {
    renderList({ path: '/a.txt', basename: 'a.txt' });
    expect(screen.queryByTestId(/member-.*-badge-90210/)).toBeNull();
  });
});

describe('MemberStateBadges — grid variant (CardTile cornerBadges slot plates)', () => {
  const renderGrid = (file) =>
    renderWithProviders(
      <Box sx={{ position: 'relative' }}>
        <MemberStateBadges file={file} variant="grid" />
      </Box>
    );

  it('badges are TileCornerBadge plates (28px circle, 16px icon) with testid + aria', () => {
    const { unmount } = renderGrid(memberRow({ published: false, shared_excluded: true }));
    // R2 (2026-10-01): excluded + pending ⇒ VpnLock ONLY (un-publishable row).
    const excluded = screen.getByTestId('member-excluded-badge-90210');
    expect(screen.queryByTestId('member-publish-pending-badge-90210')).toBeNull();
    expect(getComputedStyle(excluded).width).toBe('28px');
    expect(getComputedStyle(excluded).height).toBe('28px');
    expect(excluded.getAttribute('aria-label')).toBe(en.fileManager.memberNotShared);
    unmount();
    renderGrid(memberRow({ published: false }));
    const pending = screen.getByTestId('member-publish-pending-badge-90210');
    expect(pending.getAttribute('aria-label')).toBe(en.fileManager.memberUnpublishedBadge);
    // the composite overlay keeps its 10px inline size inside the plate
    // (immune to the plate `& .MuiSvgIcon-root { fontSize: 16 }` rule)
    const pendingSvgs = pending.querySelectorAll('.MuiSvgIcon-root');
    expect(pendingSvgs).toHaveLength(2);
    expect(pendingSvgs[1].style.fontSize).toBe('10px');
  });

  it('revoked / plain rows ⇒ null (slot stays empty)', () => {
    const { unmount } = renderGrid(memberRow({ state: 'revoked', shared_excluded: true }));
    expect(screen.queryByTestId(/member-.*-badge-90210/)).toBeNull();
    unmount();
    renderGrid({ path: '/a.txt', basename: 'a.txt' });
    expect(screen.queryByTestId(/member-.*-badge-90210/)).toBeNull();
  });
});

describe('MemberStateBadges — detail variant (inline 16px before the name)', () => {
  it('renders plain inline badges (no plate, no absolute container)', () => {
    const { unmount } = renderWithProviders(
      <Box sx={{ display: 'flex' }}>
        <MemberStateBadges
          file={memberRow({ published: false, shared_excluded: true })}
          variant="detail"
        />
      </Box>
    );
    // R2 (2026-10-01): both flags ⇒ VpnLock ONLY; pending renders on its own.
    const excluded = screen.getByTestId('member-excluded-badge-90210');
    expect(screen.queryByTestId('member-publish-pending-badge-90210')).toBeNull();
    expect(getComputedStyle(excluded).position).not.toBe('absolute');
    expect(getComputedStyle(excluded).width).not.toBe('28px');
    expect(excluded.getAttribute('aria-label')).toBe(en.fileManager.memberNotShared);
    unmount();
    renderWithProviders(
      <Box sx={{ display: 'flex' }}>
        <MemberStateBadges file={memberRow({ published: false })} variant="detail" />
      </Box>
    );
    const pending = screen.getByTestId('member-publish-pending-badge-90210');
    expect(pending.getAttribute('aria-label')).toBe(en.fileManager.memberUnpublishedBadge);
  });
});

describe('MemberStateBadges — i18n contract', () => {
  it('tooltips use memberNotShared/memberUnpublishedBadge — correct in BOTH locales', () => {
    expect(en.fileManager.memberNotShared).toBe("Not owner's file — not shared");
    expect(ko.fileManager.memberNotShared).toBe('소유자의 파일이 아닙니다 — 공유되지 않음');
    expect(en.fileManager.memberUnpublishedBadge).toBe('Awaiting publish');
    expect(ko.fileManager.memberUnpublishedBadge).toBe('게시 대기');
  });

  it('the orphan chip key sharedExcludedChip is DELETED from both locales', () => {
    expect(en.fileManager.sharedExcludedChip).toBeUndefined();
    expect(ko.fileManager.sharedExcludedChip).toBeUndefined();
  });
});

describe('pending tone carrier (2026-10-01 revised)', () => {
  it('composite glyphs carry no icon-level color — the tone rides the badge carrier', () => {
    const { container } = render(<PublishPendingIcon />);
    expect(container.querySelectorAll('.MuiSvgIcon-colorWarning')).toHaveLength(0);
  });
});
