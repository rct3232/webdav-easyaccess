import { sortFiles, canPreview } from '../fileUtils';
import { SORT_MODES } from '../../constants/fileManager';

describe('fileUtils', () => {
  describe('sortFiles', () => {
    const files = [
      { basename: 'b.txt', type: 'file', lastmod: '2023-01-02' },
      { basename: 'a.txt', type: 'file', lastmod: '2023-01-01' },
      { basename: 'folder', type: 'directory', lastmod: '2023-01-03' },
    ];

    it('sorts by name ascending, folders first', () => {
      const sorted = sortFiles(files, SORT_MODES.NAME_ASC);
      expect(sorted[0].basename).toBe('folder');
      expect(sorted[1].basename).toBe('a.txt');
      expect(sorted[2].basename).toBe('b.txt');
    });

    it('sorts by date descending', () => {
      const sorted = sortFiles(files, SORT_MODES.DATE_DESC);
      expect(sorted[0].basename).toBe('folder'); // Folders always first
      expect(sorted[1].basename).toBe('b.txt');
      expect(sorted[2].basename).toBe('a.txt');
    });
  });

  describe('canPreview', () => {
    it('identifies previewable files', () => {
      expect(canPreview('test.jpg')).toBe(true);
      expect(canPreview('test.pdf')).toBe(true);
      expect(canPreview('test.txt')).toBe(true);
      expect(canPreview('test.exe')).toBe(false);
      expect(canPreview(null)).toBe(false);
    });
  });
});
