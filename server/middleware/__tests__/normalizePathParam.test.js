/**
 * normalizePathParam middleware tests.
 * Verifies query and body path normalization.
 */
const normalizePathParam = require('../normalizePathParam');

describe('normalizePathParam', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = { query: {}, body: {} };
    res = {};
    next = jest.fn();
  });

  it('calls next() without modifying req when no paths present', () => {
    normalizePathParam(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('normalizes req.query.path', () => {
    req.query.path = 'docs/foo/';

    normalizePathParam(req, res, next);

    expect(req.query.path).toBe('/docs/foo');
    expect(next).toHaveBeenCalled();
  });

  it('normalizes req.body.path', () => {
    req.body.path = '\\users\\alice';

    normalizePathParam(req, res, next);

    expect(req.body.path).toBe('/users/alice');
    expect(next).toHaveBeenCalled();
  });

  it('normalizes req.body.sourcePath and req.body.destinationPath', () => {
    req.body.sourcePath = '/a/b/';
    req.body.destinationPath = '/x//y';

    normalizePathParam(req, res, next);

    expect(req.body.sourcePath).toBe('/a/b');
    expect(req.body.destinationPath).toBe('/x/y');
    expect(next).toHaveBeenCalled();
  });

  it('normalizes req.body.oldPath', () => {
    req.body.oldPath = '/old/folder/';

    normalizePathParam(req, res, next);

    expect(req.body.oldPath).toBe('/old/folder');
    expect(next).toHaveBeenCalled();
  });

  it('normalizes req.body.folderPath and req.query.folderPath', () => {
    req.body.folderPath = '/perms/';
    req.query.folderPath = '/query/folder//';

    normalizePathParam(req, res, next);

    expect(req.body.folderPath).toBe('/perms');
    expect(req.query.folderPath).toBe('/query/folder');
    expect(next).toHaveBeenCalled();
  });

  it('adds leading slash when path lacks it', () => {
    req.query.path = 'relative/path';

    normalizePathParam(req, res, next);

    expect(req.query.path).toBe('/relative/path');
    expect(next).toHaveBeenCalled();
  });

  it('removes duplicate slashes', () => {
    req.body.path = '/a//b///c';

    normalizePathParam(req, res, next);

    expect(req.body.path).toBe('/a/b/c');
    expect(next).toHaveBeenCalled();
  });
});
