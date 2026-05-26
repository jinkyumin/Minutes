import test from 'node:test';
import assert from 'node:assert/strict';

import summarizeHandler from '../api/summarize.js';
import notionHandler from '../api/notion.js';
import meetingsHandler from '../api/meetings.js';

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
        title: '프로젝트 일정 회의',
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
    overview: '회의 개요임.',
    title: '프로젝트 일정 회의',
    keyPoints: ['핵심 1'],
    actionItems: ['할 일 1'],
    sections: [
      { title: '회의 요약', items: ['회의 개요임.'], type: 'list' },
      { title: '회의 주요내용', items: ['핵심 1'], type: 'list' },
      { title: '액션 아이템', items: ['할 일 1'], type: 'list' },
    ],
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
                  title: '예산 확인 회의',
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
    overview: 'Gemini 회의 개요임.',
    title: '예산 확인 회의',
    keyPoints: ['Gemini 핵심 1'],
    actionItems: ['Gemini 할 일 1'],
    sections: [
      { title: '회의 요약', items: ['Gemini 회의 개요임.'], type: 'list' },
      { title: '회의 주요내용', items: ['Gemini 핵심 1'], type: 'list' },
      { title: '액션 아이템', items: ['Gemini 할 일 1'], type: 'list' },
    ],
  });
  assert.equal(
    capturedRequest.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-gemini-key',
  );
  const geminiBody = JSON.parse(capturedRequest.options.body);
  assert.equal(geminiBody.generationConfig.temperature, 0.2);
  assert.equal(geminiBody.generationConfig.topP, 0.9);
  assert.equal(geminiBody.generationConfig.maxOutputTokens, 8192);
  assert.match(geminiBody.contents[0].parts[0].text, /발언자를 제거하고/);

  restoreEnv('LLM_PROVIDER', originalProvider);
  restoreEnv('GEMINI_API_KEY', originalKey);
  restoreEnv('GEMINI_MODEL', originalModel);
  globalThis.fetch = originalFetch;
});

test('summarize API separates category extraction from minutes writing for long transcripts', async () => {
  const originalProvider = process.env.LLM_PROVIDER;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalFetch = globalThis.fetch;

  process.env.LLM_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';

  const prompts = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const prompt = body.contents[0].parts[0].text;
    prompts.push(prompt);

    if (prompts.length <= 2) {
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    categories: [
                      {
                        title: '현재 운영 구조',
                        items: ['롯데마트: NICE VAN 사용', '정산: 카드 매출 대사 후 일괄 전달'],
                      },
                      {
                        title: '핵심 쟁점',
                        items: ['농협VAN: 사용 요구', 'POS: 통신 모듈 변경 필요'],
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      });
    }

    return jsonResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  overview: 'NICE VAN 유지 또는 농협VAN 라우팅 가능성 확인 필요',
                  title: '농협 하나로마트 VAN 협의',
                  keyPoints: ['롯데마트는 NICE VAN 사용', '농협VAN 직접 적용 시 통신 모듈 변경 필요'],
                  actionItems: ['NICE에 라우팅 가능 여부 문의'],
                  sections: [
                    {
                      title: '회의 요약',
                      items: [
                        'NICE VAN 유지 또는 농협VAN 라우팅 가능성 확인 필요',
                        '롯데마트 운영 구조는 NICE VAN 대사 후 일괄 전달 방식',
                        '농협VAN 직접 적용 시 POS 통신 모듈 변경 필요',
                        'NICE 미팅을 통한 기술 가능성 우선 확인 필요',
                      ],
                      type: 'list',
                    },
                    {
                      title: '현재 운영 구조',
                      items: [
                        '항목: 롯데마트 | 내용: NICE VAN 사용',
                        '항목: 정산 | 내용: 카드 매출 대사 후 일괄 전달',
                      ],
                      type: 'list',
                    },
                    {
                      title: '핵심 쟁점 및 리스크',
                      items: [
                        '항목: 농협VAN | 내용: POS 통신 모듈 변경 필요',
                        '항목: 단말기 | 내용: 리더기 교체 가능성 있음',
                      ],
                      type: 'list',
                    },
                    {
                      title: '검토 대안',
                      items: [
                        '대안: NICE 중계 라우팅 | 내용: 농협 거래만 농협VAN 라우팅 | 판단: 우선 검토안',
                        '대안: 농협VAN 직접 적용 | 내용: POS 통신 모듈 변경 | 판단: 최후 대안',
                      ],
                      type: 'list',
                    },
                    {
                      title: '액션 아이템',
                      items: [
                        '담당: 유통관리팀/IT | 액션: NICE에 농협VAN 라우팅 가능 여부 문의 | 기한: NICE 미팅 시',
                        '담당: 유통관리팀 | 액션: 농협VAN 사용 필수 조건 여부 재확인 | 기한: 농협 미팅 전',
                      ],
                      type: 'list',
                    },
                    {
                      title: '주요 일정',
                      items: [
                        '일정: 4월 10일경 | 내용: MOU 체결 예정',
                        '일정: 8월 | 내용: 특정매입 계약 구조 적용 가능성',
                      ],
                      type: 'list',
                    },
                  ],
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
      transcript: '농협 하나로마트 VAN 협의 '.repeat(120),
      note: 'NICE VAN과 농협VAN 라우팅 가능성 확인 필요',
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  const summary = JSON.parse(response.body);
  assert.equal(prompts.length, 3);
  assert.match(prompts[0], /1차 카테고리/);
  assert.match(prompts[1], /1\.5/);
  assert.match(prompts[2], /1\.5/);
  assert.equal(summary.sections.length, 6);
  assert.equal(summary.sections[3].title, '검토 대안');

  restoreEnv('LLM_PROVIDER', originalProvider);
  restoreEnv('GEMINI_API_KEY', originalKey);
  restoreEnv('GEMINI_MODEL', originalModel);
  globalThis.fetch = originalFetch;
});

