export default async function handler(request, response) {
  setJson(response);

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Only POST is supported.' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return response.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });
  }

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
  const transcript = String(body.transcript || '').trim();
  const note = String(body.note || '').trim();

  if (!transcript && !note) {
    return response.status(400).json({ error: 'Transcript or note is required.' });
  }

  try {
    const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: resolveModel(process.env.OPENAI_MODEL),
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
            content: [
              `회의 일시: ${body.meetingDateTime || '미입력'}`,
              `참석자: ${body.attendees || '미입력'}`,
              '',
              `Note:\n${note || '없음'}`,
              '',
              `전사:\n${transcript || '없음'}`,
              '',
              'JSON schema: {"overview":"string","keyPoints":["string"],"actionItems":["string"]}',
            ].join('\n'),
          },
        ],
      }),
    });

    if (!openAiResponse.ok) {
      return response.status(openAiResponse.status).json({
        error: await openAiResponse.text(),
      });
    }

    const data = await openAiResponse.json();
    return response.status(200).json(normalizeSummary(parseOutputText(data)));
  } catch (error) {
    return response.status(500).json({ error: error.message || 'Summary failed.' });
  }
}

function resolveModel(model) {
  if (!model || model === 'chat-latest') {
    return 'gpt-5.2-chat-latest';
  }

  return model;
}

function parseOutputText(data) {
  const text =
    data.output_text ||
    data.output?.flatMap((item) => item.content || [])
      .map((content) => content.text || '')
      .join('') ||
    '{}';

  return JSON.parse(text);
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
