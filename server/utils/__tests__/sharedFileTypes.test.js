/**
 * Unit tests for shared file type utilities.
 * Pure function testing — no mocks needed.
 * @see shared/fileTypes.js
 */
const {
  getFileType,
  getContentType,
} = require('@webdav-easyaccess/shared/fileTypes');

describe('shared fileTypes', () => {
  describe('getFileType', () => {
    it.each([
      ['photo.jpg', 'image'],
      ['image.jpeg', 'image'],
      ['icon.png', 'image'],
      ['animated.gif', 'image'],
      ['picture.bmp', 'image'],
      ['modern.webp', 'image'],
      ['graphic.svg', 'image'],
    ])('returns image for %p', (filename, expected) => {
      expect(getFileType(filename)).toBe(expected);
    });

    it.each([
      ['video.mp4', 'video'],
      ['clip.webm', 'video'],
      ['recording.ogg', 'video'],
      ['movie.mov', 'video'],
      ['footage.avi', 'video'],
      ['content.mkv', 'video'],
    ])('returns video for %p', (filename, expected) => {
      expect(getFileType(filename)).toBe(expected);
    });

    it.each([
      ['song.mp3', 'audio'],
      ['sound.wav', 'audio'],
      ['tone.aac', 'audio'],
      ['music.m4a', 'audio'],
      ['track.flac', 'audio'],
    ])('returns audio for %p', (filename, expected) => {
      expect(getFileType(filename)).toBe(expected);
    });

    it.each([
      ['document.pdf', 'pdf'],
      ['report.PDF', 'pdf'],
    ])('returns pdf for %p', (filename, expected) => {
      expect(getFileType(filename)).toBe(expected);
    });

    it.each([
      ['readme.txt', 'text'],
      ['notes.md', 'text'],
      ['data.json', 'text'],
      ['config.xml', 'text'],
      ['table.csv', 'text'],
      ['script.js', 'text'],
      ['component.jsx', 'text'],
      ['module.ts', 'text'],
      ['app.tsx', 'text'],
      ['style.css', 'text'],
      ['page.html', 'text'],
      ['code.py', 'text'],
      ['Main.java', 'text'],
      ['program.c', 'text'],
      ['source.cpp', 'text'],
      ['header.h', 'text'],
      ['run.sh', 'text'],
    ])('returns text for %p', (filename, expected) => {
      expect(getFileType(filename)).toBe(expected);
    });

    it.each([
      ['archive.zip', 'unknown'],
      ['package.tar.gz', 'unknown'],
      ['binary.exe', 'unknown'],
      ['file.xyz', 'unknown'],
    ])('returns unknown for %p', (filename, expected) => {
      expect(getFileType(filename)).toBe(expected);
    });

    it('handles filenames without extension', () => {
      expect(getFileType('Makefile')).toBe('unknown');
      expect(getFileType('.gitignore')).toBe('unknown');
    });

    it('handles empty filename', () => {
      expect(getFileType('')).toBe('unknown');
    });
  });

  describe('getContentType', () => {
    it.each([
      ['file.jpg', 'image/jpeg'],
      ['file.jpeg', 'image/jpeg'],
      ['file.png', 'image/png'],
      ['file.gif', 'image/gif'],
      ['file.bmp', 'image/bmp'],
      ['file.webp', 'image/webp'],
      ['file.svg', 'image/svg+xml'],
    ])('returns correct image content-type for %p', (filename, expected) => {
      expect(getContentType(filename)).toBe(expected);
    });

    it.each([
      ['file.mp4', 'video/mp4'],
      ['file.webm', 'video/webm'],
      ['file.ogg', 'video/ogg'],
      ['file.mov', 'video/quicktime'],
      ['file.avi', 'video/x-msvideo'],
      ['file.mkv', 'video/x-matroska'],
    ])('returns correct video content-type for %p', (filename, expected) => {
      expect(getContentType(filename)).toBe(expected);
    });

    it.each([
      ['file.mp3', 'audio/mpeg'],
      ['file.wav', 'audio/wav'],
      ['file.aac', 'audio/aac'],
      ['file.m4a', 'audio/mp4'],
      ['file.flac', 'audio/flac'],
    ])('returns correct audio content-type for %p', (filename, expected) => {
      expect(getContentType(filename)).toBe(expected);
    });

    it.each([
      ['file.pdf', 'application/pdf'],
      ['file.txt', 'text/plain'],
      ['readme.md', 'text/markdown'],
      ['data.json', 'application/json'],
      ['config.xml', 'application/xml'],
      ['table.csv', 'text/csv'],
      ['page.html', 'text/html'],
      ['style.css', 'text/css'],
      ['script.js', 'text/javascript'],
      ['component.jsx', 'text/javascript'],
      ['module.ts', 'text/typescript'],
      ['app.tsx', 'text/typescript'],
    ])('returns correct content-type for %p → %s', (filename, expected) => {
      expect(getContentType(filename)).toBe(expected);
    });

    it.each([
      ['archive.zip', 'application/octet-stream'],
      ['binary.exe', 'application/octet-stream'],
      ['file.xyz', 'application/octet-stream'],
    ])('returns application/octet-stream for unknown types %p', (filename) => {
      expect(getContentType(filename)).toBe('application/octet-stream');
    });

    it('handles case-insensitive extensions', () => {
      expect(getContentType('FILE.JPG')).toBe('image/jpeg');
      expect(getContentType('file.MP4')).toBe('video/mp4');
    });

    it('handles filenames without extension', () => {
      expect(getContentType('Makefile')).toBe('application/octet-stream');
    });

    it('handles empty filename', () => {
      expect(getContentType('')).toBe('application/octet-stream');
    });
  });
});
