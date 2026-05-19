export function createRemoteMeetingStore(localStore, fetcher = fetch) {
  let recordsCache = localStore.listRecords();

  return {
    async listRecords() {
      try {
        const response = await fetcher('/api/meetings');
        if (!response.ok) throw new Error(await response.text());

        recordsCache = await response.json();
        return recordsCache;
      } catch {
        recordsCache = localStore.listRecords();
        return recordsCache;
      }
    },

    async getRecord(id) {
      const cachedRecord = recordsCache.find((record) => record.id === id);
      if (cachedRecord) return cachedRecord;

      await this.listRecords();
      return recordsCache.find((record) => record.id === id) ?? localStore.getRecord(id);
    },

    async saveRecord(record) {
      try {
        const response = await fetcher('/api/meetings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        });

        if (!response.ok) throw new Error(await response.text());

        const savedRecord = await response.json();
        recordsCache = [
          savedRecord,
          ...recordsCache.filter((item) => item.id !== savedRecord.id),
        ];
        localStore.saveRecord(savedRecord);
        return savedRecord;
      } catch {
        const savedRecord = localStore.saveRecord(record);
        recordsCache = localStore.listRecords();
        return savedRecord;
      }
    },

    async deleteRecord(id) {
      try {
        const response = await fetcher('/api/meetings', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });

        if (!response.ok) throw new Error(await response.text());

        recordsCache = recordsCache.filter((record) => record.id !== id);
        localStore.deleteRecord(id);
        return true;
      } catch {
        const deleted = localStore.deleteRecord(id);
        recordsCache = localStore.listRecords();
        return deleted;
      }
    },
  };
}
