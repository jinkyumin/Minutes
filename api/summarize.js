export default async function handler(request, response) {
  setJson(response);

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Only POST is supported.' });
  }

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
  const transcript = String(body.transcript || '').trim();
  const note = String(body.note || '').trim();

  if (!transcript && !note) {
    return response.status(400).json({ error: 'Transcript or note is required.' });
  }

  try {
    const summary =
      process.env.LLM_PROVIDER === 'gemini'
        ? await summarizeWithGemini(body, transcript, note)
        : await summarizeWithOpenAI(body, transcript, note);

    return response.status(200).json(summary);
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Summary failed.' });
  }
}

async function summarizeWithOpenAI(body, transcript, note) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const categories = await extractCategoriesWithOpenAI(body, transcript, note);
  const summary = await writeMinutesWithOpenAI(body, transcript, note, categories);

  if (isWeakSummary(summary, transcript, note)) {
    return retryOpenAiSummary(body, transcript, note, summary, categories);
  }

  return summary;
}

async function extractCategoriesWithOpenAI(body, transcript, note) {
  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolveOpenAiModel(process.env.OPENAI_MODEL),
      text: {
        format: {
          type: 'json_schema',
          name: 'meeting_categories',
          strict: true,
          schema: categoryJsonSchema(),
        },
      },
      input: [
        {
          role: 'system',
          content:
            'You extract categorized facts from Korean meeting transcripts. Return only strict JSON with categories.',
        },
        {
          role: 'user',
          content: buildCategorizationPrompt(body, transcript, note),
        },
      ],
    }),
  });

  if (!openAiResponse.ok) {
    throw new Error(await openAiResponse.text());
  }

  const data = await openAiResponse.json();
  return normalizeCategories(parseOpenAiOutput(data));
}

async function writeMinutesWithOpenAI(body, transcript, note, categories, options = {}) {
  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolveOpenAiModel(process.env.OPENAI_MODEL),
      text: {
        format: {
          type: 'json_schema',
          name: 'meeting_summary',
          strict: true,
          schema: summaryJsonSchema(),
        },
      },
      input: [
        {
          role: 'system',
          content:
            'You write detailed Korean business meeting minutes. Return only strict JSON with overview, keyPoints, actionItems, and sections.',
        },
        {
          role: 'user',
          content: buildMinutesPrompt(body, transcript, note, categories, options),
        },
      ],
    }),
  });

  if (!openAiResponse.ok) {
    throw new Error(await openAiResponse.text());
  }

  const data = await openAiResponse.json();
  return normalizeSummary(parseOpenAiOutput(data));
}

async function retryOpenAiSummary(body, transcript, note, previousSummary, categories) {
  return writeMinutesWithOpenAI(body, transcript, note, categories, { previousSummary, retry: true });
}

async function summarizeWithGemini(body, transcript, note) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite';
  const categoryResponse = await requestGeminiCategories(model, body, transcript, note);

  if (!categoryResponse.ok && categoryResponse.status === 503 && fallbackModel !== model) {
    const fallbackCategoryResponse = await requestGeminiCategories(fallbackModel, body, transcript, note);

    if (!fallbackCategoryResponse.ok) {
      throw new Error(await fallbackCategoryResponse.text());
    }

    const categories = parseGeminiCategories(await fallbackCategoryResponse.json());
    const fallbackSummary = await writeMinutesWithGemini(fallbackModel, body, transcript, note, categories);
    return isWeakSummary(fallbackSummary, transcript, note)
      ? retryGeminiSummary(fallbackModel, body, transcript, note, fallbackSummary, categories)
      : fallbackSummary;
  }

  if (!categoryResponse.ok) {
    throw new Error(await categoryResponse.text());
  }

  const categories = parseGeminiCategories(await categoryResponse.json());
  const summary = await writeMinutesWithGemini(model, body, transcript, note, categories);

  if (isWeakSummary(summary, transcript, note)) {
    return retryGeminiSummary(model, body, transcript, note, summary, categories);
  }

  return summary;
}

async function writeMinutesWithGemini(model, body, transcript, note, categories, options = {}) {
  const response = await requestGeminiSummary(model, body, transcript, note, categories, options);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return parseGeminiSummary(await response.json());
}

