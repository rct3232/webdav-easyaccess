/**
 * inheritancePolicy tests — nodeId-based ancestor permission resolution.
 *
 * Verifies that getEffectivePermission traverses the closure table via permStore
 * to find the highest-rank permission from the nearest ancestor.
 */

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');

describe('inheritancePolicy (nodeId)', () => {
  let inheritancePolicy;
  let mockPermStore;

  beforeEach(() => {
    jest.resetModules();

    mockPermStore = {
      getPathEffectivePermission: jest.fn(),
      checkPermission: jest.fn(),
    };

    jest.doMock('../../stores/permissionStore', () => mockPermStore);

    inheritancePolicy = require('../inheritancePolicy');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // V10: getEffectivePermission returns highest-rank permission from ancestor chain
  it('V10: returns READ when nearest ancestor has READ', async () => {
    const userId = 1;
    const targetNodeId = 30;

    mockPermStore.getPathEffectivePermission.mockResolvedValue(PERMISSIONS.READ);

    const result = await inheritancePolicy.getEffectivePermission(userId, targetNodeId);
    expect(result).toBe(PERMISSIONS.READ);
    expect(mockPermStore.getPathEffectivePermission).toHaveBeenCalledWith(userId, targetNodeId);
  });

  it('V10b: returns WRITE when nearest ancestor has WRITE', async () => {
    const userId = 1;
    const targetNodeId = 30;

    mockPermStore.getPathEffectivePermission.mockResolvedValue(PERMISSIONS.WRITE);

    const result = await inheritancePolicy.getEffectivePermission(userId, targetNodeId);
    expect(result).toBe(PERMISSIONS.WRITE);
  });

  it('V10c: returns null when no ancestor has permission', async () => {
    const userId = 1;
    const targetNodeId = 30;

    mockPermStore.getPathEffectivePermission.mockResolvedValue(null);

    const result = await inheritancePolicy.getEffectivePermission(userId, targetNodeId);
    expect(result).toBeNull();
  });

  it('V10d: returns ADMIN when nearest ancestor has ADMIN', async () => {
    const userId = 1;
    const targetNodeId = 30;

    mockPermStore.getPathEffectivePermission.mockResolvedValue(PERMISSIONS.ADMIN);

    const result = await inheritancePolicy.getEffectivePermission(userId, targetNodeId);
    expect(result).toBe(PERMISSIONS.ADMIN);
  });

  // hasInheritedPermission
  it('hasInheritedPermission returns true when ancestor grants permission', async () => {
    mockPermStore.checkPermission.mockResolvedValue(true);

    const result = await inheritancePolicy.hasInheritedPermission(1, 30, PERMISSIONS.READ);
    expect(result).toBe(true);
    expect(mockPermStore.checkPermission).toHaveBeenCalledWith(1, 30, PERMISSIONS.READ);
  });

  it('hasInheritedPermission returns false when no ancestor grants permission', async () => {
    mockPermStore.checkPermission.mockResolvedValue(false);

    const result = await inheritancePolicy.hasInheritedPermission(1, 30, PERMISSIONS.READ);
    expect(result).toBe(false);
  });
});
