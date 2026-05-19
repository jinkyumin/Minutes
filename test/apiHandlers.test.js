import test from 'node:test';
import assert from 'node:assert/strict';

import summarizeHandler from '../api/summarize.js';
import notionHandler from '../api/notion.js';

test('summarize API calls OpenAI and returns normalized summary', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;
  const originalFetch = globalThis.fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.OPENAI_MODEL = 'chat-latest';

  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return jsonResponse({
      output_text: JSON.stringify({
        overview: '회의 개요입니다.',
        keyPoints: ['핵심 1'],
        actionItems: ['할 일 1'],
      }),
    });
  };

  const response = createResponse();
  await summarizeHandler(
    createRequest('POST', {
      transcript: '프로젝트 일정을 논의했습니다.',
      note: '예산 확인 필요',
      attendees: '김민수',
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    overview: '회의 개요입니다.',
    keyPoints: ['핵심 1'],
    actionItems: ['할 일 1'],
  });
  assert.equal(capturedRequest.url, 'https://api.openai.com/v1/responses');
  const openAiBody = JSON.parse(capturedRequest.options.body);
  assert.equal(openAiBody.model, 'gpt-5.2-chat-latest');
  assert.equal(openAiBody.text.format.type, 'json_schema');

  restoreEnv('OPENAI_API_KEY', originalKey);
  restoreEnv('OPENAI_MODEL', originalModel);
  globalThis.fetch = originalFetch;
});

test('summarize API calls Gemini when selected', async () => {
  const originalProvider = process.env.LLM_PROVIDER;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalFetch = globalThis.fetch;

  process.env.LLM_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';

  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return jsonResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  overview: 'Gemini 회의 개요입니다.',
                  keyPoints: ['Gemini 핵심 1'],
                  actionItems: ['Gemini 할 일 1'],
                }),
              },
            ],
          },
        },
      ],
    });
  };

  const response = createResponse();
  await summarizeHandler(
    createRequest('POST', {
      transcript: '프로젝트 일정을 논의했습니다.',
      note: '예산 확인 필요',
      attendees: '김민수',
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    overview: 'Gemini 회의 개요입니다.',
    keyPoints: ['Gemini 핵심 1'],
    actionItems: ['Gemini 할 일 1'],
  });
  assert.equal(
    capturedRequest.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-gemini-key',
  );

  restoreEnv('LLM_PROVIDER', originalProvider);
  restoreEnv('GEMINI_API_KEY', originalKey);
  restoreEnv('GEMINI_MODEL', originalModel);
  globalThis.fetch = originalFetch;
});

test('summarize API rejects missing OpenAI key', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const response = createResponse();
  await summarizeHandler(createRequest('POST', { transcript: '회의 내용' }), response);

  assert.equal(response.statusCode, 500);
  assert.match(JSON.parse(response.body).error, /OPENAI_API_KEY/);

  restoreEnv('OPENAI_API_KEY', originalKey);
});

test('notion API creates a page in the selected database', async () => {
  const originalToken = process.env.NOTION_TOKEN;
  const originalDatabaseId = process.env.NOTION_DATABASE_ID;
  const originalFetch = globalThis.fetch;

  process.env.NOTION_TOKEN = 'test-notion-token';
  process.env.NOTION_DATABASE_ID = 'env-database';

  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return jsonResponse({ id: 'page-id', url: 'https://notion.so/page-id' });
  };

  const response = createResponse();
  await notionHandler(
    createRequest('POST', {
      databaseId: 'selected-database',
      record: {
        meetingDateTime: '2026-05-19T09:00',
        attendees: '김민수',
        note: '노트',
        transcriptEntries: [{ text: '전사 내용' }],
        summary: { overview: '개요', keyPoints: ['핵심'], actionItems: ['할 일'] },
      },
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    id: 'page-id',
    url: 'https://notion.so/page-id',
  });
  assert.equal(capturedRequest.url, 'https://api.notion.com/v1/pages');
  assert.equal(JSON.parse(capturedRequest.options.body).parent.database_id, 'selected-database');

  restoreEnv('NOTION_TOKEN', originalToken);
  restoreEnv('NOTION_DATABASE_ID', originalDatabaseId);
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
    end(payload = '') {
      this.body = payload;
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
