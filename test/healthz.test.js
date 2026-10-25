'use strict';

const assert = require('assert');
const http = require('http');
const { test } = require('node:test');

// Load the app/server module. Adjust the require path if the server entry
// point lives elsewhere in the project.
const app = require('../src/server');

function request(server, path) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const options = {
      host: '127.0.0.1',
      port: address.port,
      path,
      method: 'GET',
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('GET /healthz returns 200 with expected JSON body', async () => {
  const server = await startServer();
  try {
    const res = await request(server, '/healthz');
    assert.strictEqual(res.statusCode, 200);
    assert.match(res.headers['content-type'] || '', /application\/json/);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.status, 'ok');
  } finally {
    await stopServer(server);
  }
});

test('GET /healthz makes no upstream GitHub/npm calls', async () => {
  const originalFetch = global.fetch;
  const originalHttpGet = http.get;
  const originalHttpsGet = require('https').get;
  const calls = [];

  global.fetch = (...args) => {
    calls.push(args[0]);
    return Promise.reject(new Error('unexpected fetch in /healthz'));
  };
  http.get = (...args) => {
    calls.push(args[0]);
    throw new Error('unexpected http.get in /healthz');
  };
  require('https').get = (...args) => {
    calls.push(args[0]);
    throw new Error('unexpected https.get in /healthz');
  };

  const server = await startServer();
  try {
    const res = await request(server, '/healthz');
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(calls, []);
  } finally {
    await stopServer(server);
    global.fetch = originalFetch;
    http.get = originalHttpGet;
    require('https').get = originalHttpsGet;
  }
});

test('GET /healthz is exempt from rate limiting', async () => {
  const server = await startServer();
  try {
    const attempts = 50;
    for (let i = 0; i < attempts; i += 1) {
      const res = await request(server, '/healthz');
      assert.strictEqual(
        res.statusCode,
        200,
        `request ${i + 1} of ${attempts} should return 200`
      );
    }
  } finally {
    await stopServer(server);
  }
});

test('GET /does-not-exist returns a JSON 404', async () => {
  const server = await startServer();
  try {
    const res = await request(server, '/does-not-exist');
    assert.strictEqual(res.statusCode, 404);
    assert.match(res.headers['content-type'] || '', /application\/json/);
    const parsed = JSON.parse(res.body);
    assert.ok(parsed.error, 'expected an error field in the JSON body');
  } finally {
    await stopServer(server);
  }
});

test('GET /index.html is not served as a static asset and returns a JSON 404', async () => {
  const server = await startServer();
  try {
    const res = await request(server, '/index.html');
    assert.strictEqual(res.statusCode, 404);
    assert.match(res.headers['content-type'] || '', /application\/json/);
    const parsed = JSON.parse(res.body);
    assert.ok(parsed.error, 'expected an error field in the JSON body');
  } finally {
    await stopServer(server);
  }
});