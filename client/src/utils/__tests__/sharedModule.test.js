/**
 * sharedModule tests: getFileType, getContentType from @webdav-easyaccess/shared/fileTypes.
 * Pure function testing — no mocks needed.
 */
import { getFileType, getContentType } from '@webdav-easyaccess/shared/fileTypes';

describe('shared fileTypes utilities', () => {
  describe('getFileType', () => {
    it('returns "image" for image extensions', () => {
      const images = [
        'photo.jpg',
        'screenshot.jpeg',
        'icon.png',
        'anim.gif',
        'pic.bmp',
        'img.webp',
        'logo.svg',
      ];
      images.forEach((name) => expect(getFileType(name)).toBe('image'));
    });

    it('returns "video" for video extensions', () => {
      const videos = ['clip.mp4', 'rec.webm', 'footage.ogg', 'movie.mov', 'cam.avi', 'film.mkv'];
      videos.forEach((name) => expect(getFileType(name)).toBe('video'));
    });

    it('returns "audio" for audio extensions', () => {
      const audios = ['track.mp3', 'sound.wav', 'song.aac', 'podcast.m4a', 'hi-res.flac'];
      audios.forEach((name) => expect(getFileType(name)).toBe('audio'));
    });

    it('returns "pdf" for pdf extension', () => {
      expect(getFileType('document.pdf')).toBe('pdf');
    });

    it('returns "text" for text extensions', () => {
      const texts = [
        'notes.txt',
        'readme.md',
        'config.json',
        'data.xml',
        'report.csv',
        'app.log',
        'index.js',
        'App.jsx',
        'types.ts',
        'Component.tsx',
        'style.css',
        'page.html',
        'script.py',
        'Main.java',
        'main.c',
        'utils.cpp',
        'header.h',
        'deploy.sh',
      ];
      texts.forEach((name) => expect(getFileType(name)).toBe('text'));
    });

    it('returns "unknown" for unrecognized extensions', () => {
      expect(getFileType('archive.zip')).toBe('unknown');
      expect(getFileType('package.tar.gz')).toBe('unknown');
      expect(getFileType('file.xyz')).toBe('unknown');
    });
  });

  describe('getContentType', () => {
    it('returns correct Content-Type for image extensions', () => {
      expect(getContentType('photo.jpg')).toBe('image/jpeg');
      expect(getContentType('photo.jpeg')).toBe('image/jpeg');
      expect(getContentType('icon.png')).toBe('image/png');
      expect(getContentType('anim.gif')).toBe('image/gif');
    });

    it('returns correct Content-Type for video extensions', () => {
      expect(getContentType('clip.mp4')).toBe('video/mp4');
      expect(getContentType('rec.webm')).toBe('video/webm');
      expect(getContentType('footage.ogg')).toBe('video/ogg');
    });

    it('returns correct Content-Type for audio extensions', () => {
      expect(getContentType('track.mp3')).toBe('audio/mpeg');
      expect(getContentType('sound.wav')).toBe('audio/wav');
      expect(getContentType('song.aac')).toBe('audio/aac');
    });

    it('returns correct Content-Type for text and other extensions', () => {
      expect(getContentType('document.pdf')).toBe('application/pdf');
      expect(getContentType('config.json')).toBe('application/json');
      expect(getContentType('notes.txt')).toBe('text/plain');
    });

    it('returns application/octet-stream for unknown extensions', () => {
      expect(getContentType('file.xyz')).toBe('application/octet-stream');
      expect(getContentType('archive.zip')).toBe('application/octet-stream');
    });
  });
});
