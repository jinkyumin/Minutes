import { formatMeetingMarkdown } from '../src/meetingPayload.js';

export default async function handler(request, response) {
  setJson(response);

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Only POST is supported.' });
  }

  if (!process.env.NOTION_TOKEN) {
    return response.status(500).json({ error: 'NOTION_TOKEN is not configured.' });
  }

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : request.body || {};
  const databaseId = body.databaseId || process.env.NOTION_DATABASE_ID;

  if (!databaseId) {
    return response.status(400).json({ error: 'Notion database ID is required.' });
  }

  const record = body.record || {};
  const notionResponse = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        Name: {
          title: [
            {
              text: {
                content: createTitle(record),
              },
            },
          ],
        },
      },
      children: markdownToBlocks(formatMeetingMarkdown(record)),
    }),
  });

  if (!notionResponse.ok) {
    return response.status(notionResponse.status).json({
      error: await notionResponse.text(),
    });
  }

  const data = await notionResponse.json();
  return response.status(200).json({ id: data.id, url: data.url });
}

function createTitle(record) {
  const date = record?.meetingDateTime || '미입력';
  return `회의록 ${date}`;
}

function markdownToBlocks(markdown) {
  return markdown.split('\n').slice(0, 90).map((line) => {
    if (line.startsWith('# ')) {
      return paragraphBlock(line.replace(/^#\s+/, ''));
    }

    if (line.startsWith('## ')) {
      return headingBlock(line.replace(/^##\s+/, ''));
    }

    return paragraphBlock(line);
  });
}

function headingBlock(text) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: text || ' ' } }],
    },
  };
}

function paragraphBlock(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: text || ' ' } }],
    },
  };
}

function setJson(response) {
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8');
}
