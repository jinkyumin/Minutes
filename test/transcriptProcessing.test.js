import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendTranscriptEntry,
  cleanTranscriptEntries,
  normalizeSpeechText,
} from '../src/transcriptProcessing.js';

test('normalizes common meeting domain terms', () => {
  assert.equal(
    normalizeSpeechText('에스에이피 에스포하나 디디에이 비티피 이야기를 했습니다'),
    'SAP S/4HANA DDA BTP 이야기를 했습니다',
  );
});

test('skips very short and duplicate transcript entries', () => {
  const entries = [];
  appendTranscriptEntry(entries, '네');
  appendTranscriptEntry(entries, 'SAP 도입 방안을 논의했습니다');
  appendTranscriptEntry(entries, 'SAP 도입 방안을 논의했습니다.');

  assert.deepEqual(entries.map((entry) => entry.text), ['SAP 도입 방안을 논의했습니다']);
});

test('cleans transcript entries before summary payload', () => {
  const cleaned = cleanTranscriptEntries([
    { text: '에스에이피 도입 방안을 논의했습니다' },
    { text: '에스에이피 도입 방안을 논의했습니다.' },
    { text: '디디에이 결과를 다시 확인합니다' },
  ]);

  assert.deepEqual(cleaned.map((entry) => entry.text), [
    'SAP 도입 방안을 논의했습니다',
    'DDA 결과를 다시 확인합니다',
  ]);
});
