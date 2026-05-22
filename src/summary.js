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
      title: '',
      overview: '전사된 회의 내용이 없습니다.',
      keyPoints: [],
      actionItems: [],
      sections: [],
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

  const fallbackKeyPoints = sentences.slice(0, 5).map(toMemoEnding);
  const actionItems = sentences.filter(isActionItem).slice(0, 6).map(toMemoEnding);
  const overview = toMemoEnding(sentences[0]);
  const normalizedKeyPoints = keyPoints.length > 0 ? keyPoints.map(toMemoEnding) : fallbackKeyPoints;

  return {
    title: createSummaryTitle(normalizedKeyPoints, overview),
    overview,
    keyPoints: normalizedKeyPoints,
    actionItems,
    sections: [
      { title: '회의 요약', items: [overview], type: 'paragraph' },
      { title: '회의 주요내용', items: normalizedKeyPoints, type: 'list' },
      { title: '액션 아이템', items: actionItems, type: 'list' },
    ].filter((section) => section.items.length > 0),
  };
}

function createSummaryTitle(keyPoints, overview) {
  const source = keyPoints[0] || overview || '회의록';
  return source
    .replace(/[.!?。！？]$/u, '')
    .replace(/\s+/g, ' ')
    .slice(0, 24);
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

function toMemoEnding(text) {
  return String(text || '')
    .replace(/논의가 진행됨/g, '논의함')
    .replace(/논의 진행/g, '논의')
    .replace(/필요성 확인/g, '필요 확인')
    .replace(/핵심 과제로 부상함/g, '핵심 과제')
    .replace(/핵심 과제로 부상/g, '핵심 과제')
    .replace(/제기됨/g, '우려')
    .replace(/타진하고/g, '확인하고')
    .replace(/타진/g, '확인')
    .replace(/필요합니다/g, '필요')
    .replace(/예정입니다/g, '예정')
    .replace(/가능성이 있습니다/g, '가능성 있음')
    .replace(/우려됩니다/g, '우려')
    .replace(/권고됩니다/g, '권고')
    .replace(/되었습니다/g, '됨')
    .replace(/됐습니다/g, '됨')
    .replace(/됩니다/g, '됨')
    .replace(/했습니다/g, '함')
    .replace(/합니다/g, '함')
    .replace(/입니다/g, '임')
    .replace(/있습니다/g, '있음')
    .replace(/없습니다/g, '없음');
}
