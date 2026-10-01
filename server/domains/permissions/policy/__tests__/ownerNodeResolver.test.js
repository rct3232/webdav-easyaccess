/**
 * ownerNodeResolver tests — nodeId-based owner detection via closure table.
 *
 * Verifies that isOwnerNode checks ancestry through fileNodesStore.isAncestor().
 */

describe('ownerNodeResolver (nodeId)', () => {
  let ownerNodeResolver;
  let mockFileNodesStore;
  let mockUserStore;

  beforeEach(() => {
    jest.resetModules();

    mockFileNodesStore = {
      getUserRootNode: jest.fn(),
      isAncestor: jest.fn(),
    };

    mockUserStore = {
      findById: jest.fn(),
    };

    jest.doMock('../../../../store/fileNodesStore', () => ({
      createFileNodesStore: () => mockFileNodesStore,
    }));

    jest.doMock('../../../../store/userStore', () => mockUserStore);

    ownerNodeResolver = require('../ownerNodeResolver');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // isOwnerNode directly
  it('isOwnerNode returns true for descendant node', async () => {
    mockFileNodesStore.getUserRootNode.mockResolvedValue({ id: 10 });
    mockFileNodesStore.isAncestor.mockResolvedValue(true);

    const result = await ownerNodeResolver.isOwnerNode(1, 20);
    expect(result).toBe(true);
  });

  it('isOwnerNode returns false for unrelated node', async () => {
    mockFileNodesStore.getUserRootNode.mockResolvedValue({ id: 10 });
    mockFileNodesStore.isAncestor.mockResolvedValue(false);

    const result = await ownerNodeResolver.isOwnerNode(1, 99);
    expect(result).toBe(false);
  });

  it('isOwnerNode returns false when no root node exists', async () => {
    mockFileNodesStore.getUserRootNode.mockResolvedValue(null);

    const result = await ownerNodeResolver.isOwnerNode(42, 50);
    expect(result).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Admin convention (permissionPolicy: admin-owns-everything) — owner-approved
  // 2026-10-01: isOwnerNode honors the same rule as isAdminUser in
  // permissionPolicy.js (cross-leak foreign defect, docs/features/permissions.md).
  // --------------------------------------------------------------------------

  it('isOwnerNode returns true for an ADMIN user on ANY node, even outside every home', async () => {
    mockUserStore.findById.mockResolvedValue({ id: 1, username: 'admin1', is_admin: true });
    mockFileNodesStore.getUserRootNode.mockResolvedValue(null);
    mockFileNodesStore.isAncestor.mockResolvedValue(false);

    const result = await ownerNodeResolver.isOwnerNode(1, 99);
    expect(result).toBe(true);
  });

  it('isOwnerNode keeps pure ancestry ownership for non-admin users', async () => {
    mockUserStore.findById.mockResolvedValue({ id: 1, username: 'alice', is_admin: false });
    mockFileNodesStore.getUserRootNode.mockResolvedValue({ id: 10 });
    mockFileNodesStore.isAncestor.mockResolvedValue(false);

    const result = await ownerNodeResolver.isOwnerNode(1, 99);
    expect(result).toBe(false);
  });
});
