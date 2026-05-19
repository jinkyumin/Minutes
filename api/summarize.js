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
  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        generationConfig: {
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

  if (!geminiResponse.ok) {
    throw new Error(await geminiResponse.text());
  }

  const data = await geminiResponse.json();
  return normalizeSummary(JSON.parse(parseGeminiOutput(data)));
}

function buildPrompt(body, transcript, note) {
  return [
    '다음 한국어 회의 내용을 회의록으로 정리하세요.',
    '반드시 JSON만 반환하세요.',
    'JSON schema: {"overview":"string","keyPoints":["string"],"actionItems":["string"]}',
    '',
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
