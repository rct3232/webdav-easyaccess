const recentFilesStore = require('../recentFilesStore');
const { resetTestStore, teardownTestStore } = require('../../test-utils');

describe('recentFilesStore', () => {
  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
  });

  it('adds and retrieves recent files for a user', async () => {
    const userId = 1;
    const file1 = { path: '/files/a.txt', name: 'a.txt', type: 'file' };
    const file2 = { path: '/files/b.png', name: 'b.png', type: 'image' };

    await recentFilesStore.addRecentFile(userId, file1);
    await recentFilesStore.addRecentFile(userId, file2);

    const recent = await recentFilesStore.getUserRecentFiles(userId);
    expect(recent).toHaveLength(2);
    expect(recent[0].path).toBe('/files/b.png'); // Most recent first
    expect(recent[1].path).toBe('/files/a.txt');
  });

  it('removes duplicates when adding an existing file', async () => {
    const userId = 1;
    const file1 = { path: '/files/a.txt', name: 'a.txt', type: 'file' };
    const file2 = { path: '/files/b.png', name: 'b.png', type: 'image' };

    await recentFilesStore.addRecentFile(userId, file1);
    await recentFilesStore.addRecentFile(userId, file2);
    await recentFilesStore.addRecentFile(userId, file1); // Re-add file1

    const recent = await recentFilesStore.getUserRecentFiles(userId);
    expect(recent).toHaveLength(2);
    expect(recent[0].path).toBe('/files/a.txt');
    expect(recent[1].path).toBe('/files/b.png');
  });

  it('removes a specific recent file', async () => {
    const userId = 1;
    await recentFilesStore.addRecentFile(userId, { path: '/a.txt' });
    await recentFilesStore.addRecentFile(userId, { path: '/b.txt' });

    await recentFilesStore.removeRecentFile(userId, '/a.txt');
    const recent = await recentFilesStore.getUserRecentFiles(userId);
    expect(recent).toHaveLength(1);
    expect(recent[0].path).toBe('/b.txt');
  });

  it('clears all recent files for a user', async () => {
    const userId = 1;
    await recentFilesStore.addRecentFile(userId, { path: '/a.txt' });
    await recentFilesStore.clearRecentFiles(userId);

    const recent = await recentFilesStore.getUserRecentFiles(userId);
    expect(recent).toHaveLength(0);
  });

  it('limits the number of recent files', async () => {
    const userId = 1;
    for (let i = 0; i < 25; i++) {
      await recentFilesStore.addRecentFile(userId, { path: `/file${i}.txt` });
    }

    const recent = await recentFilesStore.getUserRecentFiles(userId);
    expect(recent).toHaveLength(20); // MAX_RECENT_FILES is 20
    expect(recent[0].path).toBe('/file24.txt');
  });
});
