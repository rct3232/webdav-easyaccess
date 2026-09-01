/**
 * ownerNodeResolver tests — nodeId-based owner detection via closure table.
 *
 * Verifies that isOwnerNode checks ancestry through fileNodesStore.isAncestor(),
 * and canAccessNode delegates to isOwnerNode.
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

  // V5: canAccessNode — owner's own files
  it('V5: returns true when target node is under user root', async () => {
    const userId = 1;
    const rootNodeId = 10;
    const targetNodeId = 20;

    mockFileNodesStore.getUserRootNode.mockResolvedValue({ id: rootNodeId });
    mockFileNodesStore.isAncestor.mockResolvedValue(true);

    const result = await ownerNodeResolver.canAccessNode(userId, targetNodeId);
    expect(result).toBe(true);
    expect(mockFileNodesStore.getUserRootNode).toHaveBeenCalledWith(userId);
    expect(mockFileNodesStore.isAncestor).toHaveBeenCalledWith(rootNodeId, targetNodeId);
  });

  it('V5b: returns true when target node is the user root itself', async () => {
    const userId = 1;
    const rootNodeId = 10;

    mockFileNodesStore.getUserRootNode.mockResolvedValue({ id: rootNodeId });
    // When target === root, should short-circuit without calling isAncestor
    mockFileNodesStore.isAncestor.mockResolvedValue(false);

    const result = await ownerNodeResolver.canAccessNode(userId, rootNodeId);
    expect(result).toBe(true);
  });

  it('V5c: returns false when user has no root node', async () => {
    const userId = 99;
    const targetNodeId = 20;

    mockFileNodesStore.getUserRootNode.mockResolvedValue(null);
    mockFileNodesStore.isAncestor.mockResolvedValue(false);

    const result = await ownerNodeResolver.canAccessNode(userId, targetNodeId);
    expect(result).toBe(false);
    expect(mockFileNodesStore.isAncestor).not.toHaveBeenCalled();
  });

  // V5b: non-owner cannot access private nodes
  it('V5b: returns false when node is not under user root', async () => {
    const userId = 1;
    const rootNodeId = 10;
    const targetNodeId = 99;

    mockFileNodesStore.getUserRootNode.mockResolvedValue({ id: rootNodeId });
    mockFileNodesStore.isAncestor.mockResolvedValue(false);

    const result = await ownerNodeResolver.canAccessNode(userId, targetNodeId);
    expect(result).toBe(false);
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

  // getUserRootNodeId helper
  it('getUserRootNodeId returns the root node id for a user', async () => {
    mockFileNodesStore.getUserRootNode.mockResolvedValue({ id: 10 });

    const result = await ownerNodeResolver.getUserRootNodeId(1);
    expect(result).toBe(10);
  });

  it('getUserRootNodeId returns null when no root exists', async () => {
    mockFileNodesStore.getUserRootNode.mockResolvedValue(null);

    const result = await ownerNodeResolver.getUserRootNodeId(42);
    expect(result).toBeNull();
  });
});
