const requireUser = require('../requireUser');
const User = require('../../models/User');

jest.mock('../../models/User');

describe('requireUser middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      user: { id: 1 }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('successfully attaches full user object to req', async () => {
    const fullUser = { id: 1, username: 'testuser', is_admin: 0 };
    User.findById.mockResolvedValue(fullUser);

    await requireUser(req, res, next);

    expect(User.findById).toHaveBeenCalledWith(1);
    expect(req.user.full).toEqual(fullUser);
    expect(next).toHaveBeenCalledWith();
  });

  it('returns 401 if req.user is missing', async () => {
    req.user = undefined;

    await requireUser(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next with error if user is not found', async () => {
    User.findById.mockResolvedValue(null);

    await requireUser(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: 'User not found',
      status: 404
    }));
  });
});
