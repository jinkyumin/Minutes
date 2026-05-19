import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSummaryPayload, formatMeetingMarkdown } from '../src/meetingPayload.js';

test('builds summary payload from transcript and note', () => {
  const payload = buildSummaryPayload({
    title: 'SAP public review',
    meetingDateTime: '2026-05-19T09:00',
    attendees: '김민수, 이지연',
    note: '예산 이슈는 별도 확인 필요',
    transcriptEntries: [
      { text: '오늘은 신규 시스템 일정을 논의했습니다.' },
      { text: '다음 주까지 테스트 계획을 공유합니다.' },
    ],
  });

  assert.deepEqual(payload, {
    title: 'SAP public review',
    meetingDateTime: '2026-05-19T09:00',
    attendees: '김민수, 이지연',
    note: '예산 이슈는 별도 확인 필요',
    transcript: [
      '오늘은 신규 시스템 일정을 논의했습니다.',
      '다음 주까지 테스트 계획을 공유합니다.',
    ].join('\n'),
  });
});

test('formats meeting markdown for copy and Notion export', () => {
  const markdown = formatMeetingMarkdown({
    title: 'SAP public review',
    meetingDateTime: '2026-05-19T09:00',
    attendees: '김민수, 이지연',
    note: '회의 중 확인한 참고 메모',
    transcriptEntries: [{ text: '담당자는 금요일까지 결과를 공유합니다.' }],
    summary: {
      overview: '신규 시스템 일정을 정리했습니다.',
      keyPoints: ['테스트 일정 확인'],
      actionItems: ['금요일까지 결과 공유'],
    },
  });

  assert.match(markdown, /SAP public review/);
  assert.match(markdown, /# SAP public review/);
  assert.match(markdown, /## Note\n회의 중 확인한 참고 메모/);
  assert.match(markdown, /## 할 일\n- 금요일까지 결과 공유/);
  assert.match(markdown, /## 전사\n- 담당자는 금요일까지 결과를 공유합니다\./);
});
