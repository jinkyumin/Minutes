import { cleanTranscriptEntries } from './transcriptProcessing.js';

export function buildSummaryPayload(record) {
  return {
    title: record?.title || '',
    meetingDateTime: record?.meetingDateTime || '',
    attendees: record?.attendees || '',
    note: record?.note || record?.notes || '',
    transcript: normalizeTranscript(cleanTranscriptEntries(record?.transcriptEntries)),
  };
}

export function formatMeetingMarkdown(record) {
  const summary = record?.summary || {};
  const transcriptEntries = Array.isArray(record?.transcriptEntries)
    ? cleanTranscriptEntries(record.transcriptEntries)
    : [];

  return [
    `# ${record?.title || '회의록'}`,
    '',
    `- 회의 제목: ${record?.title || '미입력'}`,
    `- 회의 일시: ${record?.meetingDateTime || '미입력'}`,
    `- 참석자: ${record?.attendees || '미입력'}`,
    '',
    ...formatSummarySections(summary),
    '',
    '## Note',
    record?.note || record?.notes || '내용 없음',
    '',
    '## 전사',
    formatList(transcriptEntries.map((entry) => entry?.text).filter(Boolean)),
  ].join('\n');
}

export function normalizeSummarySections(summary = {}) {
  if (Array.isArray(summary.sections) && summary.sections.length > 0) {
    return summary.sections
      .map((section) => ({
        title: String(section?.title || '').trim(),
        items: normalizeItems(section?.items),
        type: section?.type === 'paragraph' ? 'paragraph' : 'list',
      }))
      .filter((section) => section.title && section.items.length > 0);
  }

  return [
    {
      title: '회의 요약',
      items: normalizeItems(summary.overview || '요약 없음'),
      type: 'paragraph',
    },
    {
      title: '회의 주요내용',
      items: normalizeItems(summary.keyPoints),
      type: 'list',
    },
    {
      title: '액션 아이템',
      items: normalizeItems(summary.actionItems),
      type: 'list',
    },
  ].filter((section) => section.items.length > 0);
}

function normalizeTranscript(entries) {
  return Array.isArray(entries)
    ? entries.map((entry) => entry?.text || '').filter(Boolean).join('\n')
    : '';
}

function formatSummarySections(summary) {
  return normalizeSummarySections(summary).flatMap((section) => [
    `## ${section.title}`,
    section.type === 'paragraph' ? section.items.join('\n') : formatList(section.items),
    '',
  ]);
}

function normalizeItems(items) {
  if (Array.isArray(items)) return items.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof items === 'string' && items.trim()) return [items.trim()];
  return [];
}

function formatList(items) {
  return Array.isArray(items) && items.length > 0
    ? items.map((item) => `- ${item}`).join('\n')
    : '- 내용 없음';
}
