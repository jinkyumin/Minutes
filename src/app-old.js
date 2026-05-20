import { summarizeMeeting } from './summary.js';
import { createMeetingStore } from './meetingStore.js';
import { createRemoteMeetingStore } from './remoteMeetingStore.js';
import { buildSummaryPayload, formatMeetingMarkdown } from './meetingPayload.js';
import { appendTranscriptEntry, cleanTranscriptEntries, normalizeSpeechText } from './transcriptProcessing.js';
import { hasSummarizableMeetingContent } from './meetingContent.js';

const NOTION_DATABASE_KEY = 'meeting-minutes-notion-database-id';
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

const state = {
  recognition: null,
  transcriptEntries: [],
  isMeetingActive: false,
  isPaused: false,
  startedAt: null,
  selectedRecordId: null,
  currentRecord: null,
  isHistoryCollapsed: false,
  interimTranscript: '',
};

const meetingStore = createRemoteMeetingStore(createMeetingStore(window.localStorage));

const elements = {
  appGrid: document.querySelector('#appGrid'),
  stage: document.querySelector('#stage'),
  status: document.querySelector('#status'),
  supportNotice: document.querySelector('#supportNotice'),
  meetingDuration: document.querySelector('#meetingDuration'),
  meetingTitle: document.querySelector('#meetingTitle'),
  meetingDateTime: document.querySelector('#meetingDateTime'),
  attendees: document.querySelector('#attendees'),
  note: document.querySelector('#note'),
  newMeetingButton: document.querySelector('#newMeetingButton'),
  startButton: document.querySelector('#startButton'),
  pauseButton: document.querySelector('#pauseButton'),
  endButton: document.querySelector('#endButton'),
  liveText: document.querySelector('#liveText'),
  transcriptCount: document.querySelector('#transcriptCount'),
  transcriptList: document.querySelector('#transcriptList'),
  summaryOverview: document.querySelector('#summaryOverview'),
  keyPoints: document.querySelector('#keyPoints'),
  actionItems: document.querySelector('#actionItems'),
  copySummaryButton: document.querySelector('#copySummaryButton'),
  sendNotionButton: document.querySelector('#sendNotionButton'),
  notionSettingsButton: document.querySelector('#notionSettingsButton'),
  notionDialog: document.querySelector('#notionDialog'),
  notionDatabaseId: document.querySelector('#notionDatabaseId'),
  saveNotionSettingsButton: document.querySelector('#saveNotionSettingsButton'),
  testNotionButton: document.querySelector('#testNotionButton'),
  toggleHistoryButton: document.querySelector('#toggleHistoryButton'),
  openHistoryButton: document.querySelector('#openHistoryButton'),
  historyList: document.querySelector('#historyList'),
};

let durationTimer = null;

init();

function init() {
  elements.meetingDateTime.value = toDateTimeInputValue(new Date());
  elements.notionDatabaseId.value = window.localStorage.getItem(NOTION_DATABASE_KEY) || '';
  bindEvents();

  if (!SpeechRecognition) {
    elements.supportNotice.hidden = false;
    elements.startButton.disabled = true;
    setStatus('음성 인식 미지원');
  } else {
    state.recognition = createRecognition();
  }

  render();
  void renderHistory();
}

function bindEvents() {
  elements.newMeetingButton.addEventListener('click', resetMeeting);
  elements.startButton.addEventListener('click', startMeeting);
  elements.pauseButton.addEventListener('click', togglePause);
  elements.endButton.addEventListener('click', endMeeting);
  elements.copySummaryButton.addEventListener('click', copySummary);
  elements.sendNotionButton.addEventListener('click', sendCurrentRecordToNotion);
  elements.notionSettingsButton.addEventListener('click', openNotionSettings);
  elements.saveNotionSettingsButton.addEventListener('click', saveNotionSettings);
  elements.testNotionButton.addEventListener('click', testNotionConnection);
  elements.toggleHistoryButton.addEventListener('click', toggleHistory);
  elements.openHistoryButton.addEventListener('click', toggleHistory);
  elements.historyList.addEventListener('click', handleHistoryClick);
  document.addEventListener('click', closeHistoryMenus);
}

function createRecognition() {
  const recognition = new SpeechRecognition();
  recognition.lang = 'ko-KR';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.addEventListener('result', handleRecognitionResult);
  recognition.addEventListener('error', handleRecognitionError);
  recognition.addEventListener('end', () => {
    if (state.isMeetingActive && !state.isPaused) {
      recognition.start();
    }
  });

  return recognition;
}