async function retryGeminiSummary(model, body, transcript, note, previousSummary, categories) {
  return writeMinutesWithGemini(model, body, transcript, note, categories, {
    previousSummary,
    retry: true,
  });
}

async function requestGeminiCategories(model, body, transcript, note) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0,
          topP: 0.8,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              categories: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    title: { type: 'STRING' },
                    items: {
                      type: 'ARRAY',
                      items: { type: 'STRING' },
                    },
                  },
                  required: ['title', 'items'],
                },
              },
            },
            required: ['categories'],
          },
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildCategorizationPrompt(body, transcript, note) }],
          },
        ],
      }),
    },
  );
}

async function requestGeminiSummary(model, body, transcript, note, categories, options = {}) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              overview: { type: 'STRING' },
              keyPoints: {
                type: 'ARRAY',
                items: { type: 'STRING' },
              },
              actionItems: {
                type: 'ARRAY',
                items: { type: 'STRING' },
              },
              sections: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    title: { type: 'STRING' },
                    items: {
                      type: 'ARRAY',
                      items: { type: 'STRING' },
                    },
                    type: { type: 'STRING' },
                  },
                  required: ['title', 'items', 'type'],
                },
              },
            },
            required: ['title', 'overview', 'keyPoints', 'actionItems', 'sections'],
          },
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildMinutesPrompt(body, transcript, note, categories, options) }],
          },
        ],
      }),
    },
  );
}

function buildCategorizationPrompt(body, transcript, note) {
  return [
    '1차 카테고리 추출 단계입니다.',
    '다음 한국어 회의 전사와 Note에서 회의록 작성에 필요한 사실을 먼저 핵심 카테고리로 그룹핑하세요.',
    '반드시 JSON만 반환하세요.',
    'JSON schema: {"categories":[{"title":"string","items":["string"]}]}',
    '',
    '카테고리 작성 규칙:',
    '- 전사문에 실제로 등장한 내용만 사용하세요.',
    '- 발언자, 말더듬, 반복 표현은 제거하세요.',
    '- 업체명, 시스템명, 계약 형태, 일정, 리스크 원인을 구체 명칭으로 보존하세요.',
    '- 시스템, 계약, 정산, 운영, 리스크, 대안이 언급되면 각각 별도 카테고리로 분리하세요.',
    '- 가능한 카테고리 예시는 "현재 운영 구조", "요구/제안 구조", "핵심 쟁점", "기술 리스크", "운영/정산 리스크", "검토 대안", "액션 아이템", "주요 일정", "참고 구조"입니다.',
    '- 각 카테고리는 2~8개 항목으로 구체적으로 작성하세요.',
    '- 추상 요약 문장 금지. "NICE VAN 사용", "농협VAN 라우팅 가능 여부 확인 필요"처럼 명확한 항목으로 작성하세요.',
    '',
    `회의 제목: ${body.title || '미입력'}`,
    `회의 일시: ${body.meetingDateTime || '미입력'}`,
    `참석자: ${body.attendees || '미입력'}`,
    '',
    `Note:\n${note || '없음'}`,
    '',
    `전사:\n${transcript || '없음'}`,
  ].join('\n');
}

