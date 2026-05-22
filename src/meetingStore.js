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

    deleteRecord(id) {
      const records = readRecords(storage);
      const nextRecords = records.filter((record) => record.id !== id);

      storage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
      return nextRecords.length !== records.length;
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
    title: record?.title || '',
    meetingDateTime: record?.meetingDateTime || '',
    attendees: record?.attendees || '',
    note: record?.note || record?.notes || '',
    notes: record?.note || record?.notes || '',
    transcriptEntries: Array.isArray(record?.transcriptEntries)
      ? record.transcriptEntries
      : [],
    summary: {
      title: summary.title || '',
      overview: summary.overview || '',
      keyPoints: Array.isArray(summary.keyPoints) ? summary.keyPoints : [],
      actionItems: Array.isArray(summary.actionItems) ? summary.actionItems : [],
      sections: normalizeSummarySections(summary),
    },
    savedAt: record?.savedAt || new Date().toISOString(),
  };
}

function normalizeSummarySections(summary = {}) {
  if (!Array.isArray(summary.sections)) return [];

  return summary.sections
    .map((section) => ({
      title: String(section?.title || '').trim(),
      items: Array.isArray(section?.items)
        ? section.items.map(String).map((item) => item.trim()).filter(Boolean)
        : [],
      type: section?.type === 'paragraph' ? 'paragraph' : 'list',
    }))
    .filter((section) => section.title && section.items.length > 0);
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `meeting-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
