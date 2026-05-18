import { summarizeMeeting } from './summary.js';
import { createMeetingStore } from './meetingStore.js';

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

const state = {
  recognition: null,
  transcriptEntries: [],
  isMeetingActive: false,
  isPaused: false,
  startedAt: null,
  selectedRecordId: null,
};

const meetingStore = createMeetingStore(window.localStorage);

const elements = {
  composeTab: document.querySelector('#composeTab'),
  listTab: document.querySelector('#listTab'),
  composeView: document.querySelector('#composeView'),
  listView: document.querySelector('#listView'),
  startButton: document.querySelector('#startButton'),
  pauseButton: document.querySelector('#pauseButton'),
  endButton: document.querySelector('#endButton'),
  resetButton: document.querySelector('#resetButton'),
  copyTranscriptButton: document.querySelector('#copyTranscriptButton'),
  copySummaryButton: document.querySelector('#copySummaryButton'),
  loadRecordButton: document.querySelector('#loadRecordButton'),
  meetingDateTime: document.querySelector('#meetingDateTime'),
  attendees: document.querySelector('#attendees'),
  notes: document.querySelector('#notes'),
  status: document.querySelector('#status'),
  supportNotice: document.querySelector('#supportNotice'),
  liveText: document.querySelector('#liveText'),
  transcriptList: document.querySelector('#transcriptList'),
  summaryOverview: document.querySelector('#summaryOverview'),
  keyPoints: document.querySelector('#keyPoints'),
  actionItems: document.querySelector('#actionItems'),
  meetingDuration: document.querySelector('#meetingDuration'),
  transcriptCount: document.querySelector('#transcriptCount'),
  historyCount: document.querySelector('#historyCount'),
  historyList: document.querySelector('#historyList'),
  recordDetail: document.querySelector('#recordDetail'),
};

let durationTimer = null;

init();

function init() {
  elements.meetingDateTime.value = toDateTimeInputValue(new Date());
  bindEvents();

  if (!SpeechRecognition) {
    elements.supportNotice.hidden = false;
    elements.startButton.disabled = true;
    setStatus('이 브라우저는 실시간 음성 인식을 지원하지 않습니다.');
    renderHistory();
    renderSelectedRecord();
    return;
  }

  state.recognition = createRecognition();
  render();
  renderHistory();
  renderSelectedRecord();
}

