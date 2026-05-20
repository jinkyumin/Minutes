import { summarizeMeeting } from './summary.js';
import { createMeetingStore } from './meetingStore.js';
import { createRemoteMeetingStore } from './remoteMeetingStore.js';
import { buildSummaryPayload, formatMeetingMarkdown } from './meetingPayload.js';
import { appendTranscriptEntry, cleanTranscriptEntries, normalizeSpeechText } from './transcriptProcessing.js';
import { hasSummarizableMeetingContent } from './meetingContent.js';

const NOTION_DATABASE_KEY = 'meeting-minutes-notion-database-id';
const WAVE_BAR_COUNT = 32;
const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

const state = {
  transcriptEntries: [],
  isMeetingActive: false,
  isPaused: false,
  startedAt: null,
  selectedRecordId: null,
  currentRecord: null,
  isHistoryCollapsed: false,
  mediaStream: null,
  mediaRecorder: null,
  audioChunks: [],
  audioContext: null,
  analyser: null,
  waveAnimationId: null,
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
  readyControls: document.querySelector('#readyControls'),
  recordingPanel: document.querySelector('#recordingPanel'),
  recordingTimerText: document.querySelector('#recordingTimerText'),
  recordingMessage: document.querySelector('#recordingMessage'),
  waveform: document.querySelector('#waveform'),
  newMeetingButton: document.querySelector('#newMeetingButton'),
  startButton: document.querySelector('#startButton'),
  pauseButton: document.querySelector('#pauseButton'),
  endButton: document.querySelector('#endButton'),
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
  createWaveBars();
  bindEvents();

  if (!canRecord) {
    elements.supportNotice.hidden = false;
    elements.startButton.disabled = true;
    setStatus('녹음 미지원');
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

async function startMeeting() {
  if (!canRecord) return;

  try {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    setStatus('마이크 권한 필요');
    return;
  }

  state.transcriptEntries = [];
  state.currentRecord = null;
  state.selectedRecordId = null;
  state.isMeetingActive = true;
  state.isPaused = false;
  state.startedAt = new Date();
  state.audioChunks = [];
  clearSummary();
  state.mediaRecorder = createMediaRecorder(state.mediaStream);
  state.mediaRecorder.start();
  startWaveform(state.mediaStream);
  startDurationTimer();
  setStatus('녹음 중');
  setStage('현재 단계: 회의 녹음 중');
  render();
  void renderHistory();
}

function togglePause() {
  if (!state.isMeetingActive) return;

  state.isPaused = !state.isPaused;

  if (state.isPaused) {
    state.mediaRecorder?.pause();
    state.audioContext?.suspend();
    setStatus('일시정지');
  } else {
    state.mediaRecorder?.resume();
    state.audioContext?.resume();
    setStatus('녹음 중');
  }

  render();
}

async function endMeeting() {
  if (!state.isMeetingActive) return;

  state.isMeetingActive = false;
  state.isPaused = false;
  stopDurationTimer();
  stopWaveform();
  setStatus('전사 생성 중');
  setStage('현재 단계: 녹음 전사 중');
  elements.recordingMessage.textContent = '녹음 파일을 전사하고 있습니다.';
  render();

  const recordedAudio = await stopRecording();
  stopMediaStream();

  if (recordedAudio?.size) {
    try {
      const transcript = await transcribeAudio(recordedAudio);
      setTranscriptFromText(transcript);
    } catch (error) {
      setStatus(`전사 실패: ${shortenError(error?.message)}`);
    }
  }

  if (!hasSummarizableMeetingContent({
    transcriptEntries: state.transcriptEntries,
    note: elements.note.value,
  })) {
    setStatus('요약할 내용 없음');
    setStage('현재 단계: 회의 정보 입력');
    render();
    return;
  }

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
    state.mediaRecorder?.stop();
  }

  state.transcriptEntries = [];
  state.isMeetingActive = false;
  state.isPaused = false;
  state.startedAt = null;
  state.currentRecord = null;
  state.selectedRecordId = null;
  state.audioChunks = [];
  stopWaveform();
  stopMediaStream();
  stopDurationTimer();
  elements.meetingTitle.value = '';
  elements.meetingDateTime.value = toDateTimeInputValue(new Date());
  elements.attendees.value = '';
  elements.note.value = '';
  elements.meetingDuration.textContent = '00:00';
  elements.recordingTimerText.textContent = '00:00';
  elements.recordingMessage.textContent = '녹음 파일을 저장 중입니다. 회의 종료 후 전체 음성을 전사하고 요약합니다.';
  clearSummary();
  setStatus('대기 중');
  setStage('현재 단계: 회의 정보 입력');
  render();
  void renderHistory();
}

function createMediaRecorder(stream) {
  const mimeType = pickRecordingMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data?.size) {
      state.audioChunks.push(event.data);
    }
  });

  return recorder;
}

function pickRecordingMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported?.(mimeType)) || '';
}

function stopRecording() {
  return new Promise((resolve) => {
    const recorder = state.mediaRecorder;

    if (!recorder) {
      resolve(null);
      return;
    }

    recorder.addEventListener('stop', () => {
      const type = recorder.mimeType || state.audioChunks[0]?.type || 'audio/webm';
      const audioBlob = new Blob(state.audioChunks, { type });
      state.mediaRecorder = null;
      resolve(audioBlob);
    }, { once: true });

    if (recorder.state === 'inactive') {
      const type = recorder.mimeType || state.audioChunks[0]?.type || 'audio/webm';
      state.mediaRecorder = null;
      resolve(new Blob(state.audioChunks, { type }));
      return;
    }

    recorder.stop();
  });
}

function stopMediaStream() {
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  state.mediaStream = null;
}

async function transcribeAudio(audioBlob) {
  const audio = await blobToDataUrl(audioBlob);
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio,
      mimeType: audioBlob.type || 'audio/webm',
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();
  return data.transcript || '';
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function setTranscriptFromText(transcript) {
  state.transcriptEntries = [];

  String(transcript || '')
    .split(/\n+/)
    .map((line) => normalizeSpeechText(line))
    .filter(Boolean)
    .forEach((line) => appendTranscriptEntry(state.transcriptEntries, line));

  if (state.transcriptEntries.length === 0 && String(transcript || '').trim().length >= 4) {
    appendTranscriptEntry(state.transcriptEntries, transcript);
  }
}

function createWaveBars() {
  elements.waveform.replaceChildren();

  for (let index = 0; index < WAVE_BAR_COUNT; index += 1) {
    const bar = document.createElement('span');
    bar.className = 'wave-bar';
    elements.waveform.append(bar);
  }
}

function startWaveform(stream) {
  stopWaveform();

  state.audioContext = new AudioContext();
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 128;
  state.audioContext.createMediaStreamSource(stream).connect(state.analyser);

  const frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
  const bars = [...elements.waveform.querySelectorAll('.wave-bar')];

  const draw = () => {
    state.analyser.getByteFrequencyData(frequencyData);

    bars.forEach((bar, index) => {
      const bucket = Math.floor((index / bars.length) * frequencyData.length);
      const volume = frequencyData[bucket] / 255;
      const height = 6 + Math.round(volume * 34);
      bar.style.height = state.isPaused ? '6px' : `${height}px`;
      bar.style.opacity = String(state.isPaused ? 0.35 : 0.45 + volume * 0.55);
    });

    state.waveAnimationId = requestAnimationFrame(draw);
  };

  draw();
}

function stopWaveform() {
  if (state.waveAnimationId) {
    cancelAnimationFrame(state.waveAnimationId);
    state.waveAnimationId = null;
  }

  if (state.audioContext && state.audioContext.state !== 'closed') {
    void state.audioContext.close().catch(() => {});
  }
  state.audioContext = null;
  state.analyser = null;

  elements.waveform?.querySelectorAll('.wave-bar').forEach((bar) => {
    bar.style.height = '8px';
    bar.style.opacity = '0.74';
  });
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
  elements.readyControls.hidden = state.isMeetingActive;
  elements.recordingPanel.hidden = !state.isMeetingActive;
  elements.startButton.disabled = state.isMeetingActive || !canRecord;
  elements.pauseButton.disabled = !state.isMeetingActive;
  elements.endButton.disabled = !state.isMeetingActive;
  elements.pauseButton.querySelector('.pause-text').textContent = state.isPaused ? '다시 시작' : '일시정지';
  elements.sendNotionButton.disabled = !state.currentRecord && !state.selectedRecordId;
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
    const deleteButton = document.createElement('button');
    const date = document.createElement('strong');
    const title = document.createElement('span');

    item.className = 'history-item';
    selectButton.type = 'button';
    selectButton.dataset.recordId = record.id;
    selectButton.className = 'history-record-button';
    selectButton.classList.toggle('selected', record.id === state.selectedRecordId);
    deleteButton.type = 'button';
    deleteButton.dataset.deleteRecordId = record.id;
    deleteButton.className = 'history-delete-button';
    deleteButton.textContent = '×';
    deleteButton.title = '회의록 삭제';

    date.textContent = formatMeetingDate(record.meetingDateTime);
    title.textContent = createRecordTitle(record);

    selectButton.append(date, title);
    item.append(selectButton, deleteButton);
    elements.historyList.append(item);
  });
}

function handleHistoryClick(event) {
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

function closeHistoryMenus(event) {
  if (event?.target.closest('.history-item')) return;
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
  elements.recordingTimerText.textContent = `${minutes}:${remainder}`;
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
