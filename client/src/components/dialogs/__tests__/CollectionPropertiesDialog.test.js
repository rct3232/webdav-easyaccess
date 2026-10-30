/**
 * CollectionPropertiesDialog tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/dialogs/CollectionPropertiesDialog.md §2.3/§2.9/§2.10.
 * The dialog is a pure view — every test drives it through props only.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, within, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import CollectionPropertiesDialog from '../CollectionPropertiesDialog';

jest.mock('../../../hooks/useResponsive', () => {
  const { createUseResponsiveModuleMock } = require('../../../testing/mocks/useResponsiveMock');
  return createUseResponsiveModuleMock();
});

const OWNER_ROW = {
  collection_id: 7,
  owner_id: 1,
  name: 'Roadtrip photos',
  origin: 'user',
  status: 'active',
  publish_mode: 'ask',
  pinned: false,
  pinned_by: null,
  name_locked: false,
  granted_role: null,
  item_count: 14,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-05T00:00:00Z',
  last_member_change_at: '2026-09-04T00:00:00Z',
};

const SEED_VECTOR_ROW = {
  ...OWNER_ROW,
  origin: 'seed',
  definition: { kind: 'seed_vector', seed_ref: 42, theta: 0.61 },
};

const RULE_ROW = {
  ...OWNER_ROW,
  definition: { kind: 'predicate', all_of: [{ type: 'path', value: '/photos' }] },
};

const GRANTEE_ROW = {
  ...OWNER_ROW,
  granted_role: 'viewer',
  // grantee rows simply omit `definition` (routes/collections.md §2.4)
};

const GRANTS = [
  {
    grantee_id: 9,
    username: 'bob',
    role: 'viewer',
    granted_by: 1,
    created_at: '2026-09-02T00:00:00Z',
  },
  {
    grantee_id: 10,
    username: 'carol',
    role: 'editor',
    granted_by: 1,
    created_at: '2026-09-03T00:00:00Z',
  },
];

// users/approved parity rows: the server read already excludes the requester
// and admin users; the is_admin row pins the picker's defense-in-depth filter.
const SHAREABLE_USERS = [
  { id: 9, username: 'bob', email: 'bob@e.test' },
  { id: 10, username: 'carol', email: 'carol@e.test' },
  { id: 11, username: 'dave', email: 'dave@e.test' },
  { id: 12, username: 'mallory', email: 'm@e.test', is_admin: true },
];

function openDialog(overrides = {}) {
  const props = {
    open: true,
    onClose: jest.fn(),
    collection: OWNER_ROW,
    onSave: jest.fn().mockResolvedValue(true),
    grants: GRANTS,
    shareableUsers: SHAREABLE_USERS,
    ...overrides,
  };
  const utils = renderWithProviders(<CollectionPropertiesDialog {...props} />);
  return { props, utils };
}

function openSharing(overrides = {}) {
  return openDialog({ collection: OWNER_ROW, initialTab: 'sharing', ...overrides });
}

function nameInput() {
  return screen.getByTestId('collection-name-field').querySelector('input');
}

async function waitForRemoved(element) {
  for (let i = 0; i < 50 && document.body.contains(element); i += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  return !document.body.contains(element);
}

describe('CollectionPropertiesDialog', () => {
  describe('tab bar (§2.4)', () => {
    it('renders title → tabs → body → fixed Close bar in document order, Info default-active', () => {
      const { utils } = openDialog();

      expect(screen.getByText('Properties')).toBeInTheDocument();
      const infoTab = screen.getByTestId('collection-props-tab-info');
      expect(infoTab).toHaveAttribute('aria-selected', 'true');
      // collections are not versioned — nothing fills a Versions-style slot
      expect(screen.queryByText('Versions')).not.toBeInTheDocument();

      const dialog = screen.getByRole('dialog');
      const order = [
        ...dialog.querySelectorAll(
          '.MuiDialogTitle-root, .MuiTabs-root, .MuiDialogContent-root, .MuiDialogActions-root'
        ),
      ].map((node) =>
        node.className
          .split(' ')
          .find((c) => /Mui(DialogTitle|Tabs|DialogContent|DialogActions)-root/.test(c))
      );
      expect(order).toEqual([
        'MuiDialogTitle-root',
        'MuiTabs-root',
        'MuiDialogContent-root',
        'MuiDialogActions-root',
      ]);
      expect(
        within(dialog.querySelector('.MuiDialogActions-root')).getByRole('button', {
          name: 'Close',
        })
      ).toBeInTheDocument();
      // clean draft ⇒ no Save affordance
      expect(screen.queryByTestId('collection-props-save')).not.toBeInTheDocument();

      utils.unmount();
    });

    it('grantee row: Info minus definition facts, NO AI Info and NO Sharing tabs (absent, not disabled)', () => {
      const { utils } = openDialog({ collection: GRANTEE_ROW });

      expect(screen.getByTestId('collection-props-tab-info')).toBeInTheDocument();
      expect(screen.queryByTestId('collection-props-tab-ai')).not.toBeInTheDocument();
      expect(screen.queryByTestId('collection-props-tab-sharing')).not.toBeInTheDocument();
      // the name renders in the inline draft field (an input VALUE, not text)
      expect(nameInput()).toHaveValue('Roadtrip photos');

      utils.unmount();
    });

    it('initialTab="sharing" opens the Sharing tab directly (card menu dispatch)', () => {
      const { utils } = openDialog({ collection: SEED_VECTOR_ROW, initialTab: 'sharing' });

      expect(screen.getByTestId('collection-props-tab-sharing')).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByRole('radio', { name: 'Ask' })).toBeChecked();

      utils.unmount();
    });

    it('unknown initialTab falls back to Info (§2.10)', () => {
      const { utils } = openDialog({ initialTab: 'bogus' });

      expect(screen.getByTestId('collection-props-tab-info')).toHaveAttribute(
        'aria-selected',
        'true'
      );

      utils.unmount();
    });

    it('AI Info is capability-gated: absent-not-disabled for embed=false, present for embed=true, never for rule definitions', () => {
      const embedOff = openDialog({
        collection: SEED_VECTOR_ROW,
        aiFlags: { embed: false, chat: false },
      });
      expect(screen.queryByTestId('collection-props-tab-ai')).toBeNull();
      expect(screen.queryByText('gray')).toBeNull(); // affordance hidden, never disabled
      embedOff.utils.unmount();

      const embedOn = openDialog({
        collection: SEED_VECTOR_ROW,
        aiFlags: { embed: true, chat: false },
      });
      expect(screen.getByTestId('collection-props-tab-ai')).toBeInTheDocument();
      embedOn.utils.unmount();

      const rule = openDialog({
        collection: RULE_ROW,
        aiFlags: { embed: true, chat: true },
      });
      expect(screen.queryByTestId('collection-props-tab-ai')).toBeNull();
      rule.utils.unmount();
    });

    it('AI Info renders definition facts only: localized kind, theta, seed name, naming provenance', () => {
      const seed = openDialog({
        collection: SEED_VECTOR_ROW,
        aiFlags: { embed: true, chat: false },
        initialTab: 'ai',
        seedName: 'beach.jpg',
      });

      const facts = screen.getByTestId('collection-ai-facts');
      expect(within(facts).getByText('Similar files (seed)')).toBeInTheDocument();
      expect(within(facts).getByText(/0\.61/)).toBeInTheDocument();
      expect(within(facts).getByText(/beach\.jpg/)).toBeInTheDocument();
      expect(within(facts).getByText('Auto-named')).toBeInTheDocument();
      // no raw internals on the wire-visible surface
      expect(within(facts).queryByText(/seed_ref/)).not.toBeInTheDocument();
      seed.utils.unmount();

      const locked = openDialog({
        collection: { ...SEED_VECTOR_ROW, name_locked: true },
        aiFlags: { embed: true, chat: false },
        initialTab: 'ai',
      });
      expect(
        within(screen.getByTestId('collection-ai-facts')).getByText('Name locked')
      ).toBeInTheDocument();
      locked.utils.unmount();
    });

    it('grantee row never sees the Sharing tab even when initialTab requests it', () => {
      const { utils } = openDialog({ collection: GRANTEE_ROW, initialTab: 'sharing' });

      expect(screen.queryByTestId('collection-props-tab-sharing')).not.toBeInTheDocument();
      // unavailable tab ⇒ Info fallback
      expect(screen.getByTestId('collection-props-tab-info')).toHaveAttribute(
        'aria-selected',
        'true'
      );

      utils.unmount();
    });
  });

  describe('Info tab (§2.4)', () => {
    it('shows origin/status/publish-mode chips, item count and timestamps', () => {
      const { utils } = openDialog();

      expect(screen.getByTestId('collection-origin-chip')).toHaveTextContent('Manual');
      expect(screen.getByTestId('collection-status-chip')).toHaveTextContent('Active');
      expect(screen.getByTestId('collection-publish-mode-chip')).toHaveTextContent('Ask');
      expect(screen.getByTestId('collection-item-count')).toHaveTextContent('14');
      expect(screen.getByTestId('collection-created-at')).toBeInTheDocument();
      expect(screen.getByTestId('collection-updated-at')).toBeInTheDocument();
      utils.unmount();
    });

    it('member preview: null loads a skeleton, a payload renders sample chips + plus N more, false renders a non-fatal placeholder', () => {
      const loading = openDialog({ preview: null });
      expect(screen.getByTestId('collection-preview-loading')).toBeInTheDocument();
      loading.utils.unmount();

      const sample = Array.from({ length: 12 }, (_, i) => ({
        node_id: 100 + i,
        name: `f${i}.txt`,
      }));
      const loaded = openDialog({ preview: { count: 14, sample, sample_truncated: true } });
      expect(screen.getByTestId('collection-preview-sample-100')).toHaveTextContent('f0.txt');
      expect(screen.getByTestId('collection-preview-more')).toHaveTextContent('2');
      loaded.utils.unmount();

      const failed = openDialog({ preview: false });
      expect(screen.getByTestId('collection-preview-unavailable')).toBeInTheDocument();
      // non-fatal: the dialog renders with its tabs intact
      expect(screen.getByTestId('collection-props-tab-info')).toBeInTheDocument();
      failed.utils.unmount();
    });

    it('rename stays in the draft: no onSave before Save; Save dispatches only { name } and closes on success', async () => {
      const { props, utils } = openDialog();

      fireEvent.change(nameInput(), { target: { value: 'Renamed set' } });

      expect(props.onSave).not.toHaveBeenCalled();
      const save = screen.getByTestId('collection-props-save');
      expect(save).toBeInTheDocument();

      fireEvent.click(save);

      await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
      expect(props.onSave).toHaveBeenCalledWith({ name: 'Renamed set' });
      await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
      utils.unmount();
    });

    it('an external row refresh does not reset an in-progress name draft (reset effect keys on id, not name)', () => {
      const { props, utils } = openDialog();

      fireEvent.change(nameInput(), { target: { value: 'My draft' } });
      utils.rerender(
        <CollectionPropertiesDialog
          {...props}
          collection={{ ...OWNER_ROW, name: 'Server renamed' }}
        />
      );

      expect(nameInput()).toHaveValue('My draft');
      expect(screen.getByTestId('collection-props-save')).toBeInTheDocument();
    });

    it('empty name keeps the draft dirty but disables Save', () => {
      const { props, utils } = openDialog();

      fireEvent.change(nameInput(), { target: { value: '   ' } });

      const save = screen.getByTestId('collection-props-save');
      expect(save).toBeDisabled();
      fireEvent.click(save);
      expect(props.onSave).not.toHaveBeenCalled();
      utils.unmount();
    });

    it('auto-pin chip shows the unpin CTA mutating the draft; Save dispatches { pinned:false }', async () => {
      const { props, utils } = openDialog({
        collection: { ...OWNER_ROW, pinned: true, pinned_by: 'auto' },
      });

      expect(screen.getByTestId('collection-autopin-chip')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('collection-unpin'));
      expect(props.onSave).not.toHaveBeenCalled();
      expect(screen.queryByTestId('collection-pin-row')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('collection-props-save'));
      await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ pinned: false }));
      utils.unmount();
    });
  });

  describe('draft persistence + dirty-close prompt (§2.3)', () => {
    it('clean Close closes immediately without a prompt', () => {
      const { props, utils } = openDialog();

      fireEvent.click(screen.getByTestId('collection-props-close'));

      expect(props.onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('collection-props-unsaved-dialog')).not.toBeInTheDocument();
      utils.unmount();
    });

    it('dirty Close opens Save/Discard/Cancel; Cancel keeps the draft, Discard closes without saving', async () => {
      const { props, utils } = openDialog();

      fireEvent.change(nameInput(), { target: { value: 'Draft name' } });
      fireEvent.click(screen.getByTestId('collection-props-close'));

      expect(props.onClose).not.toHaveBeenCalled();
      const prompt = screen.getByTestId('collection-props-unsaved-dialog');
      expect(within(prompt).getByText('Unsaved changes')).toBeInTheDocument();
      expect(within(prompt).getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(within(prompt).getByRole('button', { name: 'Discard' })).toBeInTheDocument();
      expect(within(prompt).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('collection-props-close-cancel'));
      await waitFor(() =>
        expect(screen.queryByTestId('collection-props-unsaved-dialog')).not.toBeInTheDocument()
      );
      expect(nameInput()).toHaveValue('Draft name');
      expect(props.onSave).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('collection-props-close'));
      fireEvent.click(screen.getByTestId('collection-props-close-discard'));
      expect(props.onClose).toHaveBeenCalledTimes(1);
      expect(props.onSave).not.toHaveBeenCalled();
      utils.unmount();
    });

    it('dirty-close Save commits the draft and closes on success', async () => {
      const { props, utils } = openDialog();

      fireEvent.change(nameInput(), { target: { value: 'Prompt saved' } });
      fireEvent.click(screen.getByTestId('collection-props-close'));
      fireEvent.click(screen.getByTestId('collection-props-close-save'));

      await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ name: 'Prompt saved' }));
      await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
      utils.unmount();
    });

    it('a failed save keeps the dialog open with the draft intact', async () => {
      const onSave = jest.fn().mockResolvedValue(false);
      const { props, utils } = openSharing({ onSave });

      fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
      fireEvent.click(screen.getByTestId('collection-props-save'));

      await waitFor(() => expect(onSave).toHaveBeenCalledWith({ publishMode: 'auto' }));
      expect(props.onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('radio', { name: 'Auto' })).toBeChecked();
      expect(screen.getByTestId('collection-props-save')).toBeInTheDocument();
      utils.unmount();
    });

    it('saving blocks every close path until the pending save settles', async () => {
      let resolveSave;
      const onSave = jest.fn(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          })
      );
      const { props, utils } = openDialog({ onSave });

      fireEvent.change(nameInput(), { target: { value: 'Pending' } });
      fireEvent.click(screen.getByTestId('collection-props-save'));

      expect(await screen.findByText('Saving...')).toBeInTheDocument();
      expect(screen.getByTestId('collection-props-close')).toBeDisabled();
      fireEvent.click(screen.getByTestId('collection-props-close'));
      expect(props.onClose).not.toHaveBeenCalled();
      expect(screen.queryByTestId('collection-props-unsaved-dialog')).not.toBeInTheDocument();

      resolveSave(true);
      await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
      utils.unmount();
    });
  });

  describe('Sharing tab (§2.4) — owner-only draft', () => {
    it('publish_mode radio mutates the draft, the Info chip follows it, and Save sends the whole plan from any tab', async () => {
      const { props, utils } = openSharing();

      expect(screen.getByRole('radio', { name: 'Ask' })).toBeChecked();
      fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
      expect(props.onSave).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('collection-props-tab-info'));
      expect(screen.getByTestId('collection-publish-mode-chip')).toHaveTextContent('Auto');
      expect(screen.getByTestId('collection-props-save')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('collection-props-save'));
      await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ publishMode: 'auto' }));
      await waitFor(() => expect(props.onClose).toHaveBeenCalled());
      utils.unmount();

      const off = openSharing({ collection: { ...OWNER_ROW, publish_mode: 'off' } });
      expect(screen.getByRole('radio', { name: 'Off' })).toBeChecked();
      off.utils.unmount();
    });

    it('carries the per-mode helper text, the exposure-explicit note and the initial-batch footer', () => {
      const { utils } = openSharing();

      expect(screen.getByTestId('collection-publish-mode-help')).toHaveTextContent(/park/i);
      expect(screen.getByTestId('collection-publish-mode-exposure-note')).toBeInTheDocument();
      expect(screen.getByTestId('collection-publish-initial-note')).toBeInTheDocument();
      utils.unmount();
    });

    it('grants skeleton while loading; empty copy when no grants; rows show username, LOCALIZED role chip and the unified revoke label', () => {
      const loading = openSharing({ grants: null });
      expect(screen.getByTestId('collection-grants-loading')).toBeInTheDocument();
      expect(screen.getByTestId('collection-grant-add')).toBeDisabled();
      loading.utils.unmount();

      const empty = openSharing({ grants: [] });
      expect(screen.getByTestId('collection-grants-empty')).toBeInTheDocument();
      empty.utils.unmount();

      const { utils } = openSharing({ grants: GRANTS });
      const row = screen.getByTestId('collection-grant-row-9');
      expect(within(row).getByText('bob')).toBeInTheDocument();
      expect(within(row).getByText('Viewer')).toBeInTheDocument(); // permissions.viewer — never the raw enum
      expect(within(row).queryByText('viewer')).not.toBeInTheDocument();
      expect(
        within(screen.getByTestId('collection-grant-row-10')).getByText('Editor')
      ).toBeInTheDocument();
      // P-1 unified label on the revoke action
      expect(within(row).getByRole('button', { name: 'Revoke permission' })).toBeInTheDocument();
      utils.unmount();
    });

    it('the added row merges into the Shared with list as a viewer draft; no separate pending list and no write', async () => {
      const { props, utils } = openSharing();

      fireEvent.click(screen.getByTestId('collection-grant-add'));
      const menu = await screen.findByRole('menu');
      // the removed bottom role toggle is gone — Add user is the only add chrome
      expect(screen.queryByTestId('collection-grant-role-viewer')).not.toBeInTheDocument();
      expect(within(menu).getByText('dave')).toBeInTheDocument();
      expect(within(menu).queryByText('bob')).not.toBeInTheDocument();
      expect(within(menu).queryByText('carol')).not.toBeInTheDocument();
      expect(within(menu).queryByText('mallory')).not.toBeInTheDocument();

      fireEvent.click(within(menu).getByText('dave'));

      const row = await screen.findByTestId('collection-grant-row-11');
      expect(within(row).getByText('Viewer')).toBeInTheDocument();
      expect(screen.getByTestId('collection-props-save')).toBeInTheDocument();
      expect(props.onSave).not.toHaveBeenCalled();

      // the draft row filters the next candidate list immediately
      fireEvent.click(screen.getByTestId('collection-grant-add'));
      const reopened = await screen.findByRole('menu');
      expect(within(reopened).queryByText('dave')).not.toBeInTheDocument();
      utils.unmount();
    });

    it('role badge toggles viewer/editor in the draft and Save sends only the changed grant rows', async () => {
      const { props, utils } = openSharing();

      fireEvent.click(screen.getByTestId('collection-grant-add'));
      fireEvent.click(within(await screen.findByRole('menu')).getByText('dave'));

      fireEvent.click(await screen.findByTestId('collection-grant-role-11'));
      expect(screen.getByTestId('collection-grant-role-11')).toHaveTextContent('Editor');
      fireEvent.click(screen.getByTestId('collection-grant-revoke-9'));
      expect(screen.queryByTestId('collection-grant-row-9')).not.toBeInTheDocument();
      expect(props.onSave).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('collection-props-save'));

      await waitFor(() =>
        expect(props.onSave).toHaveBeenCalledWith({
          grants: { upsert: [{ userId: 11, role: 'editor' }], revoke: [9] },
        })
      );
      utils.unmount();
    });

    it('remove → re-add restores the baseline role (no dirty diff)', async () => {
      const { utils } = openSharing();

      // carol's baseline role is editor
      fireEvent.click(screen.getByTestId('collection-grant-revoke-10'));
      expect(screen.queryByTestId('collection-grant-row-10')).not.toBeInTheDocument();
      expect(screen.getByTestId('collection-props-save')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('collection-grant-add'));
      const menu = await screen.findByRole('menu');
      fireEvent.click(within(menu).getByText('carol'));

      expect(await screen.findByTestId('collection-grant-row-10')).toHaveTextContent('Editor');
      expect(screen.queryByTestId('collection-props-save')).not.toBeInTheDocument();
      utils.unmount();
    });

    it('switching tabs closes an open picker', async () => {
      const { utils } = openSharing();

      fireEvent.click(screen.getByTestId('collection-grant-add'));
      const menu = await screen.findByRole('menu');
      fireEvent.click(screen.getByTestId('collection-props-tab-info'));

      expect(await waitForRemoved(menu)).toBe(true);
      utils.unmount();
    });
  });

  describe('locale mirror (§2.8)', () => {
    it('every new dialog/collections key exists in en AND ko (translated, never copied)', () => {
      const en = require('../../../locales/en.json');
      const ko = require('../../../locales/ko.json');

      const dialogKeys = [
        'collectionTabInfo',
        'collectionTabAi',
        'collectionTabSharing',
        'collectionName',
        'collectionOrigin',
        'collectionOriginUser',
        'collectionOriginSystem',
        'collectionOriginSeed',
        'collectionOriginSearch',
        'collectionStatusActive',
        'collectionStatusArchived',
        'collectionPinnedAuto',
        'collectionPinnedUser',
        'collectionItemCount',
        'collectionCreatedAt',
        'collectionUpdatedAt',
        'collectionLastMemberChange',
        'collectionPreview',
        'collectionPreviewUnavailable',
        'collectionGrants',
        'collectionGrantsEmpty',
        'collectionGrantRoleToggle',
        'collectionRenameSave',
        'collectionUnpin',
        'collectionUnsavedTitle',
        'collectionUnsavedMessage',
        'collectionDiscard',
        'publishModeTitle',
        'publishModeAsk',
        'publishModeOff',
        'publishModeAuto',
        'publishModeAskHelper',
        'publishModeOffHelper',
        'publishModeAutoHelper',
        'publishModeExposureNote',
        'collectionPublishInitialNote',
        'collectionAiInfoKind',
        'collectionAiInfoTheta',
        'collectionAiInfoSeed',
        'collectionAiInfoProvenance',
        'collectionAiKindSeedVector',
        'collectionAiKindCentroid',
        'collectionAiProvenanceTemplate',
        'collectionAiProvenanceLocked',
      ];
      for (const key of dialogKeys) {
        expect(typeof en.dialogs[key]).toBe('string');
        expect(en.dialogs[key].length).toBeGreaterThan(0);
        expect(typeof ko.dialogs[key]).toBe('string');
        expect(ko.dialogs[key].length).toBeGreaterThan(0);
        expect(ko.dialogs[key]).not.toBe(en.dialogs[key]);
      }

      expect(typeof en.collections.propertiesSaved).toBe('string');
      expect(en.collections.propertiesSaved.length).toBeGreaterThan(0);
      expect(typeof ko.collections.propertiesSaved).toBe('string');
      expect(ko.collections.propertiesSaved).not.toBe(en.collections.propertiesSaved);

      // P-1 unified revoke label reused verbatim (EN "Revoke permission")
      expect(en.dialogs.revokePermission).toBe('Revoke permission');
      expect(ko.dialogs.revokePermission).toBe('권한 반납');
    });
  });
});
