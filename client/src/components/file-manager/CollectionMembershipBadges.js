import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Tooltip } from '@mui/material';
import { Collections as CollectionsIcon } from '@mui/icons-material';
import TileCornerBadge from './TileCornerBadge';

/**
 * CollectionMembershipBadges — files-surface collection-membership BADGE
 * markers (docs/spec/client/components/file-manager/CollectionMembershipBadges.md).
 * Follows the MemberStateBadges family geometry: grid = `CardTile.cornerBadges`
 * plates, list = leading-column overlay, detail = inline 16px glyphs. Pure
 * view: the host prepares `entries` ([{ id, name }]) via
 * `useCollectionMemberships` — this component never performs IO. Membership
 * is a fact, not an alert: glyphs stay neutral (no warning tone carrier).
 */
const BADGE_ICON_SIZE = 16;

// At most two per-collection badges per row; the remainder collapses into one
// `+N` overflow badge (max three plates total).
export const MEMBERSHIP_BADGE_CAP = 2;

/**
 * Pure gating (no JSX): ordered descriptors — collection badges in host order,
 * then a single `kind:'more'` overflow when the cap is exceeded.
 */
export const getCollectionMembershipBadges = (entries, t, nodeId) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }
  const visible = entries.slice(0, MEMBERSHIP_BADGE_CAP);
  const remaining = entries.slice(MEMBERSHIP_BADGE_CAP);
  const badges = visible.map(({ id, name }) => ({
    kind: 'collection',
    testid: `membership-badge-${nodeId}-${id}`,
    title: t('fileManager.membershipChip', { name }),
    icon: <CollectionsIcon style={{ fontSize: BADGE_ICON_SIZE }} />,
  }));
  if (remaining.length > 0) {
    badges.push({
      kind: 'more',
      testid: `membership-badge-more-${nodeId}`,
      title: t('fileManager.membershipChipMore', {
        count: remaining.length,
        names: remaining.map((entry) => entry.name).join(', '),
      }),
      text: `+${remaining.length}`,
    });
  }
  return badges;
};

/**
 * Presence check (no `t`) — slot-based consumers MUST branch on this so the
 * `CardTile` corner container stays `null` (zero DOM delta) for
 * membership-free tiles (same guard idiom as `hasMemberStateBadges`).
 */
export const hasCollectionMembershipBadges = (entries) =>
  Array.isArray(entries) && entries.length > 0;

const overlayStyles = (top) => ({
  position: 'absolute',
  top,
  left: 2,
  zIndex: 1,
  display: 'flex',
  gap: 0.5,
});

const InlineBadge = ({ testid, title, children }) => (
  <Tooltip title={title} disableInteractive>
    <Box component="span" data-testid={testid} aria-label={title}>
      {children}
    </Box>
  </Tooltip>
);

const CollectionMembershipBadges = ({ nodeId, entries, variant = 'detail', overlayTop = 2 }) => {
  const { t } = useTranslation();
  const badges = getCollectionMembershipBadges(entries, t, nodeId);
  if (badges.length === 0) {
    return null;
  }

  const renderBadge = ({ kind, testid, title, icon, text }) => {
    if (variant === 'grid') {
      return (
        <TileCornerBadge key={testid} title={title} data-testid={testid} aria-label={title}>
          {kind === 'more' ? (
            <Box component="span" sx={{ fontSize: 11, fontWeight: 600, color: 'common.white' }}>
              {text}
            </Box>
          ) : (
            icon
          )}
        </TileCornerBadge>
      );
    }
    return (
      <InlineBadge key={testid} testid={testid} title={title}>
        {kind === 'more' ? (
          <Box component="span" sx={{ fontSize: 12 }}>
            {text}
          </Box>
        ) : (
          icon
        )}
      </InlineBadge>
    );
  };

  const rendered = badges.map(renderBadge);
  if (variant === 'list') {
    return <Box sx={overlayStyles(overlayTop)}>{rendered}</Box>;
  }
  return rendered;
};

export default CollectionMembershipBadges;
