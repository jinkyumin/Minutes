import { cleanTranscriptEntries } from './transcriptProcessing.js';

export function hasSummarizableMeetingContent({ transcriptEntries = [], note = '' } = {}) {
  return cleanTranscriptEntries(transcriptEntries).length > 0 || String(note || '').trim().length > 0;
}
