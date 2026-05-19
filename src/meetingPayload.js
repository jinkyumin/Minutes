export function buildSummaryPayload(record) {
  return {
    meetingDateTime: record?.meetingDateTime || '',
    attendees: record?.attendees || '',
    note: record?.note || record?.notes || '',
    transcript: normalizeTranscript(record?.transcriptEntries),
  };
}

export function formatMeetingMarkdown(record) {
  const summary = record?.summary || {};
  const transcriptEntries = Array.isArray(record?.transcriptEntries)
    ? record.transcriptEntries
    : [];

  return [
    '# 회의록',
    '',
    `- 회의 일시: ${record?.meetingDateTime || '미입력'}`,
    `- 참석자: ${record?.attendees || '미입력'}`,
    '',
    '## 요약',
    summary.overview || '요약 없음',
    '',
    '## 핵심 내용',
    formatList(summary.keyPoints),
    '',
    '## 할 일',
    formatList(summary.actionItems),
    '',
    '## Note',
    record?.note || record?.notes || '내용 없음',
    '',
    '## 전사',
    formatList(transcriptEntries.map((entry) => entry?.text).filter(Boolean)),
  ].join('\n');
}

function normalizeTranscript(entries) {
  return Array.isArray(entries)
    ? entries.map((entry) => entry?.text || '').filter(Boolean).join('\n')
    : '';
}

function formatList(items) {
  return Array.isArray(items) && items.length > 0
    ? items.map((item) => `- ${item}`).join('\n')
    : '- 내용 없음';
}
