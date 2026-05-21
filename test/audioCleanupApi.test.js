import test from 'node:test';
import assert from 'node:assert/strict';

import audioCleanupHandler from '../api/audio-cleanup.js';

test('audio cleanup API deletes a Supabase storage object', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;

  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

  let capturedRequest;
  globalThis.fetch = async (url, options = {}) => {
    capturedRequest = { url, options };
    return jsonResponse({ ok: true });
  };

  const response = createResponse();
  await audioCleanupHandler(createRequest('POST', { storagePath: 'recordings/audio.webm' }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(capturedRequest.url, 'https://project.supabase.co/storage/v1/object/meeting-audio');
  assert.equal(capturedRequest.options.method, 'DELETE');
  assert.deepEqual(JSON.parse(capturedRequest.options.body), { prefixes: ['recordings/audio.webm'] });

  restoreEnv('SUPABASE_URL', originalUrl);
  restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalKey);
  globalThis.fetch = originalFetch;
});

function createRequest(method, body) {
  return { method, body };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = JSON.stringify(payload);
      return this;
    },
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