function bindEvents() {
  elements.composeTab.addEventListener('click', () => showView('compose'));
  elements.listTab.addEventListener('click', () => showView('list'));
  elements.startButton.addEventListener('click', startMeeting);
  elements.pauseButton.addEventListener('click', togglePause);
  elements.endButton.addEventListener('click', endMeeting);
  elements.resetButton.addEventListener('click', resetMeeting);
  elements.copyTranscriptButton.addEventListener('click', copyTranscript);
  elements.copySummaryButton.addEventListener('click', copySummary);
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

function showView(viewName) {
  const isList = viewName === 'list';
  elements.composeView.hidden = isList;
  elements.listView.hidden = !isList;
  elements.composeTab.classList.toggle('active', !isList);
  elements.listTab.classList.toggle('active', isList);

  if (isList) {
    renderHistory();
    renderSelectedRecord();
  }
}

function startMeeting() {
  state.transcriptEntries = [];
  state.isMeetingActive = true;
  state.isPaused = false;
  state.startedAt = new Date();
  clearSummary();
  state.recognition.start();
  startDurationTimer();
  setStatus('회의 전사를 진행 중입니다.');
  render();
}

function togglePause() {
  if (!state.isMeetingActive) return;

  state.isPaused = !state.isPaused;

  if (state.isPaused) {
    state.recognition.stop();
    setStatus('회의 전사가 일시정지되었습니다.');
  } else {
    state.recognition.start();
    setStatus('회의 전사를 다시 시작했습니다.');
  }

  render();
}

function endMeeting() {
  if (!state.isMeetingActive) return;

  state.isMeetingActive = false;
  state.isPaused = false;
  state.recognition.stop();
  stopDurationTimer();
  elements.liveText.textContent = '회의가 종료되었습니다.';
  const summary = summarizeMeeting(state.transcriptEntries);
  const savedRecord = saveCurrentMeeting(summary);
  state.selectedRecordId = savedRecord.id;
  renderSummary(summary);
  renderHistory();
  renderSelectedRecord();
  setStatus('회의 종료. 회의록을 저장하고 요약을 생성했습니다.');
  render();
}

function resetMeeting() {
  if (state.isMeetingActive) {
    state.recognition.stop();
  }

  state.transcriptEntries = [];
  state.isMeetingActive = false;
  state.isPaused = false;
  state.startedAt = null;
  stopDurationTimer();
  clearSummary();
  elements.meetingDateTime.value = toDateTimeInputValue(new Date());
  elements.attendees.value = '';
  elements.notes.value = '';
  elements.liveText.textContent = '회의를 시작하면 실시간 전사가 여기에 표시됩니다.';
  elements.meetingDuration.textContent = '00:00';
  setStatus('대기 중');
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
    interimText || '말을 멈추면 확정된 문장이 회의록에 추가됩니다.';
  render();
}

function handleRecognitionError(event) {
  const message =
    event.error === 'not-allowed'
      ? '마이크 권한이 필요합니다.'
      : `음성 인식 오류: ${event.error}`;

  setStatus(message);
}

function render() {
  elements.startButton.disabled = state.isMeetingActive || !SpeechRecognition;
  elements.pauseButton.disabled = !state.isMeetingActive;
  elements.endButton.disabled = !state.isMeetingActive;
  elements.pauseButton.textContent = state.isPaused ? '다시 시작' : '일시정지';
  elements.transcriptCount.textContent = `${state.transcriptEntries.length}개 문장`;
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
  appendDefinition(metadata, '비고', record.notes || '없음');

  const overview = createDetailSection('요약', [record.summary.overview || '요약 없음']);
  const keyPoints = createDetailSection('핵심 내용', record.summary.keyPoints);
  const actionItems = createDetailSection('할 일', record.summary.actionItems);
  const transcript = createDetailSection(
    '전사 내용',
    record.transcriptEntries.map((entry) => entry.text),
  );

  elements.recordDetail.append(metadata, overview, keyPoints, actionItems, transcript);
}

function renderSummary(summary) {
  elements.summaryOverview.textContent = summary.overview;
  renderList(elements.keyPoints, summary.keyPoints, '핵심 내용이 없습니다.');
  renderList(elements.actionItems, summary.actionItems, '감지된 할 일이 없습니다.');
}

function renderList(list, items, emptyText) {
  list.replaceChildren();

  if (items.length === 0) {
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

function saveCurrentMeeting(summary) {
  return meetingStore.saveRecord({
    meetingDateTime: elements.meetingDateTime.value,
    attendees: elements.attendees.value.trim(),
    notes: elements.notes.value.trim(),
    transcriptEntries: state.transcriptEntries,
    summary,
  });
}

function selectHistoryRecord(event) {
  const button = event.target.closest('button[data-record-id]');
  if (!button) return;

  state.selectedRecordId = button.dataset.recordId;
  renderHistory();
  renderSelectedRecord();
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
  elements.meetingDateTime.value = record.meetingDateTime;
  elements.attendees.value = record.attendees;
  elements.notes.value = record.notes;
  elements.liveText.textContent = '이전 회의록을 불러왔습니다.';
  renderSummary(record.summary);
  setStatus('이전 회의록을 작성 화면에 불러왔습니다.');
  render();
  showView('compose');
}

function clearSummary() {
  elements.summaryOverview.textContent = '회의 종료 후 요약이 표시됩니다.';
  renderList(elements.keyPoints, [], '회의 종료 후 핵심 내용이 표시됩니다.');
  renderList(elements.actionItems, [], '회의 종료 후 할 일이 표시됩니다.');
}

async function copyTranscript() {
  const metadata = [
    `회의 일시: ${elements.meetingDateTime.value || '미입력'}`,
    `참석자: ${elements.attendees.value.trim() || '미입력'}`,
    `비고: ${elements.notes.value.trim() || '없음'}`,
    '',
  ].join('\n');
  const transcript = state.transcriptEntries
    .map((entry) => `[${formatTime(toDate(entry.time))}] ${entry.text}`)
    .join('\n');

  await copyText(`${metadata}${transcript || '전사된 회의 내용이 없습니다.'}`);
  setStatus('전사 내용을 복사했습니다.');
}

async function copySummary() {
  const keyPoints = listText(elements.keyPoints);
  const actionItems = listText(elements.actionItems);
  const text = [
    `회의 일시: ${elements.meetingDateTime.value || '미입력'}`,
    `참석자: ${elements.attendees.value.trim() || '미입력'}`,
    `비고: ${elements.notes.value.trim() || '없음'}`,
    '',
    `요약: ${elements.summaryOverview.textContent}`,
    '',
    '핵심 내용',
    keyPoints,
    '',
    '할 일',
    actionItems,
  ].join('\n');

  await copyText(text);
  setStatus('요약을 복사했습니다.');
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

function listText(list) {
  return [...list.querySelectorAll('li')]
    .map((item) => `- ${item.textContent}`)
    .join('\n');
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
  const visibleItems = items.filter(Boolean);

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
