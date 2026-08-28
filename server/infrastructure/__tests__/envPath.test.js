'use strict';

const path = require('path');
const { resolveEnvPath } = require('../envPath');

describe('resolveEnvPath', () => {
  const saved = process.env.DOTENV_CONFIG_PATH;

  afterEach(() => {
    if (saved === undefined) delete process.env.DOTENV_CONFIG_PATH;
    else process.env.DOTENV_CONFIG_PATH = saved;
  });

  it('defaults to path.join(requireMainDir, "../.env") when DOTENV_CONFIG_PATH is unset', () => {
    delete process.env.DOTENV_CONFIG_PATH;
    const dir = '/app/server';
    expect(resolveEnvPath(dir)).toBe(path.join(dir, '../.env'));
  });

  it('resolves a relative DOTENV_CONFIG_PATH against requireMainDir', () => {
    process.env.DOTENV_CONFIG_PATH = 'config/dev.env';
    const dir = '/app/server';
    expect(resolveEnvPath(dir)).toBe(path.resolve(dir, 'config/dev.env'));
  });

  it('resolves an absolute DOTENV_CONFIG_PATH via path.resolve', () => {
    process.env.DOTENV_CONFIG_PATH = '/etc/webdav/.env';
    const dir = '/app/server';
    expect(resolveEnvPath(dir)).toBe(path.resolve(dir, '/etc/webdav/.env'));
  });

  it('matches the loader path semantics of server/index.js:10-12 for the same inputs', () => {
    const serverDir = path.resolve(__dirname, '..', '..');
    const loaderPath = () =>
      process.env.DOTENV_CONFIG_PATH
        ? path.resolve(serverDir, process.env.DOTENV_CONFIG_PATH)
        : path.join(serverDir, '../.env');

    delete process.env.DOTENV_CONFIG_PATH;
    expect(resolveEnvPath(serverDir)).toBe(loaderPath());

    process.env.DOTENV_CONFIG_PATH = '.env.dev';
    expect(resolveEnvPath(serverDir)).toBe(loaderPath());

    process.env.DOTENV_CONFIG_PATH = '/absolute/path/.env';
    expect(resolveEnvPath(serverDir)).toBe(loaderPath());
  });
});
