/**
 * CollectionMembershipBadges tests — files-surface collection-membership badges.
 * Verifies observable outcomes per spec:
 * docs/spec/client/components/file-manager/CollectionMembershipBadges.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import CollectionMembershipBadges, {
  getCollectionMembershipBadges,
  hasCollectionMembershipBadges,
  MEMBERSHIP_BADGE_CAP,
} from '../CollectionMembershipBadges';

const en = require('../../../locales/en.json');
const ko = require('../../../locales/ko.json');

const NODE = 90210;
const entries = (...pairs) => pairs.map(([id, name]) => ({ id, name }));

describe('hasCollectionMembershipBadges — slot guard', () => {
  it('truthy only for a non-empty array', () => {
    expect(hasCollectionMembershipBadges(undefined)).toBe(false);
    expect(hasCollectionMembershipBadges(null)).toBe(false);
    expect(hasCollectionMembershipBadges([])).toBe(false);
    expect(hasCollectionMembershipBadges(entries([1, 'Beach']))).toBe(true);
  });
});

describe('getCollectionMembershipBadges — pure descriptors', () => {
  const t = (key, options) =>
    `${key}:${options?.name ?? options?.names ?? ''}:${options?.count ?? ''}`;

  it('CAP is 2', () => {
    expect(MEMBERSHIP_BADGE_CAP).toBe(2);
  });

  it('empty/absent entries ⇒ []', () => {
    expect(getCollectionMembershipBadges(undefined, t)).toEqual([]);
    expect(getCollectionMembershipBadges([], t)).toEqual([]);
  });

  it('two collections ⇒ two collection descriptors in host order, no overflow', () => {
    const badges = getCollectionMembershipBadges(entries([17, 'Beach'], [23, 'Work']), t, NODE);
    expect(badges).toHaveLength(2);
    expect(badges.map((b) => b.kind)).toEqual(['collection', 'collection']);
    expect(badges[0].testid).toBe(`membership-badge-${NODE}-17`);
    expect(badges[1].testid).toBe(`membership-badge-${NODE}-23`);
    expect(badges[0].title).toBe('fileManager.membershipChip:Beach:');
    expect(badges[1].title).toBe('fileManager.membershipChip:Work:');
  });

  it('three+ collections ⇒ first two + one +N overflow descriptor (last)', () => {
    const badges = getCollectionMembershipBadges(
      entries([1, 'A'], [2, 'B'], [3, 'C'], [4, 'D']),
      t,
      NODE
    );
    expect(badges).toHaveLength(3);
    expect(badges.map((b) => b.kind)).toEqual(['collection', 'collection', 'more']);
    expect(badges[2].testid).toBe(`membership-badge-more-${NODE}`);
    // overflow counts the REMAINING collections and names them in the tooltip
    expect(badges[2].title).toBe('fileManager.membershipChipMore:C, D:2');
    expect(badges[2].text).toBe('+2');
  });
});

describe('CollectionMembershipBadges — rendering', () => {
  it('renders null (zero DOM) for empty/absent entries in every variant', () => {
    const { container } = renderWithProviders(
      <CollectionMembershipBadges nodeId={NODE} entries={[]} variant="list" />
    );
    expect(container.firstChild).toBeNull();
    const { container: grid } = renderWithProviders(
      <CollectionMembershipBadges nodeId={NODE} entries={null} variant="grid" />
    );
    expect(grid.firstChild).toBeNull();
  });

  it('list variant overlays the leading column (absolute, left 2, z-index 1, default top 2)', () => {
    renderWithProviders(
      <Boxish>
        <CollectionMembershipBadges nodeId={NODE} entries={entries([17, 'Beach'])} variant="list" />
      </Boxish>
    );
    const badge = screen.getByTestId('membership-badge-90210-17');
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute('aria-label')).toBe(
      en.fileManager.membershipChip.replace('{{name}}', 'Beach')
    );
    const row = badge.parentElement;
    const styles = getComputedStyle(row);
    expect(styles.position).toBe('absolute');
    expect(styles.top).toBe('2px');
    expect(styles.left).toBe('2px');
  });

  it('list variant honors overlayTop (search read-only stacking)', () => {
    renderWithProviders(
      <Boxish>
        <CollectionMembershipBadges
          nodeId={NODE}
          entries={entries([17, 'Beach'])}
          variant="list"
          overlayTop={20}
        />
      </Boxish>
    );
    const row = screen.getByTestId('membership-badge-90210-17').parentElement;
    expect(getComputedStyle(row).top).toBe('20px');
  });

  it('grid variant renders TileCornerBadge plates (span, not buttons)', () => {
    const { container } = renderWithProviders(
      <CollectionMembershipBadges nodeId={NODE} entries={entries([17, 'Beach'])} variant="grid" />
    );
    const plate = screen.getByTestId('membership-badge-90210-17');
    expect(plate.tagName).toBe('SPAN');
    expect(plate.querySelector('.MuiSvgIcon-root')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('overflow badge renders +N text with the joined remaining names in aria-label', () => {
    renderWithProviders(
      <CollectionMembershipBadges
        nodeId={NODE}
        entries={entries([1, 'A'], [2, 'B'], [3, 'C'])}
        variant="detail"
      />
    );
    const more = screen.getByTestId('membership-badge-more-90210');
    expect(more.textContent).toBe('+1');
    expect(more.getAttribute('aria-label')).toContain('C');
    expect(more.getAttribute('aria-label')).toContain('1');
  });

  it('locale mirror: both keys exist in en and ko with the {{name}}/{{count}}/{{names}} params', () => {
    expect(en.fileManager.membershipChip).toBe('Member of {{name}}');
    expect(en.fileManager.membershipChipMore).toBe('+{{count}} more — {{names}}');
    expect(ko.fileManager.membershipChip).toContain('{{name}}');
    expect(ko.fileManager.membershipChipMore).toContain('{{count}}');
    expect(ko.fileManager.membershipChipMore).toContain('{{names}}');
  });
});

// position:relative host for the list overlay (mirrors the thumbnail container)
const Boxish = ({ children }) => (
  <div style={{ position: 'relative', width: 56, height: 56 }}>{children}</div>
);
