/**
 * MemberRowControls tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/file-manager/MemberRowControls.md
 * (§3.2 exact member-row control set; grep-able move/copy/rename/delete absence invariant)
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import MemberRowControls from '../MemberRowControls';

const ownerCollection = { origin: 'user', publish_mode: 'ask', granted_role: 'owner' };
const sharedEditorCollection = { origin: 'user', publish_mode: 'ask', granted_role: 'editor' };
const viewerCollection = { origin: 'user', publish_mode: 'ask', granted_role: 'viewer' };
const autoCollection = { origin: 'system', publish_mode: 'auto', granted_role: 'owner' };

const member = {
  node_id: 10,
  membership: 'stored',
  published: false,
  state: 'normal',
  shared_excluded: false,
  liked: false,
  reason: null,
};

const defaultProps = {
  open: true,
  contextMenu: { mouseX: 10, mouseY: 10 },
  member,
  collection: ownerCollection,
  onExclude: jest.fn(),
  onPublish: jest.fn(),
  onDownload: jest.fn(),
  onShowOriginal: jest.fn(),
  onProperties: jest.fn(),
  onToggleLike: jest.fn(),
  onAddToOther: jest.fn(),
  onClose: jest.fn(),
};

describe('MemberRowControls single-row set (§3.2 exact)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders exactly the §3.2 set and never file-mutating items', () => {
    renderWithProviders(<MemberRowControls {...defaultProps} />);

    expect(screen.getByTestId('member-exclude')).toBeInTheDocument();
    expect(screen.getByTestId('member-publish')).toBeInTheDocument();
    expect(screen.getByTestId('member-download')).toBeInTheDocument();
    expect(screen.getByTestId('member-show-original')).toBeInTheDocument();
    expect(screen.getByTestId('member-properties')).toBeInTheDocument();
    expect(screen.getByTestId('like-toggle')).toBeInTheDocument();

    expect(screen.queryByText(/move/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/copy/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rename/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
  });

  it('each action fires its callback with the member row and closes', () => {
    renderWithProviders(<MemberRowControls {...defaultProps} />);

    fireEvent.click(screen.getByTestId('member-exclude'));
    expect(defaultProps.onExclude).toHaveBeenCalledWith(member);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('member-download'));
    expect(defaultProps.onDownload).toHaveBeenCalledWith(member);

    fireEvent.click(screen.getByTestId('member-show-original'));
    expect(defaultProps.onShowOriginal).toHaveBeenCalledWith(member);

    fireEvent.click(screen.getByTestId('member-properties'));
    expect(defaultProps.onProperties).toHaveBeenCalledWith(member);
  });

  it('like toggle reflects the row `liked` verbatim (viewer-scoped, invariant 9)', () => {
    const { unmount } = renderWithProviders(<MemberRowControls {...defaultProps} />);
    expect(screen.getByTestId('like-toggle')).toHaveTextContent('Like');
    expect(screen.queryByText(/likes|lovers|\(\d+\)/i)).not.toBeInTheDocument();
    unmount();

    renderWithProviders(
      <MemberRowControls {...defaultProps} member={{ ...member, liked: true }} />
    );
    expect(screen.getByTestId('like-toggle')).toHaveTextContent('Unlike');
    fireEvent.click(screen.getByTestId('like-toggle'));
    expect(defaultProps.onToggleLike).toHaveBeenCalledWith({ ...member, liked: true });
  });

  it('publish row reflects the stored flag: Unpublish when published', () => {
    renderWithProviders(
      <MemberRowControls {...defaultProps} member={{ ...member, published: true }} />
    );
    expect(screen.getByTestId('member-publish')).toHaveTextContent(/unpublish/i);
  });

  it('publish_mode auto ⇒ publish toggles absent (nothing to gate)', () => {
    renderWithProviders(<MemberRowControls {...defaultProps} collection={autoCollection} />);
    expect(screen.queryByTestId('member-publish')).not.toBeInTheDocument();
  });

  it('viewer grantee gets no publish control at all', () => {
    renderWithProviders(<MemberRowControls {...defaultProps} collection={viewerCollection} />);
    expect(screen.queryByTestId('member-publish')).not.toBeInTheDocument();
  });

  it('editor grantee keeps publish control (§4.7)', () => {
    renderWithProviders(
      <MemberRowControls {...defaultProps} collection={sharedEditorCollection} />
    );
    expect(screen.getByTestId('member-publish')).toBeInTheDocument();
  });

  it('shared_excluded row: Not-owner chip in owner view, no publish toggle', () => {
    renderWithProviders(
      <MemberRowControls {...defaultProps} member={{ ...member, shared_excluded: true }} />
    );
    expect(screen.getByTestId('member-not-shared-chip')).toHaveTextContent(
      "Not owner's file — not shared"
    );
    expect(screen.queryByTestId('member-publish')).not.toBeInTheDocument();
  });

  it('revoked row renders NOTHING except close (no name/thumbnail exposure)', () => {
    renderWithProviders(
      <MemberRowControls {...defaultProps} member={{ ...member, state: 'revoked', liked: true }} />
    );
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(screen.queryByTestId('member-exclude')).not.toBeInTheDocument();
    expect(screen.queryByTestId('like-toggle')).not.toBeInTheDocument();
  });

  it('callback-provided gating: withheld callbacks omit rows (host member-context variant)', () => {
    renderWithProviders(
      <MemberRowControls
        {...defaultProps}
        onDownload={undefined}
        onPublish={undefined}
        onShowOriginal={undefined}
      />
    );
    expect(screen.queryByTestId('member-download')).not.toBeInTheDocument();
    expect(screen.queryByTestId('member-publish')).not.toBeInTheDocument();
    expect(screen.queryByTestId('member-show-original')).not.toBeInTheDocument();
    expect(screen.getByTestId('member-exclude')).toBeInTheDocument();
  });
});

describe('MemberRowControls multi-select (bulk toolbar) variant', () => {
  const selectedRows = [member, { ...member, node_id: 11 }];

  beforeEach(() => jest.clearAllMocks());

  it('offers batch exclude + Add to another collection and NO delete affordance', () => {
    renderWithProviders(
      <MemberRowControls {...defaultProps} member={undefined} selectedRows={selectedRows} />
    );

    expect(screen.getByTestId('member-batch-exclude')).toBeInTheDocument();
    expect(screen.getByTestId('member-add-to-other')).toBeInTheDocument();
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/move/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rename/i)).not.toBeInTheDocument();
  });

  it('batch actions receive the eligible selected rows', () => {
    renderWithProviders(
      <MemberRowControls {...defaultProps} member={undefined} selectedRows={selectedRows} />
    );

    fireEvent.click(screen.getByTestId('member-batch-exclude'));
    expect(defaultProps.onExclude).toHaveBeenCalledWith(selectedRows);

    fireEvent.click(screen.getByTestId('member-add-to-other'));
    expect(defaultProps.onAddToOther).toHaveBeenCalledWith(selectedRows);
  });
});

describe('MemberRowControls — publishable gate client-rule fix (P-4)', () => {
  beforeEach(() => jest.clearAllMocks());

  const ownCollection = { origin: 'user', publish_mode: 'ask', granted_role: null };

  it('OFFERS publish on an OWN collection (granted_role null) — the owner-visibility fix', () => {
    renderWithProviders(<MemberRowControls {...defaultProps} collection={ownCollection} />);
    expect(screen.getByTestId('member-publish')).toBeInTheDocument();
  });

  it('hides publish for a viewer grantee (granted_role viewer)', () => {
    renderWithProviders(<MemberRowControls {...defaultProps} collection={viewerCollection} />);
    expect(screen.queryByTestId('member-publish')).not.toBeInTheDocument();
  });

  it('hides publish on the row when shared_excluded (own collection)', () => {
    renderWithProviders(
      <MemberRowControls
        {...defaultProps}
        collection={ownCollection}
        member={{ ...member, shared_excluded: true }}
      />
    );
    expect(screen.queryByTestId('member-publish')).not.toBeInTheDocument();
  });

  it('bulk variant respects the same own-collection rule', () => {
    renderWithProviders(
      <MemberRowControls
        {...defaultProps}
        collection={ownCollection}
        member={null}
        selectedRows={[member]}
      />
    );
    expect(screen.getByTestId('member-batch-publish')).toBeInTheDocument();
  });
});
