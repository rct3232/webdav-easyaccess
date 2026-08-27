import { request } from '../httpClient';

function createResponse({
  status = 200,
  statusText = 'OK',
  body = '',
  headers = { 'Content-Type': 'application/json' },
} = {}) {
  return {
    status,
    statusText,
    headers: new Headers(headers),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    blob: jest.fn().mockResolvedValue(new Blob(['blob-data'])),
  };
}

describe('httpClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('parses JSON responses into result.data', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      createResponse({ body: { value: 42 } })
    );

    const result = await request({ url: '/json' });

    expect(result.data).toEqual({ value: 42 });
    expect(result.status).toBe(200);
  });

  it('returns text for non-JSON responses', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      createResponse({
        body: 'plain text',
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    const result = await request({ url: '/text' });

    expect(result.data).toBe('plain text');
  });

  it('timeout aborts with ECONNABORTED and is not retried', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockImplementation((_, init) => {
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const pending = request({ url: '/slow', timeout: 10, maxRetries: 3 });
    jest.advanceTimersByTime(10);

    await expect(pending).rejects.toMatchObject({ code: 'ECONNABORTED' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('network failures throw ERR_NETWORK', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));

    await expect(request({ url: '/offline', maxRetries: 0 })).rejects.toMatchObject({
      code: 'ERR_NETWORK',
    });
  });

  it('retries 5xx responses and preserves the last error.response', async () => {
    // Retry delay is zeroed test-wide via __setRetryConfigForTests({ retryDelay: 0 })
    // in setupTests.js (docs/TESTING_STRATEGY.md "Avoid real-time waits").
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          status: 502,
          statusText: 'Bad Gateway',
          body: { errorCode: 'serverErrors.internal' },
        })
      )
      .mockResolvedValueOnce(
        createResponse({
          status: 502,
          statusText: 'Bad Gateway',
          body: { errorCode: 'serverErrors.internal' },
        })
      );

    await expect(request({ url: '/retry-5xx', maxRetries: 1 })).rejects.toMatchObject({
      response: {
        status: 502,
        data: { errorCode: 'serverErrors.internal' },
      },
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry 4xx responses', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      createResponse({
        status: 404,
        statusText: 'Not Found',
        body: { errorCode: 'serverErrors.files.notFound' },
      })
    );

    await expect(request({ url: '/missing', maxRetries: 3 })).rejects.toMatchObject({
      response: {
        status: 404,
        data: { errorCode: 'serverErrors.files.notFound' },
      },
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
