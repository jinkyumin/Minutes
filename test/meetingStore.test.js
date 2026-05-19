import test from 'node:test';
import assert from 'node:assert/strict';

import { createMeetingStore } from '../src/meetingStore.js';

test('saves meeting records and lists newest first', () => {
  const store = createMeetingStore(createMemoryStorage());

  store.saveRecord({
    id: 'first',
    meetingDateTime: '2026-05-18T09:00',
    attendees: '민수, 지연',
    notes: '첫 회의',
    transcriptEntries: [{ text: '첫 번째 회의입니다.' }],
    summary: { overview: '첫 번째 회의입니다.', keyPoints: [], actionItems: [] },
    savedAt: '2026-05-18T00:00:00.000Z',
  });

  store.saveRecord({
    id: 'second',
    meetingDateTime: '2026-05-18T10:00',
    attendees: '현우',
    notes: '두 번째 회의',
    transcriptEntries: [{ text: '두 번째 회의입니다.' }],
    summary: { overview: '두 번째 회의입니다.', keyPoints: [], actionItems: [] },
    savedAt: '2026-05-18T01:00:00.000Z',
  });

  assert.deepEqual(
    store.listRecords().map((record) => record.id),
    ['second', 'first'],
  );
});

test('finds a saved meeting record by id', () => {
  const store = createMeetingStore(createMemoryStorage());

  store.saveRecord({
    id: 'minutes-1',
    meetingDateTime: '2026-05-18T11:00',
    attendees: '민수',
    notes: '',
    transcriptEntries: [],
    summary: { overview: '요약입니다.', keyPoints: ['핵심'], actionItems: [] },
    savedAt: '2026-05-18T02:00:00.000Z',
  });

  assert.equal(store.getRecord('minutes-1')?.summary.overview, '요약입니다.');
  assert.equal(store.getRecord('missing'), null);
});

test('deletes a saved meeting record by id', () => {
  const store = createMeetingStore(createMemoryStorage());

  store.saveRecord({
    id: 'minutes-1',
    meetingDateTime: '2026-05-18T11:00',
    summary: { overview: 'first' },
  });
  store.saveRecord({
    id: 'minutes-2',
    meetingDateTime: '2026-05-18T12:00',
    summary: { overview: 'second' },
  });

  assert.equal(store.deleteRecord('minutes-1'), true);
  assert.equal(store.getRecord('minutes-1'), null);
  assert.deepEqual(
    store.listRecords().map((record) => record.id),
    ['minutes-2'],
  );
  assert.equal(store.deleteRecord('missing'), false);
});

test('normalizes missing optional record fields', () => {
  const store = createMeetingStore(createMemoryStorage());

  const saved = store.saveRecord({
    meetingDateTime: '2026-05-18T12:00',
    summary: { overview: '개요' },
  });

  assert.ok(saved.id);
  assert.equal(saved.attendees, '');
  assert.equal(saved.notes, '');
  assert.deepEqual(saved.transcriptEntries, []);
  assert.deepEqual(saved.summary.keyPoints, []);
  assert.deepEqual(saved.summary.actionItems, []);
});

test('normalizes note and keeps legacy notes readable', () => {
  const store = createMeetingStore(createMemoryStorage());

  const saved = store.saveRecord({
    meetingDateTime: '2026-05-18T12:00',
    notes: '기존 비고 내용',
    summary: { overview: '개요' },
  });

  assert.equal(saved.note, '기존 비고 내용');
});

test('falls back to an empty list when storage contains invalid JSON', () => {
  const storage = createMemoryStorage();
  storage.setItem('meeting-minutes-records', '{not json');

  const store = createMeetingStore(storage);

  assert.deepEqual(store.listRecords(), []);
});

function createMemoryStorage() {
  const data = new Map();

  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}
