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
            },
            required: ['overview', 'keyPoints', 'actionItems'],
          },
        },
      },
      input: [
        {
          role: 'system',
          content:
            'You summarize Korean meeting minutes. Return only strict JSON with overview, keyPoints, and actionItems.',
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
          maxOutputTokens: 2048,
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
            },
            required: ['overview', 'keyPoints', 'actionItems'],
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
    '다음 한국어 회의 내용을 회의록으로 정리하세요.',
    '반드시 JSON만 반환하세요.',
    'JSON schema: {"overview":"string","keyPoints":["string"],"actionItems":["string"]}',
    '발언자를 제거하고 중복 발화, 말더듬, 반복 문장을 통합하세요.',
    '개요는 회의 목적과 결론을 2~4문장으로 자연스럽게 작성하세요.',
    '핵심 내용은 의사결정, 쟁점, 비교, 근거 중심으로 5~8개까지 정리하세요.',
    '할 일은 명확한 후속 조치만 작성하고 담당자나 기한이 있으면 포함하세요.',
    '단순 질문, 잡담, 미완성 문장은 할 일로 만들지 마세요.',
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
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(escapeRawControlCharacters(text));
  }
}

function parseLooseSummary(text) {
  const cleanedText = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  return {
    overview: extractLooseString(cleanedText, 'overview') || cleanedText,
    keyPoints: extractLooseArray(cleanedText, 'keyPoints'),
    actionItems: extractLooseArray(cleanedText, 'actionItems'),
  };
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
  return {
    overview: String(summary.overview || ''),
    keyPoints: Array.isArray(summary.keyPoints) ? summary.keyPoints.map(String) : [],
    actionItems: Array.isArray(summary.actionItems) ? summary.actionItems.map(String) : [],
  };
}

function setJson(response) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8');
}
