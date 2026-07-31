/**
 * ownerNodeResolver tests — nodeId-based owner detection via closure table.
 *
 * Verifies that isOwnerNode checks ancestry through fileNodesStore.isAncestor(),
 * canAccessNode delegates to isOwnerNode, and path-based compat functions work.
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

describe('ownerNodeResolver (path-based compat)', () => {
  let ownerNodeResolver;
  let mockFileNodesStore;

  beforeEach(() => {
    jest.resetModules();

    mockFileNodesStore = {
      getUserRootNode: jest.fn(),
      isAncestor: jest.fn(),
    };

    jest.doMock('../../../../store/fileNodesStore', () => ({
      createFileNodesStore: () => mockFileNodesStore,
    }));

    ownerNodeResolver = require('../ownerNodeResolver');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // userRootPath
  it('userRootPath returns /{username} for a valid user', () => {
    const result = ownerNodeResolver.userRootPath({ username: 'alice' });
    expect(result).toBe('/alice');
  });

  it('userRootPath returns null for missing user', () => {
    expect(ownerNodeResolver.userRootPath(null)).toBeNull();
    expect(ownerNodeResolver.userRootPath(undefined)).toBeNull();
    expect(ownerNodeResolver.userRootPath({})).toBeNull();
  });

  // isOwnerPath
  it('isOwnerPath returns true when path equals root', () => {
    const user = { username: 'alice' };
    expect(ownerNodeResolver.isOwnerPath(user, '/alice')).toBe(true);
  });

  it('isOwnerPath returns true when path is under root', () => {
    const user = { username: 'alice' };
    expect(ownerNodeResolver.isOwnerPath(user, '/alice/docs')).toBe(true);
    expect(ownerNodeResolver.isOwnerPath(user, '/alice/docs/sub')).toBe(true);
  });

  it('isOwnerPath returns false for another user\'s path', () => {
    const user = { username: 'alice' };
    expect(ownerNodeResolver.isOwnerPath(user, '/bob/docs')).toBe(false);
  });

  it('isOwnerPath returns false when prefix mismatch (e.g. /alice vs /alicer)', () => {
    const user = { username: 'alice' };
    expect(ownerNodeResolver.isOwnerPath(user, '/alicer/docs')).toBe(false);
  });

  // getHomeOwnerUserIdForPath
  it('getHomeOwnerUserIdForPath returns userId for valid path', async () => {
    jest.resetModules();
    const mockFileNodesStore2 = {
      getUserRootNode: jest.fn(),
      isAncestor: jest.fn(),
    };
    jest.doMock('../../../../store/fileNodesStore', () => ({
      createFileNodesStore: () => mockFileNodesStore2,
    }));
    jest.doMock('../../../../models/User', () => ({
      findByUsername: jest.fn().mockResolvedValue({ id: 42 }),
    }));
    const resolver = require('../ownerNodeResolver');
    const result = await resolver.getHomeOwnerUserIdForPath('/alice/docs/file.txt');
    expect(result).toBe(42);
  });

  it('getHomeOwnerUserIdForPath returns null for empty path', async () => {
    jest.resetModules();
    const mockFileNodesStore3 = {
      getUserRootNode: jest.fn(),
      isAncestor: jest.fn(),
    };
    jest.doMock('../../../../store/fileNodesStore', () => ({
      createFileNodesStore: () => mockFileNodesStore3,
    }));
    jest.doMock('../../../../models/User', () => ({
      findByUsername: jest.fn().mockResolvedValue(null),
    }));
    const resolver = require('../ownerNodeResolver');
    const result = await resolver.getHomeOwnerUserIdForPath('/');
    expect(result).toBeNull();
  });

  it('getHomeOwnerUserIdForPath returns null when user not found', async () => {
    jest.resetModules();
    const mockFileNodesStore4 = {
      getUserRootNode: jest.fn(),
      isAncestor: jest.fn(),
    };
    jest.doMock('../../../../store/fileNodesStore', () => ({
      createFileNodesStore: () => mockFileNodesStore4,
    }));
    jest.doMock('../../../../models/User', () => ({
      findByUsername: jest.fn().mockResolvedValue(null),
    }));
    const resolver = require('../ownerNodeResolver');
    const result = await resolver.getHomeOwnerUserIdForPath('/unknown/docs');
    expect(result).toBeNull();
  });
});
