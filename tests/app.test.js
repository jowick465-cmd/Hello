const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const app = require('../src/index.js');

const PORT = 3999;

describe('API endpoints', () => {
  let server;
  let baseUrl;

  before(() => {
    return new Promise((resolve) => {
      server = app.listen(PORT, () => {
        baseUrl = `http://localhost:${PORT}`;
        resolve();
      });
    });
  });

  after(() => {
    return new Promise((resolve) => {
      server.close(resolve);
    });
  });

  it('GET / returns status ok', async () => {
    const body = await fetchJSON(baseUrl + '/');
    assert.strictEqual(body.status, 'ok');
    assert.ok(body.timestamp);
    assert.ok(body.service);
  });

  it('GET /health returns healthy', async () => {
    const body = await fetchJSON(baseUrl + '/health');
    assert.strictEqual(body.status, 'healthy');
  });
});

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}
