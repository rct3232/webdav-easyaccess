const { buildDestinationAbsoluteUrl } = require('../webdav');

function hasNonLatin1Chars(str) {
  for (const ch of String(str)) {
    if (ch.charCodeAt(0) > 0xff) return true;
  }
  return false;
}

describe('buildDestinationAbsoluteUrl', () => {
  test('encodes spaces and unicode so Destination is header-safe', () => {
    const base = 'http://plume7eat.xyz:30035/webdav';
    const dest = '/rct3232/no-auth/readonly/target/move/042527458 복사.jpg';

    const url = buildDestinationAbsoluteUrl(base, dest);

    expect(url).toContain('http://plume7eat.xyz:30035/webdav/');
    expect(url).toContain('042527458%20');
    expect(url).not.toContain('ᄇ');
    expect(hasNonLatin1Chars(url)).toBe(false);
  });

  test('preserves base path prefix and avoids double slashes', () => {
    const base = 'https://example.com/webdav/';
    const dest = '/a/b file.txt';

    const url = buildDestinationAbsoluteUrl(base, dest);

    expect(url).toBe('https://example.com/webdav/a/b%20file.txt');
    expect(hasNonLatin1Chars(url)).toBe(false);
  });

  test('encodes reserved characters when they appear in path segments', () => {
    const base = 'https://example.com/webdav';
    const dest = '/a/a#b?c 한글.txt';

    const url = buildDestinationAbsoluteUrl(base, dest);

    expect(url).toContain('/webdav/a/');
    expect(url).toContain('%23'); // #
    expect(url).toContain('%3F'); // ?
    expect(url).toContain('%20'); // space
    expect(url).not.toContain('#');
    expect(url).not.toContain('?');
    expect(hasNonLatin1Chars(url)).toBe(false);
  });

  test('drops query/fragment from base URL when building Destination', () => {
    const base = 'https://example.com/webdav?x=1#frag';
    const dest = '/k.txt';

    const url = buildDestinationAbsoluteUrl(base, dest);

    expect(url).toBe('https://example.com/webdav/k.txt');
  });

  test('adds trailing slash for directory destination when isDirectory is true', () => {
    const base = 'https://example.com/webdav';
    const dest = '/a/b';

    const url = buildDestinationAbsoluteUrl(base, dest, { isDirectory: true });

    expect(url).toBe('https://example.com/webdav/a/b/');
    expect(hasNonLatin1Chars(url)).toBe(false);
  });

  test('does not double-add trailing slash when dest already ends with / and isDirectory is true', () => {
    const base = 'https://example.com/webdav';
    const dest = '/a/b/';

    const url = buildDestinationAbsoluteUrl(base, dest, { isDirectory: true });

    expect(url).toBe('https://example.com/webdav/a/b/');
  });
});

