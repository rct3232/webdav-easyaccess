'use strict';

const { resolveListenHost } = require('../listenConfig');

describe('resolveListenHost', () => {
  it('returns 127.0.0.1 while setup is incomplete', () => {
    expect(resolveListenHost(false)).toBe('127.0.0.1');
  });

  it('returns undefined (all interfaces) once setup is complete', () => {
    expect(resolveListenHost(true)).toBeUndefined();
  });
});
