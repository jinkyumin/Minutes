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
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              overview: { type: 'string' },
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
            required: ['overview', 'keyPoints', 'actionItems', 'sections'],
          },
        },
      },
      input: [
        {
          role: 'system',
          content:
            'You write concise Korean business meeting minutes. Return only strict JSON with overview, keyPoints, actionItems, and sections.',
        },
        {
          role: 'user',
          content: buildPrompt(body, transcript, note),
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

async function summarizeWithGemini(body, transcript, note) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite';
  const geminiResponse = await requestGeminiSummary(model, body, transcript, note);

  if (!geminiResponse.ok && geminiResponse.status === 503 && fallbackModel !== model) {
    const fallbackResponse = await requestGeminiSummary(fallbackModel, body, transcript, note);

    if (!fallbackResponse.ok) {
      throw new Error(await fallbackResponse.text());
    }

    const fallbackData = await fallbackResponse.json();
    return parseGeminiSummary(fallbackData);
  }

  if (!geminiResponse.ok) {
    throw new Error(await geminiResponse.text());
  }

  const data = await geminiResponse.json();
  return parseGeminiSummary(data);
}

async function requestGeminiSummary(model, body, transcript, note) {
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
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
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
            required: ['overview', 'keyPoints', 'actionItems', 'sections'],
          },
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: buildPrompt(body, transcript, note) }],
          },
        ],
      }),
    },
  );
}

function buildPrompt(body, transcript, note) {
  return [
    '다음 한국어 회의 내용을 업무용 회의록 문서로 정리하세요.',
    '작업 순서: 1) 전사 내용을 먼저 핵심 카테고리로 그룹핑 2) 그룹핑 결과를 바탕으로 회의록 작성.',
    '반드시 JSON만 반환하세요.',
    'JSON schema: {"overview":"string","keyPoints":["string"],"actionItems":["string"],"sections":[{"title":"string","items":["string"],"type":"paragraph|list"}]}',
    '',
    'sections 작성 규칙:',
    '- 기본 섹션은 "회의 요약", "회의 주요내용", "액션 아이템", "다음 일정"입니다.',
    '- 전사문에 실제로 등장한 내용만 사용하세요.',
    '- 전사문에 없는 내용은 추측하거나 일반론으로 채우지 마세요.',
    '- 특정 섹션에 쓸 내용이 없으면 그 섹션은 생략해도 됩니다.',
    '- 전사문에 별도 구분이 필요한 주제가 명확히 있으면 적절한 섹션을 추가하세요.',
    '- 전사량이 충분하면 5개 이상의 섹션으로 나누어 상세 정리하세요.',
    '- 추가 가능한 섹션 예시는 "현재 운영 구조", "제안 구조", "핵심 쟁점", "리스크", "검토 대안", "주요 수치", "결정사항", "본부별 요청사항", "후속 검토사항"입니다. 단, 실제 내용이 있을 때만 추가하세요.',
    '- "회의 요약"은 type을 "paragraph"로 하고 3~5개의 구체 사실을 한 문단으로 압축하세요.',
    '- "회의 요약"에는 회의 주제 반복이 아니라 핵심 결론, 주요 쟁점, 우선 검토 방향을 포함하세요.',
    '- 나머지 섹션은 type을 "list"로 하고 핵심 내용을 항목별로 구체적으로 작성하세요.',
    '- 회의 주요내용은 최소 5개 이상, 가능한 경우 8~12개 항목으로 작성하세요.',
    '- 비교, 운영 구조, 쟁점처럼 항목/내용으로 볼 때 좋은 섹션은 items를 "항목: 내용" 형식으로 작성하세요.',
    '- 액션 아이템은 가능하면 items를 "담당: 담당자 또는 조직 | 액션: 할 일 | 기한: 일정 또는 시점" 형식으로 작성하세요.',
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
    '- "논의 진행", "필요성 확인", "핵심 과제로 부상"처럼 정보량이 낮은 추상 표현은 쓰지 마세요.',
    '- 대신 "NICE 중계 서버를 통한 농협VAN 라우팅 가능 여부 확인 필요"처럼 대상과 조치를 구체적으로 쓰세요.',
    '',
    '문체 규칙:',
    '- "~한다", "~했다", "~되었다", "~있다" 같은 서술형 종결을 쓰지 마세요.',
    '- 모든 문장은 "~함", "~필요", "~예정", "~가능성 있음", "~우려", "~권고", "~확인 필요" 같은 명사형/메모형 마침으로 작성하세요.',
    '- 예: "농협VAN 사용을 요구했다" 금지. "농협VAN 사용 요구" 또는 "농협VAN 사용 요구 확인" 권장.',
    '- 예: "리스크가 있다" 금지. "리스크 있음" 권장.',
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
  const match = text.match(new RegExp(`"${fieldName}"\\s*:\\s*"([\\s\\S]*?)"\\s*,\\s*"(keyPoints|actionItems)"\\s*:`));

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
    overview: cleanSummaryText(summary.overview),
    keyPoints: Array.isArray(summary.keyPoints) ? summary.keyPoints.map(cleanSummaryText).filter(Boolean) : [],
    actionItems: Array.isArray(summary.actionItems) ? summary.actionItems.map(cleanSummaryText).filter(Boolean) : [],
    sections,
  };
}

function normalizeSections(summary) {
  if (Array.isArray(summary.sections) && summary.sections.length > 0) {
    return summary.sections
      .map((section) => ({
        title: cleanSummaryText(section?.title),
        items: Array.isArray(section?.items)
          ? section.items.map(cleanSummaryText).filter(Boolean)
          : [],
        type: section?.type === 'paragraph' ? 'paragraph' : 'list',
      }))
      .filter((section) => section.title && section.items.length > 0);
  }

  return [
    {
      title: '회의 요약',
      items: [cleanSummaryText(summary.overview)].filter(Boolean),
      type: 'paragraph',
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