function buildMinutesPrompt(body, transcript, note, categories, options = {}) {
  return [
    ...(options.retry
      ? [
          '이전 회의록 결과가 너무 짧거나 추상적이어서 재작성합니다.',
          '이번 응답은 반드시 상세 섹션 중심으로 다시 작성하세요.',
          `이전 결과:\n${JSON.stringify(options.previousSummary || {})}`,
          '',
        ]
      : []),
    '다음 한국어 회의 내용을 업무용 회의록 문서로 정리하세요.',
    '2차 회의록 작성 단계입니다.',
    '아래 1차 카테고리 추출 결과를 우선 근거로 사용하고, 필요 시 원문 전사를 보조 근거로 사용하세요.',
    '반드시 JSON만 반환하세요.',
    'JSON schema: {"title":"string","overview":"string","keyPoints":["string"],"actionItems":["string"],"sections":[{"title":"string","items":["string"],"type":"paragraph|list"}]}',
    '',
    'sections 작성 규칙:',
    '- title은 회의 내용을 바탕으로 20자 내외의 간결한 회의록 제목으로 작성하세요.',
    '- title은 사용자가 제목을 입력하지 않은 경우 앱에서 회의록 제목으로 사용됩니다.',
    '- sections는 화면에 그대로 표시되는 최종 회의록입니다. overview/keyPoints/actionItems보다 sections 품질을 최우선으로 작성하세요.',
    '- 첫 번째 섹션은 반드시 "회의 요약"이고 type은 반드시 "list"입니다.',
    '- "회의 요약"은 긴 문단 금지. 핵심 결론, 현재 구조, 쟁점, 우선 검토 방향을 4~6개 항목으로 작성하세요.',
    '- 기본 섹션은 "회의 요약", "회의 주요내용", "액션 아이템", "다음 일정"입니다.',
    '- 전사문에 실제로 등장한 내용만 사용하세요.',
    '- 전사문에 없는 내용은 추측하거나 일반론으로 채우지 마세요.',
    '- 특정 섹션에 쓸 내용이 없으면 그 섹션은 생략해도 됩니다.',
    '- 전사문에 별도 구분이 필요한 주제가 명확히 있으면 적절한 섹션을 추가하세요.',
    '- 전사량이 충분하면 6개 이상의 섹션으로 나누어 상세 정리하세요.',
    '- 시스템, 계약, 정산, 운영, 리스크, 대안이 언급된 회의는 "현재 운영 구조", "요구/제안 구조", "핵심 쟁점 및 리스크", "검토 대안", "액션 아이템", "주요 일정" 섹션을 우선 사용하세요.',
    '- 추가 가능한 섹션 예시는 "주요 수치", "결정사항", "본부별 요청사항", "후속 검토사항", "참고 구조"입니다. 단, 실제 내용이 있을 때만 추가하세요.',
    '- 나머지 섹션은 type을 "list"로 하고 핵심 내용을 항목별로 구체적으로 작성하세요.',
    '- 회의 주요내용은 최소 5개 이상, 가능한 경우 8~12개 항목으로 작성하세요.',
    '- 비교, 운영 구조, 쟁점처럼 항목/내용으로 볼 때 좋은 섹션은 items를 "항목: 내용" 형식으로 작성하세요.',
    '- 검토 대안은 가능하면 items를 "대안: 이름 | 내용: 설명 | 판단: 평가" 형식으로 작성하세요.',
    '- 액션 아이템은 가능하면 items를 "담당: 담당자 또는 조직 | 액션: 할 일 | 기한: 일정 또는 시점" 형식으로 작성하세요.',
    '- 주요 일정은 가능하면 items를 "일정: 날짜 또는 시점 | 내용: 일정 내용" 형식으로 작성하세요.',
    '',
    '좋은 출력 예시:',
    '- 현재 운영 구조: NICE VAN 사용, 카드 매출 대사 후 롯데에 데이터 전달',
    '- 핵심 쟁점: 농협VAN 직접 적용 시 POS 통신 모듈, 리더기, 인증 변경 필요',
    '- 검토 대안: 대안: NICE 중계 라우팅 | 내용: 농협 거래만 농협VAN으로 라우팅 가능성 확인 | 판단: 우선 검토안',
    '- 액션 아이템: 담당: 유통관리팀/IT | 액션: NICE에 농협VAN 라우팅 가능 여부 문의 | 기한: NICE 미팅 시',
    '',
    '품질 규칙:',
    '- 발언자를 제거하고 중복 발화, 말더듬, 반복 문장을 통합하세요.',
    '- 숫자, 일정, 담당 조직, 고유명사는 가능한 한 보존하세요.',
    '- 업체명, 시스템명, 계약 형태, 일정, 리스크 원인을 일반화하지 말고 구체 명칭으로 보존하세요.',
    '- 회의 주요내용은 회의 흐름과 논지를 이해할 수 있게 충분히 상세하게 작성하세요.',
    '- 액션 아이템은 실제 후속 조치가 명확한 경우에만 작성하고 담당자나 기한이 있으면 포함하세요.',
    '- 다음 일정은 날짜, 기간, 후속 회의, 마감 시점이 언급된 경우에만 작성하세요.',
    '- 단순 질문, 잡담, 미완성 문장은 할 일로 만들지 마세요.',
    '- 문장은 업무 보고서처럼 간결하고 명확하게 작성하세요.',
    '- 요약만 하고 끝내지 말고, 전사에서 확인되는 운영 구조와 대안을 표로 볼 수 있게 항목화하세요.',
    '- "논의 진행", "필요성 확인", "핵심 과제로 부상"처럼 정보량이 낮은 추상 표현은 쓰지 마세요.',
    '- 대신 "NICE 중계 서버를 통한 농협VAN 라우팅 가능 여부 확인 필요"처럼 대상과 조치를 구체적으로 쓰세요.',
    '',
    '문체 규칙:',
    '- "~한다", "~했다", "~되었다", "~있다" 같은 서술형 종결을 쓰지 마세요.',
    '- 모든 문장은 "~함", "~필요", "~예정", "~가능성 있음", "~우려", "~권고", "~확인 필요" 같은 명사형/메모형 마침으로 작성하세요.',
    '- "제기됨", "부상함", "타진"처럼 추상적이거나 기사체 느낌의 표현을 피하고 "우려", "핵심 과제", "확인 필요"처럼 쓰세요.',
    '- 예: "농협VAN 사용을 요구했다" 금지. "농협VAN 사용 요구" 또는 "농협VAN 사용 요구 확인" 권장.',
    '- 예: "리스크가 있다" 금지. "리스크 있음" 권장.',
    '',
    `1차 카테고리 추출 결과:\n${formatCategoriesForPrompt(categories)}`,
    '',
    `회의 제목: ${body.title || '미입력'}`,
    `회의 일시: ${body.meetingDateTime || '미입력'}`,
    `참석자: ${body.attendees || '미입력'}`,
    '',
    `Note:\n${note || '없음'}`,
    '',
    `전사:\n${transcript || '없음'}`,
  ].join('\n');
}