test('summarize API retries Gemini 503 with fallback model', async () => {
  const originalProvider = process.env.LLM_PROVIDER;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalFallbackModel = process.env.GEMINI_FALLBACK_MODEL;
  const originalFetch = globalThis.fetch;

  process.env.LLM_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';
  process.env.GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash-lite';

  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);

    if (urls.length === 1) {
      return {
        ok: false,
        status: 503,
        async text() {
          return JSON.stringify({ error: { code: 503, message: 'model overloaded' } });
        },
      };
    }

    return jsonResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  overview: 'fallback summary',
                  title: 'fallback title',
                  keyPoints: ['fallback key point'],
                  actionItems: [],
                }),
              },
            ],
          },
        },
      ],
    });
  };

  const response = createResponse();
  await summarizeHandler(createRequest('POST', { transcript: 'meeting text' }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    overview: 'fallback summary',
    title: 'fallback title',
    keyPoints: ['fallback key point'],
    actionItems: [],
    sections: [
      { title: '회의 요약', items: ['fallback summary'], type: 'list' },
      { title: '회의 주요내용', items: ['fallback key point'], type: 'list' },
    ],
  });
  assert.equal(urls.length, 4);
  assert.match(urls[0], /gemini-2\.5-flash/);
  assert.match(urls[1], /gemini-2\.5-flash-lite/);
  assert.match(urls[2], /gemini-2\.5-flash-lite/);
  assert.match(urls[3], /gemini-2\.5-flash-lite/);

  restoreEnv('LLM_PROVIDER', originalProvider);
  restoreEnv('GEMINI_API_KEY', originalKey);
  restoreEnv('GEMINI_MODEL', originalModel);
  restoreEnv('GEMINI_FALLBACK_MODEL', originalFallbackModel);
  globalThis.fetch = originalFetch;
});

