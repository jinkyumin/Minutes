const KEYWORDS = [
  '목표',
  '일정',
  '결정',
  '공유',
  '검토',
  '논의',
  '고객',
  '매출',
  '리스크',
  '이슈',
  '다음',
  '준비',
  '확인',
];

const ACTION_PATTERNS = [
  '해야 합니다',
  '하기로 했습니다',
  '준비',
  '공유',
  '확인',
  '검토',
  '전까지',
  '다음 주까지',
];

export function summarizeMeeting(entries) {
  const sentences = normalizeEntries(entries);

  if (sentences.length === 0) {
    return {
      overview: '전사된 회의 내용이 없습니다.',
      keyPoints: [],
      actionItems: [],
    };
  }

  const rankedSentences = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreSentence(sentence),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const keyPoints = rankedSentences
    .filter((item) => item.score > 0)
    .slice(0, 5)
    .sort((left, right) => left.index - right.index)
    .map((item) => formatKeyPoint(item.sentence));

  const fallbackKeyPoints = sentences.slice(0, 5);
  const actionItems = sentences.filter(isActionItem).slice(0, 6);

  return {
    overview: sentences[0],
    keyPoints: keyPoints.length > 0 ? keyPoints : fallbackKeyPoints,
    actionItems,
  };
}

function normalizeEntries(entries) {
  return entries
    .flatMap((entry) => splitSentences(entry?.text ?? ''))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function splitSentences(text) {
  const normalizedText = text.replace(/\s+/g, ' ').trim();

  if (!normalizedText) return [];

  return normalizedText
    .split(/(?<=[.!?。！？])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function scoreSentence(sentence) {
  return KEYWORDS.reduce((score, keyword) => {
    return sentence.includes(keyword) ? score + 1 : score;
  }, 0);
}

function isActionItem(sentence) {
  return ACTION_PATTERNS.some((pattern) => sentence.includes(pattern));
}

function formatKeyPoint(sentence) {
  return sentence.replace(/^오늘은\s+/u, '');
}
