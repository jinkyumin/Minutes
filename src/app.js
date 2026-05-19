import { summarizeMeeting } from './summary.js';
import { createMeetingStore } from './meetingStore.js';
import { buildSummaryPayload, formatMeetingMarkdown } from './meetingPayload.js';

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
};

const meetingStore = createMeetingStore(window.localStorage);

const elements = {
  stage: document.querySelector('#stage'),
  status: document.querySelector('#status'),
  supportNotice: document.querySelector('#supportNotice'),
  meetingDuration: document.querySelector('#meetingDuration'),
  meetingDateTime: document.querySelector('#meetingDateTime'),
  attendees: document.querySelector('#attendees'),
  note: document.querySelector('#note'),
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
  historyCount: document.querySelector('#historyCount'),
  historyList: document.querySelector('#historyList'),
  recordDetail: document.querySelector('#recordDetail'),
  loadRecordButton: document.querySelector('#loadRecordButton'),
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
  renderHistory();
  renderSelectedRecord();
}

function bindEvents() {
  elements.startButton.addEventListener('click', startMeeting);
  elements.pauseButton.addEventListener('click', togglePause);
  elements.endButton.addEventListener('click', endMeeting);
  elements.copySummaryButton.addEventListener('click', copySummary);
  elements.sendNotionButton.addEventListener('click', sendCurrentRecordToNotion);
  elements.notionSettingsButton.addEventListener('click', openNotionSettings);
  elements.saveNotionSettingsButton.addEventListener('click', saveNotionSettings);
  elements.testNotionButton.addEventListener('click', testNotionConnection);
  elements.historyList.addEventListener('click', selectHistoryRecord);
  elements.loadRecordButton.addEventListener('click', loadSelectedRecordIntoCompose);
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
  stopDurationTimer();
  elements.liveText.textContent = '회의가 종료되었습니다. 요약을 생성합니다.';
  setStatus('요약 생성 중');
  setStage('현재 단계: 결과 확인');
  render();

  const draftRecord = buildCurrentRecord({
    summary: summarizeMeeting(buildSummaryEntries()),
  });
  const summary = await summarizeWithChatGPT(draftRecord);
  const savedRecord = meetingStore.saveRecord({ ...draftRecord, summary });

  state.currentRecord = savedRecord;
  state.selectedRecordId = savedRecord.id;
  renderSummary(summary);
  renderHistory();
  renderSelectedRecord();
  setStatus('요약 완료');
  render();
}

function handleRecognitionResult(event) {
  let interimText = '';

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    const text = result[0].transcript.trim();

    if (!text) continue;

    if (result.isFinal) {
      state.transcriptEntries.push({
        id: crypto.randomUUID(),
        text,
        time: new Date(),
      });
    } else {
      interimText += text;
    }
  }

  elements.liveText.textContent =
    interimText || '말을 멈추면 확정된 문장이 전사 목록에 추가됩니다.';
  render();
}

function handleRecognitionError(event) {
  const message =
    event.error === 'not-allowed'
      ? '마이크 권한이 필요합니다'
      : `음성 인식 오류: ${event.error}`;

  setStatus(message);
}

async function summarizeWithChatGPT(record) {
  try {
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSummaryPayload(record)),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return await response.json();
  } catch {
    setStatus('로컬 요약 사용');
    return summarizeMeeting(buildSummaryEntries());
  }
}

function buildSummaryEntries() {
  const noteText = elements.note.value.trim();

  return noteText
    ? [...state.transcriptEntries, { id: 'note', text: noteText, time: new Date() }]
    : state.transcriptEntries;
}

function buildCurrentRecord({ summary }) {
  return {
    meetingDateTime: elements.meetingDateTime.value,
    attendees: elements.attendees.value.trim(),
    note: elements.note.value.trim(),
    transcriptEntries: state.transcriptEntries,
    summary,
  };
}

