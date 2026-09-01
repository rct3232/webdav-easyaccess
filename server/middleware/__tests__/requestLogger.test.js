/**
 * requestLogger middleware tests.
 */
const request = require('supertest');
const express = require('express');
const requestLogger = require('../requestLogger');

describe('requestLogger', () => {
  let app;
  let loggedLines;

  beforeEach(() => {
    app = express();
    app.use(requestLogger());

    loggedLines = [];
    jest.spyOn(console, 'log').mockImplementation((msg) => {
      loggedLines.push(JSON.parse(msg));
    });
  });

  afterEach(() => {
    console.log.mockRestore(); // eslint-disable-line no-console
  });

  it('logs a JSON line with method, url, status, and duration_ms', async () => {
    app.get('/test', (_req, res) => res.status(200).send('ok'));

    const res = await request(app).get('/test');

    expect(res.status).toBe(200);
    expect(loggedLines).toHaveLength(1);
    const entry = loggedLines[0];
    expect(entry.method).toBe('GET');
    expect(entry.url).toBe('/test');
    expect(entry.status).toBe(200);
    expect(typeof entry.duration_ms).toBe('number');
  });

  it('extracts IP from X-Forwarded-For header', async () => {
    app.get('/ip-test', (_req, res) => res.status(200).send('ok'));

    const res = await request(app).get('/ip-test').set('X-Forwarded-For', '1.2.3.4, 5.6.7.8');

    expect(res.status).toBe(200);
    expect(loggedLines[0].ip).toBe('1.2.3.4');
  });

  it('includes user_id and username when req.user is populated', async () => {
    app.get('/user-test', (req, res) => {
      req.user = { id: 42, username: 'alice' };
      res.status(200).send('ok');
    });

    const res = await request(app).get('/user-test');

    expect(res.status).toBe(200);
    expect(loggedLines[0].user_id).toBe(42);
    expect(loggedLines[0].username).toBe('alice');
  });

  it('calls next() so the request proceeds', async () => {
    let handlerCalled = false;
    app.get('/next-test', (_req, res) => {
      handlerCalled = true;
      res.status(201).send('created');
    });

    const res = await request(app).get('/next-test');

    expect(res.status).toBe(201);
    expect(handlerCalled).toBe(true);
  });
});