test('summarize API repairs Gemini JSON with raw multiline strings', async () => {
  const originalProvider = process.env.LLM_PROVIDER;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalFetch = globalThis.fetch;

  process.env.LLM_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';

  globalThis.fetch = async () => jsonResponse({
    candidates: [
      {
        content: {
          parts: [
            {
              text: '{\n"overview": "첫 줄\n둘째 줄",\n"title": "멀티라인 회의",\n"keyPoints": ["핵심"],\n"actionItems": []\n}',
            },
          ],
        },
      },
    ],
  });

  const response = createResponse();
  await summarizeHandler(
    createRequest('POST', {
      transcript: '프로젝트 일정을 논의했습니다.',
      note: '예산 확인 필요',
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    overview: '첫 줄\n둘째 줄',
    title: '멀티라인 회의',
    keyPoints: ['핵심'],
    actionItems: [],
    sections: [
      { title: '회의 요약', items: ['첫 줄\n둘째 줄'], type: 'list' },
      { title: '회의 주요내용', items: ['핵심'], type: 'list' },
    ],
  });

  restoreEnv('LLM_PROVIDER', originalProvider);
  restoreEnv('GEMINI_API_KEY', originalKey);
  restoreEnv('GEMINI_MODEL', originalModel);
  globalThis.fetch = originalFetch;
});

test('summarize API salvages malformed Gemini JSON instead of failing', async () => {
  const originalProvider = process.env.LLM_PROVIDER;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalFetch = globalThis.fetch;

  process.env.LLM_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';

  globalThis.fetch = async () => jsonResponse({
    candidates: [
      {
        content: {
          parts: [
            {
              text: '{"overview":"SAP "Public Cloud" 도입 방향을 논의했습니다.\\n재무 통합과 공시 대응이 핵심입니다.","title":"SAP Public Cloud 검토","keyPoints":["퍼블릭과 프라이빗 비교","DDA 재검토 필요"],"actionItems":["자료 공유"]}',
            },
          ],
        },
      },
    ],
  });

  const response = createResponse();
  await summarizeHandler(
    createRequest('POST', {
      transcript: 'SAP public cloud discussion',
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    overview: 'SAP "Public Cloud" 도입 방향을 논의함.\n재무 통합과 공시 대응이 핵심임.',
    title: 'SAP Public Cloud 검토',
    keyPoints: ['퍼블릭과 프라이빗 비교', 'DDA 재검토 필요'],
    actionItems: ['자료 공유'],
    sections: [
      {
        title: '회의 요약',
        items: ['SAP "Public Cloud" 도입 방향을 논의함.', '재무 통합과 공시 대응이 핵심임.'],
        type: 'list',
      },
      { title: '회의 주요내용', items: ['퍼블릭과 프라이빗 비교', 'DDA 재검토 필요'], type: 'list' },
      { title: '액션 아이템', items: ['자료 공유'], type: 'list' },
    ],
  });

  restoreEnv('LLM_PROVIDER', originalProvider);
  restoreEnv('GEMINI_API_KEY', originalKey);
  restoreEnv('GEMINI_MODEL', originalModel);
  globalThis.fetch = originalFetch;
});

test('summarize API does not expose raw parenthesized JSON fragments', async () => {
  const originalProvider = process.env.LLM_PROVIDER;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  const originalFetch = globalThis.fetch;

  process.env.LLM_PROVIDER = 'gemini';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';

  globalThis.fetch = async () => jsonResponse({
    candidates: [
      {
        content: {
          parts: [
            {
              text: '({"overview":"10월 매출 목표 초과와 연간 손익 목표 미달 상황을 논의했습니다.","title":"월례 손익 회의","keyPoints":["10월 목표 초과","연간 손익 미달"],"actionItems":["11월과 12월 총력전 진행"]})',
            },
          ],
        },
      },
    ],
  });

  const response = createResponse();
  await summarizeHandler(createRequest('POST', { transcript: '10월 매출 목표와 연간 손익 목표를 논의했습니다.' }), response);

  assert.equal(response.statusCode, 200);
  const summary = JSON.parse(response.body);
  assert.equal(summary.overview, '10월 매출 목표 초과와 연간 손익 목표 미달 상황을 논의함.');
  assert.equal(summary.title, '월례 손익 회의');
  assert.ok(!summary.overview.includes('overview'));
  assert.ok(!summary.overview.includes('{'));

  restoreEnv('LLM_PROVIDER', originalProvider);
  restoreEnv('GEMINI_API_KEY', originalKey);
  restoreEnv('GEMINI_MODEL', originalModel);
  globalThis.fetch = originalFetch;
});

test('summarize API rejects missing OpenAI key', async () => {
  const originalProvider = process.env.LLM_PROVIDER;
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.LLM_PROVIDER;
  delete process.env.OPENAI_API_KEY;

  const response = createResponse();
  await summarizeHandler(createRequest('POST', { transcript: '회의 내용' }), response);

  assert.equal(response.statusCode, 500);
  assert.match(JSON.parse(response.body).error, /OPENAI_API_KEY/);

  restoreEnv('LLM_PROVIDER', originalProvider);
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

test('meetings API lists records from Supabase', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;

  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return jsonResponse([
      {
        id: 'record-1',
        title: 'SAP review',
        meeting_date_time: '2026-05-19T09:00',
        attendees: 'A, B',
        note: 'memo',
        transcript_entries: [{ text: 'hello' }],
        summary: { overview: 'summary', title: '', keyPoints: ['point'], actionItems: [], sections: [] },
        saved_at: '2026-05-19T00:00:00.000Z',
      },
    ]);
  };

  const response = createResponse();
  await meetingsHandler(createRequest('GET'), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), [
    {
      id: 'record-1',
      title: 'SAP review',
      meetingDateTime: '2026-05-19T09:00',
      attendees: 'A, B',
      note: 'memo',
      notes: 'memo',
      transcriptEntries: [{ text: 'hello' }],
      summary: { overview: 'summary', title: '', keyPoints: ['point'], actionItems: [], sections: [] },
      savedAt: '2026-05-19T00:00:00.000Z',
    },
  ]);
  assert.equal(
    capturedRequest.url,
    'https://project.supabase.co/rest/v1/meeting_records?select=*&order=saved_at.desc',
  );
  assert.equal(capturedRequest.options.headers.apikey, 'service-key');

  restoreEnv('SUPABASE_URL', originalUrl);
  restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalKey);
  globalThis.fetch = originalFetch;
});

