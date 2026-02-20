/**
 * Folders routes integration tests.
 * @see docs/api.md, docs/spec/server/routes/folders.md
 */
const request = require('supertest');
const {
  createTestDatabase,
  createAuthenticatedTestUser,
  grantTestPermission,
} = require('../../test-utils');

const mockPathExists = jest.fn();
const mockCreateDirectory = jest.fn();

jest.mock('../../utils/webdav', () => ({
  pathExists: (...args) => mockPathExists(...args),
  createDirectory: (...args) => mockCreateDirectory(...args),
  listDirectory: jest.fn().mockResolvedValue([]),
  getFileContents: jest.fn().mockResolvedValue(Buffer.from('')),
  putFileContents: jest.fn().mockResolvedValue(undefined),
  putFileContentsAdvanced: jest.fn().mockResolvedValue(undefined),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  moveFile: jest.fn().mockResolvedValue(undefined),
  copyFile: jest.fn().mockResolvedValue(undefined),
  getFileMetadata: jest.fn().mockResolvedValue({}),
  testConnection: jest.fn().mockResolvedValue({ success: true }),
  isImageFile: () => false,
  isVideoFile: () => false,
}));

let app;
let dbCleanup;

beforeAll(async () => {
  const db = await createTestDatabase();
  dbCleanup = db.cleanup;
  app = require('../../index');
});

beforeEach(() => {
  mockPathExists.mockResolvedValue(false);
  mockCreateDirectory.mockResolvedValue(undefined);
  mockCreateDirectory.mockClear();
});

afterAll(async () => {
  await dbCleanup?.();
});

describe('POST /api/folders/create', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .post('/api/folders/create')
      .send({ path: '/user1/new-folder' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 200 when folder created with write permission', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `folders-create-${Date.now()}`,
    });
    const folderPath = `/${user.username}/newdir`;
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    const res = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: folderPath });

    expect(res.status).toBe(200);
    expect(res.body.messageCode).toBeDefined();
    expect(res.body.path).toBeDefined();
    expect(mockCreateDirectory).toHaveBeenCalled();
  });

  it('returns 409 when folder already exists', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `folders-dup-${Date.now()}`,
    });
    const folderPath = `/${user.username}/dupdir`;
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    mockPathExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockCreateDirectory.mockResolvedValueOnce(undefined);

    const res1 = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: folderPath });
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: folderPath });
    expect(res2.status).toBe(409);
    expect(res2.body.errorCode).toBeDefined();
  });

  it('returns 404 when parent path does not exist', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `folders-parent-${Date.now()}`,
    });
    await grantTestPermission(user.id, `/${user.username}`, 'write');

    mockPathExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    mockCreateDirectory.mockRejectedValueOnce(Object.assign(new Error('Parent not found'), { status: 404 }));

    const res = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: `/${user.username}/nonexistent-parent/newdir` });

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBeDefined();
  });

  it('returns 403 for meta path when non-admin', async () => {
    const { user, token } = await createAuthenticatedTestUser({
      username: `folders-meta-${Date.now()}`,
      isAdmin: false,
    });

    const res = await request(app)
      .post('/api/folders/create')
      .set('Authorization', `Bearer ${token}`)
      .send({ path: '/.wea/secret' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBeDefined();
    expect(mockCreateDirectory).not.toHaveBeenCalled();
  });
});
