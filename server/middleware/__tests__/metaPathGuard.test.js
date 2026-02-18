const { checkMetaPathAccess } = require('../metaPathGuard');
const { isMetaPath } = require('../../store/metaPaths');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

jest.mock('../../store/metaPaths');

describe('checkMetaPathAccess middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      query: {},
      body: {},
      params: {},
      user: { full: { is_admin: 0 } }
    };
    res = {};
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('allows non-meta path access for regular user', () => {
    isMetaPath.mockReturnValue(false);
    req.query.path = '/some/regular/path';

    checkMetaPathAccess(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('denies meta path access for regular user', () => {
    isMetaPath.mockReturnValue(true);
    req.query.path = '/.wea/config.json';

    expect(() => checkMetaPathAccess(req, res, next)).toThrow(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows meta path access for admin user', () => {
    isMetaPath.mockReturnValue(true);
    req.user.full.is_admin = 1;
    req.query.path = '/.wea/config.json';

    checkMetaPathAccess(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('checks multiple paths in body', () => {
    isMetaPath.mockImplementation((p) => p === '/.wea/source');
    req.body.sourcePath = '/.wea/source';
    req.body.destinationPath = '/regular/dest';

    expect(() => checkMetaPathAccess(req, res, next)).toThrow(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  });

  describe('checkMetaPath factory', () => {
    const { checkMetaPath } = require('../metaPathGuard');

    it('uses default path extractor (query.path || body.path)', () => {
      const middleware = checkMetaPath();
      isMetaPath.mockReturnValue(true);
      req.query.path = '/.wea/some';

      expect(() => middleware(req, res, next)).toThrow(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    });

    it('uses custom path extractor', () => {
      const customExtractor = (r) => r.params.custom;
      const middleware = checkMetaPath(customExtractor);
      isMetaPath.mockReturnValue(true);
      req.params.custom = '/.wea/custom';

      expect(() => middleware(req, res, next)).toThrow(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    });

    it('allows access when extractor returns null', () => {
      const middleware = checkMetaPath(() => null);
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows access when path is not meta path', () => {
      const middleware = checkMetaPath();
      isMetaPath.mockReturnValue(false);
      req.query.path = '/regular';

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks access for non-admin user with body path', () => {
      const middleware = checkMetaPath();
      isMetaPath.mockReturnValue(true);
      req.body.path = '/.wea/body';

      expect(() => middleware(req, res, next)).toThrow(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    });
  });
});
