const STORAGE_KEY = 'meeting-minutes-records';

export function createMeetingStore(storage) {
  return {
    listRecords() {
      return readRecords(storage).sort((left, right) => {
        return String(right.savedAt).localeCompare(String(left.savedAt));
      });
    },

    getRecord(id) {
      return readRecords(storage).find((record) => record.id === id) ?? null;
    },

    saveRecord(record) {
      const records = readRecords(storage);
      const normalizedRecord = normalizeRecord(record);
      const nextRecords = [
        normalizedRecord,
        ...records.filter((item) => item.id !== normalizedRecord.id),
      ];

      storage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
      return normalizedRecord;
    },
  };
}

function readRecords(storage) {
  try {
    const rawRecords = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(rawRecords) ? rawRecords.map(normalizeRecord) : [];
  } catch {
    return [];
  }
}

function normalizeRecord(record) {
  const summary = record?.summary ?? {};

  return {
    id: record?.id || createId(),
    meetingDateTime: record?.meetingDateTime || '',
    attendees: record?.attendees || '',
    notes: record?.notes || '',
    transcriptEntries: Array.isArray(record?.transcriptEntries)
      ? record.transcriptEntries
      : [],
    summary: {
      overview: summary.overview || '',
      keyPoints: Array.isArray(summary.keyPoints) ? summary.keyPoints : [],
      actionItems: Array.isArray(summary.actionItems) ? summary.actionItems : [],
    },
    savedAt: record?.savedAt || new Date().toISOString(),
  };
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `meeting-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