test('meetings API saves records to Supabase', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;

  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return jsonResponse([
      {
        id: 'record-2',
        title: 'Saved title',
        meeting_date_time: '2026-05-19T10:00',
        attendees: '',
        note: '',
        transcript_entries: [],
        summary: { overview: 'done', keyPoints: [], actionItems: [] },
        saved_at: '2026-05-19T01:00:00.000Z',
      },
    ]);
  };

  const response = createResponse();
  await meetingsHandler(
    createRequest('POST', {
      title: 'Saved title',
      meetingDateTime: '2026-05-19T10:00',
      summary: { overview: 'done', keyPoints: [], actionItems: [] },
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).id, 'record-2');
  assert.equal(capturedRequest.url, 'https://project.supabase.co/rest/v1/meeting_records');
  assert.equal(capturedRequest.options.method, 'POST');
  assert.equal(capturedRequest.options.headers.Prefer, 'return=representation');
  assert.deepEqual(JSON.parse(capturedRequest.options.body), {
    title: 'Saved title',
    meeting_date_time: '2026-05-19T10:00',
    attendees: '',
    note: '',
    transcript_entries: [],
    summary: { overview: 'done', title: '', keyPoints: [], actionItems: [], sections: [] },
  });

  restoreEnv('SUPABASE_URL', originalUrl);
  restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalKey);
  globalThis.fetch = originalFetch;
});

test('meetings API deletes records from Supabase', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;

  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return {
      ok: true,
      status: 204,
      async text() {
        return '';
      },
      async json() {
        return {};
      },
    };
  };

  const response = createResponse();
  await meetingsHandler(createRequest('DELETE', { id: 'record-3' }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.equal(
    capturedRequest.url,
    'https://project.supabase.co/rest/v1/meeting_records?id=eq.record-3',
  );
  assert.equal(capturedRequest.options.method, 'DELETE');

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