function startMeeting() {
  state.transcriptEntries = [];
  state.interimTranscript = '';
  state.currentRecord = null;
  state.selectedRecordId = null;
  state.isMeetingActive = true;
  state.isPaused = false;
  state.startedAt = new Date();
  clearSummary();
  state.recognition?.start();
  startDurationTimer();
  setStatus('회의 진행 중');
  setStage('현재 단계: 회의 진행 중');
  render();
  void renderHistory();
}

function togglePause() {
  if (!state.isMeetingActive) return;

  state.isPaused = !state.isPaused;

  if (state.isPaused) {
    state.recognition?.stop();
    setStatus('일시정지');
  } else {
    state.recognition?.start();
    setStatus('회의 진행 중');
  }

  render();
}

async function endMeeting() {
  if (!state.isMeetingActive) return;

  state.isMeetingActive = false;
  state.isPaused = false;
  state.recognition?.stop();
  flushInterimTranscript();
  stopDurationTimer();

  if (!hasSummarizableMeetingContent({
    transcriptEntries: state.transcriptEntries,
    note: elements.note.value,
  })) {
    elements.liveText.textContent = '전사 내용이나 Note가 없어 요약을 생성하지 않았습니다.';
    setStatus('요약할 내용 없음');
    setStage('현재 단계: 회의 정보 입력');
    render();
    return;
  }

  elements.liveText.textContent = '회의가 종료되었습니다. 요약을 생성합니다.';
  setStatus('요약 생성 중');
  setStage('현재 단계: 결과 확인');
  render();

  const draftRecord = buildCurrentRecord({
    summary: summarizeMeeting(buildSummaryEntries()),
  });
  const { summary, source, error } = await summarizeWithLlm(draftRecord);
  const savedRecord = await meetingStore.saveRecord({ ...draftRecord, summary });

  state.currentRecord = savedRecord;
  state.selectedRecordId = savedRecord.id;
  renderSummary(summary);
  void renderHistory();
  setStatus(source === 'llm' ? 'LLM 요약 완료' : `로컬 요약 사용${error ? `: ${error}` : ''}`);
  render();
}

function resetMeeting() {
  if (state.isMeetingActive) {
    state.recognition?.stop();
  }

  state.transcriptEntries = [];
  state.interimTranscript = '';
  state.isMeetingActive = false;
  state.isPaused = false;
  state.startedAt = null;
  state.currentRecord = null;
  state.selectedRecordId = null;
  stopDurationTimer();
  elements.meetingTitle.value = '';
  elements.meetingDateTime.value = toDateTimeInputValue(new Date());
  elements.attendees.value = '';
  elements.note.value = '';
  elements.meetingDuration.textContent = '00:00';
  elements.liveText.textContent = '회의를 시작하면 말한 내용이 여기에 표시됩니다.';
  clearSummary();
  setStatus('대기 중');
  setStage('현재 단계: 회의 정보 입력');
  render();
  void renderHistory();
}

function handleRecognitionResult(event) {
  let interimText = '';

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    const text = result[0].transcript.trim();

    if (!text) continue;

    if (result.isFinal) {
      appendTranscriptEntry(state.transcriptEntries, text);
      state.interimTranscript = '';
    } else {
      interimText += text;
    }
  }

  state.interimTranscript = normalizeSpeechText(interimText);
  elements.liveText.textContent =
    state.interimTranscript || '말을 멈추면 확정된 문장이 전사 목록에 추가됩니다.';
  render();
}

function handleRecognitionError(event) {
  const message =
    event.error === 'not-allowed'
      ? '마이크 권한이 필요합니다'
      : `음성 인식 오류: ${event.error}`;

  setStatus(message);
}

function flushInterimTranscript() {
  if (!state.interimTranscript) return;

  appendTranscriptEntry(state.transcriptEntries, state.interimTranscript);
  state.interimTranscript = '';
}

async function summarizeWithLlm(record) {
  try {
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSummaryPayload(record)),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return {
      summary: await response.json(),
      source: 'llm',
    };
  } catch (error) {
    return {
      summary: summarizeMeeting(buildSummaryEntries()),
      source: 'local',
      error: shortenError(error?.message),
    };
  }
}

function buildSummaryEntries() {
  const noteText = elements.note.value.trim();

  return noteText
    ? [...cleanTranscriptEntries(state.transcriptEntries), { id: 'note', text: noteText, time: new Date() }]
    : cleanTranscriptEntries(state.transcriptEntries);
}

function buildCurrentRecord({ summary }) {
  return {
    title: elements.meetingTitle.value.trim(),
    meetingDateTime: elements.meetingDateTime.value,
    attendees: elements.attendees.value.trim(),
    note: elements.note.value.trim(),
    transcriptEntries: cleanTranscriptEntries(state.transcriptEntries),
    summary,
  };
}

