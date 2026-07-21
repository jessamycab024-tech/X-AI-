const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHandler } = require('../server');

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    end(payload) {
      this.body = payload || '';
    }
  };
}

test('health endpoint returns ok', async () => {
  const handler = createHandler();
  const req = { method: 'GET', url: '/api/health' };
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"status":"ok"/);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['X-Frame-Options'], 'DENY');
});

test('generate endpoint returns a structured plan', async () => {
  const handler = createHandler();
  const req = {
    method: 'POST',
    url: '/api/generate',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Build a task manager app' })
  };
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"projectType":"app"/);
  assert.match(res.body, /"summary"/);
});

test('projects are persisted and retrievable', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xai-'));
  const storageFile = path.join(tempDir, 'projects.json');
  const handler = createHandler({ storageFile });
  const createReq = {
    method: 'POST',
    url: '/api/projects',
    body: { title: 'Sample app', prompt: 'Build a landing page', projectType: 'app' }
  };
  const createRes = createMockResponse();

  await handler(createReq, createRes);

  assert.equal(createRes.statusCode, 200);
  const created = JSON.parse(createRes.body);
  assert.equal(created.project.title, 'Sample app');

  const listReq = { method: 'GET', url: '/api/projects' };
  const listRes = createMockResponse();
  await handler(listReq, listRes);

  assert.equal(listRes.statusCode, 200);
  const list = JSON.parse(listRes.body);
  assert.equal(list.projects.length, 1);
  assert.equal(list.projects[0].id, created.project.id);
});

test('auth register and login flow works', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xai-auth-'));
  const handler = createHandler({ userStoreFile: path.join(tempDir, 'users.json') });
  const registerReq = {
    method: 'POST',
    url: '/api/auth/register',
    body: { email: 'user@example.com', password: 'secretpass', name: 'Test User' }
  };
  const registerRes = createMockResponse();

  await handler(registerReq, registerRes);

  assert.equal(registerRes.statusCode, 200);
  const registerBody = JSON.parse(registerRes.body);
  assert.equal(registerBody.user.email, 'user@example.com');
  assert.ok(registerBody.token);

  const loginReq = {
    method: 'POST',
    url: '/api/auth/login',
    body: { email: 'user@example.com', password: 'secretpass' }
  };
  const loginRes = createMockResponse();
  await handler(loginReq, loginRes);

  assert.equal(loginRes.statusCode, 200);
  const loginBody = JSON.parse(loginRes.body);
  assert.equal(loginBody.user.email, 'user@example.com');
});

test('billing checkout returns invoice data', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xai-billing-'));
  const handler = createHandler({ billingStoreFile: path.join(tempDir, 'billing.json') });
  const req = {
    method: 'POST',
    url: '/api/billing/checkout',
    body: { planName: 'Basic' }
  };
  const res = createMockResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.invoice.planName, 'Basic');
  assert.equal(body.invoice.amount, 30);
  assert.equal(body.invoice.currency, 'USD');
});
