import test from 'node:test';
import assert from 'node:assert/strict';

import { hasSummarizableMeetingContent } from '../src/meetingContent.js';

test('does not summarize when transcript and note are empty', () => {
  assert.equal(hasSummarizableMeetingContent({ transcriptEntries: [], note: '   ' }), false);
});

test('summarizes when a usable transcript exists', () => {
  assert.equal(
    hasSummarizableMeetingContent({
      transcriptEntries: [{ text: 'SAP 도입 방향을 논의했습니다' }],
      note: '',
    }),
    true,
  );
});

test('summarizes when note exists without transcript', () => {
  assert.equal(hasSummarizableMeetingContent({ transcriptEntries: [], note: '회의 메모' }), true);
});