function formatCategoriesForPrompt(categories) {
  const normalizedCategories = normalizeCategories(categories).categories;

  if (normalizedCategories.length === 0) {
    return '- 추출된 카테고리 없음';
  }

  return normalizedCategories
    .map((category) => [
      `## ${category.title}`,
      ...category.items.map((item) => `- ${item}`),
    ].join('\n'))
    .join('\n\n');
}

function summaryJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      overview: { type: 'string' },
      title: { type: 'string' },
      keyPoints: {
        type: 'array',
        items: { type: 'string' },
      },
      actionItems: {
        type: 'array',
        items: { type: 'string' },
      },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            items: {
              type: 'array',
              items: { type: 'string' },
            },
            type: {
              type: 'string',
              enum: ['paragraph', 'list'],
            },
          },
          required: ['title', 'items', 'type'],
        },
      },
    },
    required: ['title', 'overview', 'keyPoints', 'actionItems', 'sections'],
  };
}

function categoryJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      categories: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            items: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['title', 'items'],
        },
      },
    },
    required: ['categories'],
  };
}

function resolveOpenAiModel(model) {
  if (!model || model === 'chat-latest') {
    return 'gpt-5.2-chat-latest';
  }

  return model;
}

function parseOpenAiOutput(data) {
  const text =
    data.output_text ||
    data.output?.flatMap((item) => item.content || [])
      .map((content) => content.text || '')
      .join('') ||
    '{}';

  return JSON.parse(text);
}

function parseGeminiOutput(data) {
  return data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('') || '{}';
}

function parseGeminiSummary(data) {
  const text = parseGeminiOutput(data);

  try {
    return normalizeSummary(parseJsonObject(text));
  } catch {
    return normalizeSummary(parseLooseSummary(text));
  }
}

function parseGeminiCategories(data) {
  const text = parseGeminiOutput(data);

  try {
    return normalizeCategories(parseJsonObject(text));
  } catch {
    return normalizeCategories({});
  }
}

