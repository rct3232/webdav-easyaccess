const requestLogger = require('../requestLogger');

describe('requestLogger middleware', () => {
  function createMockRes(statusCode = 200) {
    const { EventEmitter } = require('events');
    const res = new EventEmitter();
    res.statusCode = statusCode;
    return res;
  }

  it('should log one JSON line per request (basic fields)', () => {
    const mw = requestLogger();

    const req = {
      method: 'GET',
      originalUrl: '/api/health',
      url: '/api/health',
      ip: '127.0.0.1',
      headers: {
        'x-forwarded-for': '203.0.113.10',
        'user-agent': 'jest-agent/1.0',
      },
    };
    const res = createMockRes(200);
    const next = jest.fn();

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    res.emit('finish');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(logSpy.mock.calls[0][0]);

    expect(entry).toEqual(
      expect.objectContaining({
        method: 'GET',
        url: '/api/health',
        status: 200,
        ip: '203.0.113.10',
        user_agent: 'jest-agent/1.0',
      })
    );
    expect(typeof entry.ts).toBe('string');
    expect(typeof entry.duration_ms).toBe('number');
    expect(entry.duration_ms).toBeGreaterThanOrEqual(0);

    logSpy.mockRestore();
  });

  it('should include req.user fields when present', () => {
    const mw = requestLogger();

    const req = {
      method: 'GET',
      originalUrl: '/api/whoami',
      url: '/api/whoami',
      ip: '127.0.0.1',
      headers: {},
      user: { id: 123, username: 'alice' },
    };
    const res = createMockRes(200);
    const next = jest.fn();

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    res.emit('finish');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(logSpy.mock.calls[0][0]);
    expect(entry.user_id).toBe(123);
    expect(entry.username).toBe('alice');

    logSpy.mockRestore();
  });
});

