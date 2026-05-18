import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeMeeting } from '../src/summary.js';

test('returns an empty-state summary when there is no transcript', () => {
  const summary = summarizeMeeting([]);

  assert.equal(summary.overview, '전사된 회의 내용이 없습니다.');
  assert.deepEqual(summary.keyPoints, []);
  assert.deepEqual(summary.actionItems, []);
});

test('extracts key points from meaningful transcript entries', () => {
  const summary = summarizeMeeting([
    { text: '오늘은 2분기 매출 목표와 신규 고객 온보딩 현황을 공유했습니다.' },
    { text: '다음 주까지 제안서 초안을 준비하고 금요일에 다시 검토하기로 했습니다.' },
    { text: '네.' },
  ]);

  assert.equal(summary.overview, '오늘은 2분기 매출 목표와 신규 고객 온보딩 현황을 공유했습니다.');
  assert.ok(summary.keyPoints.includes('2분기 매출 목표와 신규 고객 온보딩 현황을 공유했습니다.'));
  assert.ok(summary.keyPoints.includes('다음 주까지 제안서 초안을 준비하고 금요일에 다시 검토하기로 했습니다.'));
});

test('detects likely action items', () => {
  const summary = summarizeMeeting([
    { text: '민수님은 고객 피드백을 정리해야 합니다.' },
    { text: '지연님은 다음 회의 전까지 디자인 시안을 공유하기로 했습니다.' },
  ]);

  assert.deepEqual(summary.actionItems, [
    '민수님은 고객 피드백을 정리해야 합니다.',
    '지연님은 다음 회의 전까지 디자인 시안을 공유하기로 했습니다.',
  ]);
});

test('falls back to representative sentences when no keywords are found', () => {
  const summary = summarizeMeeting([
    { text: '안녕하세요 모두 들어오셨나요.' },
    { text: '오늘 날씨가 좋네요.' },
  ]);

  assert.deepEqual(summary.keyPoints, [
    '안녕하세요 모두 들어오셨나요.',
    '오늘 날씨가 좋네요.',
  ]);
});