function normalizeCategories(data) {
  return {
    categories: Array.isArray(data?.categories)
      ? data.categories
        .map((category) => ({
          title: cleanSummaryText(category?.title),
          items: Array.isArray(category?.items)
            ? category.items.map(cleanSummaryText).filter(Boolean)
            : [],
        }))
        .filter((category) => category.title && category.items.length > 0)
      : [],
  };
}

function parseJsonObject(text) {
  const cleanedText = cleanJsonLikeText(text);

  try {
    return JSON.parse(cleanedText);
  } catch {
    return JSON.parse(escapeRawControlCharacters(cleanedText));
  }
}

function parseLooseSummary(text) {
  const cleanedText = cleanJsonLikeText(text);

  return {
    title: cleanSummaryText(extractLooseString(cleanedText, 'title')),
    overview: cleanSummaryText(extractLooseString(cleanedText, 'overview') || extractFirstMeaningfulSentence(cleanedText)),
    keyPoints: extractLooseArray(cleanedText, 'keyPoints'),
    actionItems: extractLooseArray(cleanedText, 'actionItems'),
    sections: extractLooseSections(cleanedText),
  };
}

function cleanJsonLikeText(text) {
  let cleanedText = String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  while (/^\(\s*\{[\s\S]*\}\s*\)$/u.test(cleanedText)) {
    cleanedText = cleanedText.replace(/^\(\s*/u, '').replace(/\s*\)$/u, '').trim();
  }

  const objectStart = cleanedText.indexOf('{');
  const objectEnd = cleanedText.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    cleanedText = cleanedText.slice(objectStart, objectEnd + 1).trim();
  }

  return cleanedText;
}

function extractLooseString(text, fieldName) {
  const nextFields = fieldName === 'overview'
    ? 'title|keyPoints|actionItems|sections'
    : 'overview|keyPoints|actionItems|sections';
  const match = text.match(new RegExp(`"${fieldName}"\\s*:\\s*"([\\s\\S]*?)"\\s*,\\s*"(${nextFields})"\\s*:`));

  return match?.[1]
    ?.replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .trim() || '';
}

