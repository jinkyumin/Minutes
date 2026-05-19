import test from 'node:test';
import assert from 'node:assert/strict';

import { createRemoteMeetingStore } from '../src/remoteMeetingStore.js';

test('remote meeting store lists records from API', async () => {
  const localStore = createFakeLocalStore();
  const fetchCalls = [];
  const store = createRemoteMeetingStore(localStore, async (url, options) => {
    fetchCalls.push({ url, options });
    return jsonResponse([
      { id: 'remote-1', title: 'Remote meeting', savedAt: '2026-05-19T00:00:00.000Z' },
    ]);
  });

  const records = await store.listRecords();

  assert.deepEqual(records.map((record) => record.id), ['remote-1']);
  assert.equal(fetchCalls[0].url, '/api/meetings');
});

test('remote meeting store saves records through API and falls back locally', async () => {
  const localStore = createFakeLocalStore();
  const store = createRemoteMeetingStore(localStore, async () => ({
    ok: false,
    status: 500,
    async text() {
      return 'failed';
    },
  }));

  const saved = await store.saveRecord({ id: 'local-1', title: 'Local fallback' });

  assert.equal(saved.id, 'local-1');
  assert.equal(localStore.savedRecord.title, 'Local fallback');
});

test('remote meeting store deletes records through API and falls back locally', async () => {
  const localStore = createFakeLocalStore();
  const fetchCalls = [];
  const store = createRemoteMeetingStore(localStore, async (url, options) => {
    fetchCalls.push({ url, options });
    return jsonResponse({ ok: true });
  });

  const deleted = await store.deleteRecord('remote-2');

  assert.equal(deleted, true);
  assert.equal(fetchCalls[0].url, '/api/meetings');
  assert.equal(fetchCalls[0].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), { id: 'remote-2' });
});

function createFakeLocalStore() {
  return {
    savedRecord: null,
    deletedId: null,
    records: [],
    listRecords() {
      return this.records;
    },
    getRecord(id) {
      return this.records.find((record) => record.id === id) ?? null;
    },
    saveRecord(record) {
      this.savedRecord = record;
      this.records = [record];
      return record;
    },
    deleteRecord(id) {
      this.deletedId = id;
      this.records = this.records.filter((record) => record.id !== id);
      return true;
    },
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}