function render() {
  elements.appGrid.classList.toggle('history-collapsed', state.isHistoryCollapsed);
  elements.toggleHistoryButton.textContent = '‹';
  elements.toggleHistoryButton.title = '회의록 목록 숨기기';
  elements.openHistoryButton.textContent = '열기';
  elements.openHistoryButton.title = '회의록 목록 열기';
  elements.startButton.disabled = state.isMeetingActive || !SpeechRecognition;
  elements.pauseButton.disabled = !state.isMeetingActive;
  elements.endButton.disabled = !state.isMeetingActive;
  elements.pauseButton.textContent = state.isPaused ? '다시 시작' : '일시정지';
  elements.transcriptCount.textContent = `${state.transcriptEntries.length}개 문장`;
  elements.sendNotionButton.disabled = !state.currentRecord && !state.selectedRecordId;
  renderTranscript();
}

function renderTranscript() {
  elements.transcriptList.replaceChildren();

  if (state.transcriptEntries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = '아직 확정된 전사 문장이 없습니다.';
    elements.transcriptList.append(empty);
    return;
  }

  state.transcriptEntries.forEach((entry) => {
    const item = document.createElement('li');
    const time = document.createElement('time');
    const text = document.createElement('p');

    time.textContent = formatTime(toDate(entry.time));
    text.textContent = entry.text;
    item.append(time, text);
    elements.transcriptList.append(item);
  });

  elements.transcriptList.scrollTop = elements.transcriptList.scrollHeight;
}

function renderSummary(summary) {
  elements.summaryOverview.classList.remove('guidance-text');
  elements.summaryOverview.textContent = summary.overview || '요약 없음';
  renderList(elements.keyPoints, summary.keyPoints, '핵심 내용이 없습니다.');
  renderList(elements.actionItems, summary.actionItems, '감지된 할 일이 없습니다.');
}

function renderList(list, items, emptyText) {
  list.replaceChildren();

  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = emptyText;
    list.append(empty);
    return;
  }

  items.forEach((itemText) => {
    const item = document.createElement('li');
    item.textContent = itemText;
    list.append(item);
  });
}

async function renderHistory() {
  const records = await meetingStore.listRecords();
  elements.historyList.replaceChildren();

  if (records.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = '저장된 회의록이 없습니다.';
    elements.historyList.append(empty);
    return;
  }

  records.forEach((record) => {
    const item = document.createElement('li');
    const selectButton = document.createElement('button');
    const menuButton = document.createElement('button');
    const menu = document.createElement('div');
    const deleteButton = document.createElement('button');
    const date = document.createElement('strong');
    const title = document.createElement('span');

    item.className = 'history-item';
    selectButton.type = 'button';
    selectButton.dataset.recordId = record.id;
    selectButton.className = 'history-record-button';
    selectButton.classList.toggle('selected', record.id === state.selectedRecordId);
    menuButton.type = 'button';
    menuButton.dataset.menuRecordId = record.id;
    menuButton.className = 'history-menu-button';
    menuButton.textContent = '...';
    menuButton.title = '더보기';
    menu.hidden = true;
    menu.className = 'history-menu';
    deleteButton.type = 'button';
    deleteButton.dataset.deleteRecordId = record.id;
    deleteButton.className = 'delete-record-button';
    deleteButton.textContent = '삭제';

    date.textContent = formatMeetingDate(record.meetingDateTime);
    title.textContent = createRecordTitle(record);

    selectButton.append(date, title);
    menu.append(deleteButton);
    item.append(selectButton, menuButton, menu);
    elements.historyList.append(item);
  });
}

function handleHistoryClick(event) {
  const menuButton = event.target.closest('button[data-menu-record-id]');
  if (menuButton) {
    event.stopPropagation();
    toggleHistoryMenu(menuButton);
    return;
  }

  const deleteButton = event.target.closest('button[data-delete-record-id]');
  if (deleteButton) {
    event.stopPropagation();
    void deleteHistoryRecord(deleteButton.dataset.deleteRecordId);
    return;
  }

  const recordButton = event.target.closest('button[data-record-id]');
  if (recordButton) {
    void selectHistoryRecord(recordButton.dataset.recordId);
  }
}

function toggleHistoryMenu(button) {
  const item = button.closest('.history-item');
  const menu = item.querySelector('.history-menu');

  closeHistoryMenus();
  menu.hidden = false;
}

function closeHistoryMenus(event) {
  if (event?.target.closest('.history-item')) return;

  document.querySelectorAll('.history-menu').forEach((menu) => {
    menu.hidden = true;
  });
}