function extractLooseArray(text, fieldName) {
  const match = text.match(new RegExp(`"${fieldName}"\\s*:\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) return [];

  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1].trim()).filter(Boolean);
}

function escapeRawControlCharacters(text) {
  let inString = false;
  let isEscaped = false;
  let output = '';

  for (const character of text) {
    if (isEscaped) {
      output += character;
      isEscaped = false;
      continue;
    }

    if (character === '\\') {
      output += character;
      isEscaped = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      output += character;
      continue;
    }

    if (inString && character === '\n') {
      output += '\\n';
      continue;
    }

    if (inString && character === '\r') {
      output += '\\r';
      continue;
    }

    if (inString && character === '\t') {
      output += '\\t';
      continue;
    }

    output += character;
  }

  return output;
}

function normalizeSummary(summary) {
  const sections = normalizeSections(summary);

  return {
    title: cleanSummaryText(summary.title),
    overview: cleanSummaryText(summary.overview),
    keyPoints: Array.isArray(summary.keyPoints) ? summary.keyPoints.map(cleanSummaryText).filter(Boolean) : [],
    actionItems: Array.isArray(summary.actionItems) ? summary.actionItems.map(cleanSummaryText).filter(Boolean) : [],
    sections,
  };
}

function normalizeSections(summary) {
  if (Array.isArray(summary.sections) && summary.sections.length > 0) {
    const sections = summary.sections
      .map((section) => ({
        title: cleanSummaryText(section?.title),
        items: Array.isArray(section?.items)
          ? section.items.map(cleanSummaryText).filter(Boolean)
          : [],
        type: section?.type === 'paragraph' ? 'paragraph' : 'list',
      }))
      .filter((section) => section.title && section.items.length > 0);

    if (sections[0]?.title === '회의 요약') {
      sections[0].type = 'list';
      sections[0].items = splitOverviewItems(sections[0].items);
    }

    return sections;
  }

  return [
    {
      title: '회의 요약',
      items: splitOverviewItems([cleanSummaryText(summary.overview)].filter(Boolean)),
      type: 'list',
    },
    {
      title: '회의 주요내용',
      items: Array.isArray(summary.keyPoints) ? summary.keyPoints.map(cleanSummaryText).filter(Boolean) : [],
      type: 'list',
    },
    {
      title: '액션 아이템',
      items: Array.isArray(summary.actionItems) ? summary.actionItems.map(cleanSummaryText).filter(Boolean) : [],
      type: 'list',
    },
  ].filter((section) => section.items.length > 0);
}

function isWeakSummary(summary, transcript, note) {
  const sourceLength = `${transcript || ''}\n${note || ''}`.trim().length;
  if (sourceLength < 1200) return false;

  const sections = Array.isArray(summary.sections) ? summary.sections : [];
  const itemCount = sections.reduce((count, section) => count + (section.items?.length || 0), 0);
  const hasStructuredSection = sections.some((section) =>
    (section.items || []).some((item) => String(item).includes('|') || /^.{1,24}[:：]\s+/.test(String(item))),
  );
  const hasExpectedBusinessSections = sections.filter((section) =>
    /운영|구조|쟁점|리스크|대안|액션|일정|결정|후속/u.test(section.title || ''),
  ).length;

  return sections.length < 5 || itemCount < 12 || !hasStructuredSection || hasExpectedBusinessSections < 3;
}

function splitOverviewItems(items) {
  return items.flatMap((item) => {
    const text = String(item || '').trim();
    if (!text) return [];
    if (text.includes('|') || /^.{1,24}[:：]\s+/.test(text)) return [text];

    const sentences = text
      .split(/(?<=[.!?。！？])\s+/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    return sentences.length > 1 ? sentences : [text];
  });
}

function extractLooseSections(text) {
  const match = text.match(/"sections"\s*:\s*\[([\s\S]*?)\]\s*\}?$/u);
  if (!match) return [];

  return [...match[1].matchAll(/\{\s*"title"\s*:\s*"([^"]+)"\s*,\s*"items"\s*:\s*\[([\s\S]*?)\]\s*,\s*"type"\s*:\s*"([^"]+)"\s*\}/gu)]
    .map((sectionMatch) => ({
      title: sectionMatch[1],
      items: [...sectionMatch[2].matchAll(/"([^"]+)"/g)].map((item) => item[1]),
      type: sectionMatch[3],
    }));
}

function cleanSummaryText(text) {
  return toMemoEnding(String(text || '')
    .replace(/^\(?\s*\{?\s*"?(overview|keyPoints|actionItems)"?\s*:\s*/iu, '')
    .replace(/[{}[\]]/g, '')
    .replace(/\\n/g, '\n')
    .trim());
}

function toMemoEnding(text) {
  return text
    .replace(/논의가 진행됨/g, '논의함')
    .replace(/논의 진행/g, '논의')
    .replace(/필요성 확인/g, '필요 확인')
    .replace(/핵심 과제로 부상함/g, '핵심 과제')
    .replace(/핵심 과제로 부상/g, '핵심 과제')
    .replace(/제기됨/g, '우려')
    .replace(/타진하고/g, '확인하고')
    .replace(/타진/g, '확인')
    .replace(/필요합니다/g, '필요')
    .replace(/예정입니다/g, '예정')
    .replace(/가능성이 있습니다/g, '가능성 있음')
    .replace(/우려됩니다/g, '우려')
    .replace(/권고됩니다/g, '권고')
    .replace(/되었습니다/g, '됨')
    .replace(/됐습니다/g, '됨')
    .replace(/됩니다/g, '됨')
    .replace(/했습니다/g, '함')
    .replace(/합니다/g, '함')
    .replace(/입니다/g, '임')
    .replace(/있습니다/g, '있음')
    .replace(/없습니다/g, '없음');
}

function extractFirstMeaningfulSentence(text) {
  const withoutJsonKeys = String(text || '')
    .replace(/"?overview"?\s*:/giu, '')
    .replace(/"?keyPoints"?\s*:\s*\[[\s\S]*$/iu, '')
    .replace(/"?actionItems"?\s*:\s*\[[\s\S]*$/iu, '')
    .replace(/[{}[\]]/g, '')
    .trim();

  return withoutJsonKeys.split(/(?<=[.!?。！？])\s+/u)[0] || withoutJsonKeys;
}

function setJson(response) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8');
}