function render() {
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

function renderHistory() {
  const records = meetingStore.listRecords();
  elements.historyList.replaceChildren();
  elements.historyCount.textContent = `${records.length}건`;

  if (records.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = '저장된 회의록이 없습니다.';
    elements.historyList.append(empty);
    return;
  }

  records.forEach((record) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const title = document.createElement('strong');
    const meta = document.createElement('span');
    const preview = document.createElement('p');

    button.type = 'button';
    button.dataset.recordId = record.id;
    button.classList.toggle('selected', record.id === state.selectedRecordId);
    title.textContent = formatMeetingDate(record.meetingDateTime);
    meta.textContent = record.attendees || '참석자 미입력';
    preview.textContent = record.summary.overview || '요약 없음';

    button.append(title, meta, preview);
    item.append(button);
    elements.historyList.append(item);
  });
}

function renderSelectedRecord() {
  const record = state.selectedRecordId
    ? meetingStore.getRecord(state.selectedRecordId)
    : null;

  elements.recordDetail.replaceChildren();
  elements.loadRecordButton.disabled = !record;

  if (!record) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '목록에서 회의록을 선택하면 상세 내용이 표시됩니다.';
    elements.recordDetail.append(empty);
    return;
  }

  const metadata = document.createElement('dl');
  metadata.className = 'detail-metadata';
  appendDefinition(metadata, '회의 일시', formatMeetingDate(record.meetingDateTime));
  appendDefinition(metadata, '참석자', record.attendees || '미입력');
  appendDefinition(metadata, 'Note', record.note || '없음');

  elements.recordDetail.append(
    metadata,
    createDetailSection('요약', [record.summary.overview || '요약 없음']),
    createDetailSection('핵심 내용', record.summary.keyPoints),
    createDetailSection('할 일', record.summary.actionItems),
    createDetailSection('전사 내용', record.transcriptEntries.map((entry) => entry.text)),
  );
}

function selectHistoryRecord(event) {
  const button = event.target.closest('button[data-record-id]');
  if (!button) return;

  state.selectedRecordId = button.dataset.recordId;
  state.currentRecord = meetingStore.getRecord(state.selectedRecordId);
  renderHistory();
  renderSelectedRecord();
  render();
}

function loadSelectedRecordIntoCompose() {
  const record = meetingStore.getRecord(state.selectedRecordId);
  if (!record) return;

  state.transcriptEntries = record.transcriptEntries.map((entry) => ({
    ...entry,
    time: entry.time ? new Date(entry.time) : new Date(record.savedAt),
  }));
  state.isMeetingActive = false;
  state.isPaused = false;
  state.currentRecord = record;
  elements.meetingDateTime.value = record.meetingDateTime;
  elements.attendees.value = record.attendees;
  elements.note.value = record.note;
  elements.liveText.textContent = '이전 회의록을 불러왔습니다.';
  renderSummary(record.summary);
  setStatus('회의록 불러옴');
  setStage('현재 단계: 결과 확인');
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
  const record = state.currentRecord || meetingStore.getRecord(state.selectedRecordId);
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
  } catch {
    setStatus('Notion 전송 실패');
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

  await sendRecordToNotion(sampleRecord);
}

async function sendRecordToNotion(record) {
  const response = await fetch('/api/notion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      databaseId: elements.notionDatabaseId.value.trim(),
      record,
    }),
  });

  setStatus(response.ok ? 'Notion 연결 성공' : 'Notion 연결 실패');
}

function clearSummary() {
  elements.summaryOverview.textContent = '회의 종료 후 요약이 표시됩니다.';
  renderList(elements.keyPoints, [], '회의 종료 후 핵심 내용이 표시됩니다.');
  renderList(elements.actionItems, [], '회의 종료 후 할 일이 표시됩니다.');
}

function listItems(list) {
  return [...list.querySelectorAll('li')]
    .map((item) => item.textContent)
    .filter((text) => text && !text.includes('표시됩니다') && !text.includes('없습니다'));
}

function appendDefinition(list, term, value) {
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = term;
  dd.textContent = value;
  list.append(dt, dd);
}

function createDetailSection(title, items) {
  const section = document.createElement('section');
  const heading = document.createElement('h3');
  const list = document.createElement('ul');
  const visibleItems = Array.isArray(items) ? items.filter(Boolean) : [];

  heading.textContent = title;
  section.className = 'detail-section';

  if (visibleItems.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = '내용이 없습니다.';
    list.append(empty);
  } else {
    visibleItems.forEach((itemText) => {
      const item = document.createElement('li');
      item.textContent = itemText;
      list.append(item);
    });
  }

  section.append(heading, list);
  return section;
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
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}