async function deleteHistoryRecord(recordId) {
  const record = await meetingStore.getRecord(recordId);
  if (!record) return;

  if (!window.confirm('선택한 회의록을 삭제할까요?')) return;

  await meetingStore.deleteRecord(recordId);

  if (state.selectedRecordId === recordId) {
    resetMeeting();
  } else {
    await renderHistory();
  }

  setStatus('회의록 삭제 완료');
}

async function selectHistoryRecord(recordId) {
  const record = await meetingStore.getRecord(recordId);
  if (!record) return;

  state.selectedRecordId = record.id;
  state.currentRecord = record;
  state.transcriptEntries = record.transcriptEntries.map((entry) => ({
    ...entry,
    time: entry.time ? new Date(entry.time) : new Date(record.savedAt),
  }));
  state.isMeetingActive = false;
  state.isPaused = false;
  elements.meetingTitle.value = record.title || '';
  elements.meetingDateTime.value = record.meetingDateTime;
  elements.attendees.value = record.attendees;
  elements.note.value = record.note;
  elements.liveText.textContent = '선택한 회의록을 입력창에 불러왔습니다.';
  renderSummary(record.summary);
  setStatus('회의록 불러옴');
  setStage('현재 단계: 결과 확인');
  render();
  void renderHistory();
}

function toggleHistory() {
  state.isHistoryCollapsed = !state.isHistoryCollapsed;
  render();
}

async function copySummary() {
  const record = state.currentRecord || buildCurrentRecord({
    summary: {
      overview: elements.summaryOverview.textContent,
      keyPoints: listItems(elements.keyPoints),
      actionItems: listItems(elements.actionItems),
    },
  });

  await navigator.clipboard.writeText(formatMeetingMarkdown(record));
  setStatus('회의록 복사 완료');
}

async function sendCurrentRecordToNotion() {
  const record = state.currentRecord || (await meetingStore.getRecord(state.selectedRecordId));
  if (!record) return;

  setStatus('Notion 전송 중');

  try {
    const response = await fetch('/api/notion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        databaseId: elements.notionDatabaseId.value.trim(),
        record,
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    setStatus('Notion 전송 완료');
  } catch (error) {
    setStatus(`Notion 전송 실패: ${shortenError(error?.message)}`);
  }
}

function openNotionSettings() {
  elements.notionDatabaseId.value = window.localStorage.getItem(NOTION_DATABASE_KEY) || '';
  elements.notionDialog.showModal();
}

function saveNotionSettings() {
  window.localStorage.setItem(NOTION_DATABASE_KEY, elements.notionDatabaseId.value.trim());
  elements.notionDialog.close();
  setStatus('Notion 설정 저장');
}

async function testNotionConnection() {
  const sampleRecord = buildCurrentRecord({
    summary: {
      overview: 'Notion 연결 테스트',
      keyPoints: ['설정 확인'],
      actionItems: [],
    },
  });

  const response = await fetch('/api/notion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      databaseId: elements.notionDatabaseId.value.trim(),
      record: sampleRecord,
    }),
  });

  setStatus(response.ok ? 'Notion 연결 성공' : 'Notion 연결 실패');
}

function clearSummary() {
  elements.summaryOverview.classList.add('guidance-text');
  elements.summaryOverview.textContent = '회의 종료 후 요약이 표시됩니다.';
  renderList(elements.keyPoints, [], '회의 종료 후 핵심 내용이 표시됩니다.');
  renderList(elements.actionItems, [], '회의 종료 후 할 일이 표시됩니다.');
}

function listItems(list) {
  return [...list.querySelectorAll('li')]
    .map((item) => item.textContent)
    .filter((text) => text && !text.includes('표시됩니다') && !text.includes('없습니다'));
}

function shortenError(message) {
  if (!message) return '';

  try {
    const parsed = JSON.parse(message);
    return String(parsed.error || message).slice(0, 90);
  } catch {
    return String(message).slice(0, 90);
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}

function setStage(message) {
  elements.stage.textContent = message;
}

function startDurationTimer() {
  stopDurationTimer();
  durationTimer = setInterval(updateDuration, 1000);
  updateDuration();
}

function stopDurationTimer() {
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
}

function updateDuration() {
  if (!state.startedAt) return;

  const seconds = Math.floor((Date.now() - state.startedAt.getTime()) / 1000);
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  elements.meetingDuration.textContent = `${minutes}:${remainder}`;
}

function formatTime(date) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function toDateTimeInputValue(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function formatMeetingDate(value) {
  if (!value) return '회의 일시 미입력';

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function createRecordTitle(record) {
  if (record.title) return record.title;

  const overview = record.summary?.overview?.trim();
  if (overview) return overview.split('\n')[0];

  if (record.attendees) return `${record.attendees} 회의`;

  return '제목 없는 회의록';
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}
