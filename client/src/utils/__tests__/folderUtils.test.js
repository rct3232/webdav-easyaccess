/**
 * folderUtils tests: collectSubfolderPaths
 * @see docs/spec/client/utils/folderUtils.md
 */
import { collectSubfolderPaths } from '../folderUtils';
import * as fileService from '../../services/fileService';

jest.mock('../../services/fileService');

describe('collectSubfolderPaths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns [folderPath] for leaf folder', async () => {
    fileService.listFiles.mockResolvedValue([]);
    const result = await collectSubfolderPaths('/a/b/leaf');
    expect(result).toEqual(['/a/b/leaf']);
    expect(fileService.listFiles).toHaveBeenCalledWith('/a/b/leaf');
  });

  it('returns [folderPath, ...children] for nested structure', async () => {
    fileService.listFiles
      .mockResolvedValueOnce([{ type: 'directory', path: '/root/sub1' }, { type: 'directory', path: '/root/sub2' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ type: 'directory', path: '/root/sub2/nested' }])
      .mockResolvedValueOnce([]);
    const result = await collectSubfolderPaths('/root');
    expect(result).toEqual(['/root', '/root/sub1', '/root/sub2', '/root/sub2/nested']);
    expect(fileService.listFiles).toHaveBeenCalledTimes(4);
  });

  it('normalizes paths', async () => {
    fileService.listFiles.mockResolvedValue([]);
    const result = await collectSubfolderPaths('a/b/leaf/');
    expect(result).toEqual(['/a/b/leaf']);
  });

  it('includes only directories, not files', async () => {
    fileService.listFiles
      .mockResolvedValueOnce([
        { type: 'directory', path: '/root/dir' },
        { type: 'file', path: '/root/file.txt' },
      ])
      .mockResolvedValue([]);
    const result = await collectSubfolderPaths('/root');
    expect(result).toEqual(['/root', '/root/dir']);
  });

  it('on listFiles error: logs and skips that branch, excludes failed path per spec 2.5', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    fileService.listFiles
      .mockResolvedValueOnce([
        { type: 'directory', path: '/root/good' },
        { type: 'directory', path: '/root/bad' },
      ])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('network error'));
    const result = await collectSubfolderPaths('/root');
    expect(result).toEqual(['/root', '/root/good']);
    expect(consoleSpy).toHaveBeenCalledWith('Failed to list path:', '/root/bad', expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('empty listFiles response returns [folderPath]', async () => {
    fileService.listFiles.mockResolvedValue(null);
    const result = await collectSubfolderPaths('/empty');
    expect(result).toEqual(['/empty']);
  });
});
