const shareLinkStore = require('../shareLinkStore');
const { resetTestStore, teardownTestStore } = require('../../test-utils');

describe('shareLinkStore', () => {
  afterAll(async () => {
    await teardownTestStore();
  });

  beforeEach(async () => {
    await resetTestStore();
  });

  it('creates and retrieves a share link', async () => {
    const linkData = {
      token: 'test-token',
      filePath: '/files/test.txt',
      createdBy: 1,
      expiresInDays: 7
    };

    const created = await shareLinkStore.createShareLink(linkData);
    expect(created.token).toBe(linkData.token);
    expect(created.filePath).toBe('/files/test.txt');
    expect(created.createdBy).toBe(1);
    expect(created.expiresAt).toBeDefined();

    const retrieved = await shareLinkStore.getShareLink('test-token');
    expect(retrieved).toEqual(created);
  });

  it('updates a share link and increments download count', async () => {
    const linkData = {
      token: 'test-token',
      filePath: '/files/test.txt',
      createdBy: 1
    };
    await shareLinkStore.createShareLink(linkData);

    await shareLinkStore.incrementDownloadCount('test-token');
    let link = await shareLinkStore.getShareLink('test-token');
    expect(link.downloadCount).toBe(1);

    await shareLinkStore.updateShareLink('test-token', { filePath: '/files/updated.txt' });
    link = await shareLinkStore.getShareLink('test-token');
    expect(link.filePath).toBe('/files/updated.txt');
  });

  it('lists share links for a user', async () => {
    await shareLinkStore.createShareLink({ token: 't1', filePath: '/f1', createdBy: 1 });
    await shareLinkStore.createShareLink({ token: 't2', filePath: '/f2', createdBy: 1 });
    await shareLinkStore.createShareLink({ token: 't3', filePath: '/f3', createdBy: 2 });

    const user1Links = await shareLinkStore.getUserShareLinks(1);
    expect(user1Links).toHaveLength(2);
    expect(user1Links.map(l => l.token)).toContain('t1');
    expect(user1Links.map(l => l.token)).toContain('t2');

    const user2Links = await shareLinkStore.getUserShareLinks(2);
    expect(user2Links).toHaveLength(1);
    expect(user2Links[0].token).toBe('t3');
  });

  it('deletes a share link', async () => {
    await shareLinkStore.createShareLink({ token: 'test-token', filePath: '/f1', createdBy: 1 });
    await shareLinkStore.deleteShareLink('test-token');
    
    const retrieved = await shareLinkStore.getShareLink('test-token');
    expect(retrieved).toBeNull();
  });

  it('checks if a link is expired', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 10000).toISOString();
    const past = new Date(now.getTime() - 10000).toISOString();

    expect(shareLinkStore.isLinkExpired({ expiresAt: null })).toBe(false);
    expect(shareLinkStore.isLinkExpired({ expiresAt: future })).toBe(false);
    expect(shareLinkStore.isLinkExpired({ expiresAt: past })).toBe(true);
  });
});
