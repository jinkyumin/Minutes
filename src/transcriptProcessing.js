const MIN_TRANSCRIPT_LENGTH = 4;
const TERM_REPLACEMENTS = [
  [/에스\s*에이\s*피|에스에이피/gi, 'SAP'],
  [/에스\s*포\s*하나|에스포하나|에스\s*포\s*하나/gi, 'S/4HANA'],
  [/디\s*디\s*에이|디디에이/gi, 'DDA'],
  [/비\s*티\s*피|비티피/gi, 'BTP'],
  [/에프\s*아이|에프아이/gi, 'FI'],
  [/씨\s*오|시오|씨오/gi, 'CO'],
  [/티\s*알|티알/gi, 'TR'],
  [/이\s*알\s*피|이알피/gi, 'ERP'],
  [/피\s*아이|피아이/gi, 'PI'],
];

export function appendTranscriptEntry(entries, text, time = new Date()) {
  const normalizedText = normalizeSpeechText(text);
  if (!shouldAppendTranscriptEntry(entries, normalizedText)) return null;

  const entry = {
    id: globalThis.crypto?.randomUUID?.() || `transcript-${Date.now()}-${Math.random()}`,
    text: normalizedText,
    time,
  };

  entries.push(entry);
  return entry;
}

export function cleanTranscriptEntries(entries) {
  const cleanedEntries = [];

  if (!Array.isArray(entries)) return cleanedEntries;

  entries.forEach((entry) => {
    const text = normalizeSpeechText(entry?.text || '');
    if (!shouldAppendTranscriptEntry(cleanedEntries, text)) return;

    cleanedEntries.push({
      ...entry,
      text,
    });
  });

  return cleanedEntries;
}

export function normalizeSpeechText(text) {
  let normalizedText = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

  TERM_REPLACEMENTS.forEach(([pattern, replacement]) => {
    normalizedText = normalizedText.replace(pattern, replacement);
  });

  return normalizedText.replace(/\s+([.,!?])/g, '$1');
}

function shouldAppendTranscriptEntry(entries, text) {
  if (!text || text.length < MIN_TRANSCRIPT_LENGTH) return false;

  const comparableText = comparable(text);
  return !entries.some((entry) => comparable(entry.text) === comparableText);
}

function comparable(text) {
  return normalizeSpeechText(text)
    .replace(/[.?!。！？,\s]/g, '')
    .toLowerCase();
}
