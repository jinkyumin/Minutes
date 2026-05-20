import test from 'node:test';
import assert from 'node:assert/strict';

import transcribeHandler from '../api/transcribe.js';

test('transcribe API calls Gemini with inline audio and returns text', async () => {
  const originalProvider = process.env.LLM_PROVIDER;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_TRANSCRIBE_MODEL;
  const originalFetch = globalThis.fetch;

  process.env.LLM_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GEMINI_TRANSCRIBE_MODEL = 'gemini-2.5-flash';

  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return jsonResponse({
      candidates: [{ content: { parts: [{ text: '전사 결과입니다.' }] } }],
    });
  };

  const response = createResponse();
  await transcribeHandler(
    createRequest('POST', {
      audio: 'data:audio/webm;base64,YXVkaW8=',
      mimeType: 'audio/webm',
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { transcript: '전사 결과입니다.' });
  assert.equal(
    capturedRequest.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-gemini-key',
  );

  const body = JSON.parse(capturedRequest.options.body);
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'audio/webm');
  assert.equal(body.contents[0].parts[0].inlineData.data, 'YXVkaW8=');
  assert.match(body.contents[0].parts[1].text, /한국어 회의 녹음/);

  restoreEnv('LLM_PROVIDER', originalProvider);
  restoreEnv('GEMINI_API_KEY', originalKey);
  restoreEnv('GEMINI_TRANSCRIBE_MODEL', originalModel);
  globalThis.fetch = originalFetch;
});

test('transcribe API rejects missing audio', async () => {
  const response = createResponse();
  await transcribeHandler(createRequest('POST', {}), response);

  assert.equal(response.statusCode, 400);
  assert.match(JSON.parse(response.body).error, /Audio is required/);
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
