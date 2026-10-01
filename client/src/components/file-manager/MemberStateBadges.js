import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Tooltip } from '@mui/material';
import { VpnLock, Public, Pending } from '@mui/icons-material';
import TileCornerBadge from './TileCornerBadge';

/**
 * MemberStateBadges — the shared member-state BADGE markers (§11 follow-up 3,
 * owner decisions 2026-10-01) rendered in ALL three member views. They REPLACE
 * the former list-only `FileListItem` Chips. Gating lives in the pure
 * `getMemberStateBadges` (revoked rows render NEITHER badge — the chip era
 * leaked the pending marker onto revoked rows because the server serializes
 * revoked stored rows with `published:false`); geometry per variant follows
 * docs/spec/client/components/file-manager/MemberStateBadges.md §2.4:
 * list = overlay row on the leading icon/avatar column, grid =
 * `CardTile.cornerBadges` slot plates (`TileCornerBadge`, M-4 mirror),
 * detail = inline 16px icons before the name.
 */
const BADGE_ICON_SIZE = 16;
const OVERLAY_ICON_SIZE = 10;

/**
 * Composite publish-pending marker: `Public` globe with the small `Pending`
 * glyph overlaid top-left. Defined ONCE here (owner wording). The two font
 * sizes are INLINE styles so the `TileCornerBadge`
 * `& .MuiSvgIcon-root { fontSize: 16 }` descendant rule cannot resize the
 * overlay; both icons inherit `currentColor` from the row.
 */
export const PublishPendingIcon = () => (
  <Box
    component="span"
    sx={{
      position: 'relative',
      display: 'inline-flex',
      width: BADGE_ICON_SIZE,
      height: BADGE_ICON_SIZE,
    }}
  >
    <Public style={{ fontSize: BADGE_ICON_SIZE }} />
    <Pending style={{ fontSize: OVERLAY_ICON_SIZE, position: 'absolute', top: -2, left: -2 }} />
  </Box>
);

/**
 * Pure gating (MemberStateBadges.md §2.3): descriptor order is excluded FIRST,
 * then pending (chip-era order). Strict comparisons keep plain file rows
 * (fields `undefined`) and liked rows badge-free; `state:'revoked'` rows are
 * badge-free regardless of the flags; publish-pending is SUPPRESSED when
 * `shared_excluded === true` (2026-10-01 R2: an excluded row is un-publishable
 * forever — its member menu omits the publish action — so both flags render
 * the VpnLock ONLY).
 */
export const getMemberStateBadges = (file, t) => {
  if (!file || file.state === 'revoked') {
    return [];
  }
  const badges = [];
  if (file.shared_excluded === true) {
    badges.push({
      kind: 'excluded',
      testid: `member-excluded-badge-${file.nodeId}`,
      title: t('fileManager.memberNotShared'),
      icon: <VpnLock style={{ fontSize: BADGE_ICON_SIZE }} />,
    });
  }
  if (file.published === false && file.shared_excluded !== true) {
    badges.push({
      kind: 'publish-pending',
      testid: `member-publish-pending-badge-${file.nodeId}`,
      title: t('fileManager.memberUnpublishedBadge'),
      icon: <PublishPendingIcon />,
    });
  }
  return badges;
};

/**
 * Flag-only presence check (no `t` needed) — lets slot-based consumers keep
 * their zero-DOM contract: `CardTile` renders its corner-badge container only
 * when the `cornerBadges` NODE is non-null, and a rendered element is always
 * non-null, so FileGridItem must branch on THIS, not on the element itself.
 */
export const hasMemberStateBadges = (file) =>
  Boolean(file) &&
  file.state !== 'revoked' &&
  (file.shared_excluded === true || file.published === false);

const listOverlayStyles = {
  position: 'absolute',
  top: 2,
  left: 2,
  zIndex: 1,
  display: 'flex',
  gap: 0.5,
};

const InlineBadge = ({ testid, title, children }) => (
  <Tooltip title={title} disableInteractive>
    <Box component="span" data-testid={testid} aria-label={title} sx={{ color: 'inherit' }}>
      {children}
    </Box>
  </Tooltip>
);

const MemberStateBadges = ({ file, variant = 'detail' }) => {
  const { t } = useTranslation();
  const badges = getMemberStateBadges(file, t);
  if (badges.length === 0) {
    return null;
  }
  if (variant === 'grid') {
    return badges.map(({ kind, testid, title, icon }) => (
      <TileCornerBadge key={kind} title={title} data-testid={testid} aria-label={title}>
        {icon}
      </TileCornerBadge>
    ));
  }
  const rendered = badges.map(({ kind, testid, title, icon }) => (
    <InlineBadge key={kind} testid={testid} title={title}>
      {icon}
    </InlineBadge>
  ));
  if (variant === 'list') {
    return <Box sx={listOverlayStyles}>{rendered}</Box>;
  }
  return rendered;
};

export default MemberStateBadges;
