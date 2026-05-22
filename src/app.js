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
  uploadAudioButton: document.querySelector('#uploadAudioButton'),
  audioFileInput: document.querySelector('#audioFileInput'),
  pauseButton: document.querySelector('#pauseButton'),
  endButton: document.querySelector('#endButton'),
  summarySections: document.querySelector('#summarySections'),
  summaryOverview: document.querySelector('#summaryOverview'),
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
  elements.uploadAudioButton.addEventListener('click', () => elements.audioFileInput.click());
  elements.audioFileInput.addEventListener('change', handleAudioFileUpload);
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
  elements.recordingMessage.textContent = '녹음 파일을 저장 중입니다.';
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
      if (!hasCurrentMeetingContent()) {
        render();
        return;
      }
    }
  }

  await summarizeAndSaveCurrentMeeting();
}

async function handleAudioFileUpload(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  state.transcriptEntries = [];
  state.currentRecord = null;
  state.selectedRecordId = null;
  clearSummary();
  setStatus('업로드 전사 중');
  setStage('현재 단계: 음성 파일 전사 중');
  render();

  try {
    const transcript = await transcribeAudio(file);
    setTranscriptFromText(transcript);
  } catch (error) {
    setStatus(`전사 실패: ${shortenError(error?.message)}`);
    if (!hasCurrentMeetingContent()) {
      elements.audioFileInput.value = '';
      render();
      return;
    }
  } finally {
    elements.audioFileInput.value = '';
  }

  await summarizeAndSaveCurrentMeeting();
}

async function summarizeAndSaveCurrentMeeting() {
  if (!hasCurrentMeetingContent()) {
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

function hasCurrentMeetingContent() {
  return hasSummarizableMeetingContent({
    transcriptEntries: state.transcriptEntries,
    note: elements.note.value,
  });
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
  elements.recordingMessage.textContent = '녹음 파일을 저장 중입니다.';
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
  const mimeType = normalizeAudioMimeType(audioBlob.type || 'audio/webm');
  const upload = await createAudioUpload(audioBlob, mimeType);
  await uploadAudioToStorage(upload, audioBlob, mimeType);

  try {
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storagePath: upload.path,
        mimeType,
      }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();
    return data.transcript || '';
  } finally {
    void cleanupUploadedAudio(upload.path);
  }
}

async function createAudioUpload(audioBlob, mimeType) {
  const response = await fetch('/api/audio-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: audioBlob.name || `meeting.${extensionForMimeType(mimeType)}`,
      mimeType,
      size: audioBlob.size,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

async function uploadAudioToStorage(upload, audioBlob, mimeType) {
  const uploadBlob = audioBlob.type === mimeType ? audioBlob : new Blob([audioBlob], { type: mimeType });
  const formData = new FormData();
  formData.append('cacheControl', '60');
  formData.append('', uploadBlob);

  const response = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: {
      'x-upsert': 'false',
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function cleanupUploadedAudio(storagePath) {
  if (!storagePath) return;

  try {
    await fetch('/api/audio-cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storagePath }),
    });
  } catch {
    // Server-side cleanup is the primary path; this is a best-effort fallback.
  }
}

function normalizeAudioMimeType(mimeType) {
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return normalized.startsWith('audio/') ? normalized : 'audio/webm';
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
  elements.uploadAudioButton.disabled = state.isMeetingActive;
  elements.pauseButton.disabled = !state.isMeetingActive;
  elements.endButton.disabled = !state.isMeetingActive;
  elements.pauseButton.querySelector('.pause-text').textContent = state.isPaused ? '다시 시작' : '일시정지';
  elements.sendNotionButton.disabled = !state.currentRecord && !state.selectedRecordId;
}

function renderSummary(summary) {
  elements.summarySections.replaceChildren();
  getSummarySections(summary).forEach((section) => {
    elements.summarySections.append(createSummarySection(section));
  });
}

function createSummarySection(section) {
  const wrapper = document.createElement('section');
  const title = document.createElement('h3');
  wrapper.className = 'summary-section';
  wrapper.dataset.sectionKind = getSummarySectionKind(section.title);
  title.textContent = section.title;
  wrapper.append(title);

  if (section.type === 'paragraph') {
    const paragraph = document.createElement('p');
    paragraph.className = 'summary-overview';
    paragraph.textContent = section.items[0] || '내용 없음';
    wrapper.append(paragraph);
    return wrapper;
  }

  const structuredRows = parseStructuredRows(section.items);

  if (structuredRows.length > 0) {
    wrapper.append(createSummaryTable(structuredRows));
    return wrapper;
  }

  const list = document.createElement('ul');
  list.className = 'summary-list';
  renderList(list, section.items, '내용 없음');
  wrapper.append(list);
  return wrapper;
}

function getSummarySectionKind(title = '') {
  if (title.includes('요약')) return 'overview';
  if (title.includes('액션')) return 'action';
  if (title.includes('일정')) return 'schedule';
  if (title.includes('리스크') || title.includes('쟁점')) return 'risk';
  if (title.includes('대안') || title.includes('방향')) return 'option';
  return 'default';
}

function parseStructuredRows(items) {
  const rows = normalizeSummaryItems(items).map(parseStructuredItem).filter(Boolean);

  if (rows.length === 0) return [];
  if (rows.length < Math.ceil(normalizeSummaryItems(items).length * 0.6)) return [];

  const columns = rows.flatMap((row) => Object.keys(row));
  const uniqueColumns = [...new Set(columns)];

  if (uniqueColumns.length < 2) return [];

  return rows.map((row) => ({ row, columns: uniqueColumns }));
}

function parseStructuredItem(item) {
  const segments = String(item)
    .split(/\s+\|\s+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const row = {};

  if (segments.length > 1) {
    segments.forEach((segment) => {
      const pair = splitKeyValue(segment);
      if (pair) row[pair.key] = pair.value;
    });

    return Object.keys(row).length >= 2 ? row : null;
  }

  const pair = splitKeyValue(item);
  return pair ? { 항목: pair.key, 내용: pair.value } : null;
}

function splitKeyValue(text) {
  const match = String(text).match(/^([^:：]{1,24})[:：]\s*(.+)$/u);
  if (!match) return null;

  return {
    key: match[1].trim(),
    value: match[2].trim(),
  };
}

function createSummaryTable(structuredRows) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  const headRow = document.createElement('tr');
  const columns = structuredRows[0].columns;

  table.className = 'summary-table';

  columns.forEach((column) => {
    const cell = document.createElement('th');
    cell.textContent = column;
    headRow.append(cell);
  });

  structuredRows.forEach(({ row }) => {
    const tableRow = document.createElement('tr');

    columns.forEach((column) => {
      const cell = document.createElement('td');
      cell.textContent = row[column] || '-';
      tableRow.append(cell);
    });

    tbody.append(tableRow);
  });

  thead.append(headRow);
  table.append(thead, tbody);
  return table;
}

function getSummarySections(summary = {}) {
  if (Array.isArray(summary.sections) && summary.sections.length > 0) {
    return summary.sections
      .map((section) => ({
        title: String(section?.title || '').trim(),
        items: normalizeSummaryItems(section?.items),
        type: section?.type === 'paragraph' ? 'paragraph' : 'list',
      }))
      .filter((section) => section.title && section.items.length > 0);
  }

  return [
    { title: '회의 요약', items: [summary.overview || '요약 없음'], type: 'paragraph' },
    { title: '회의 주요내용', items: normalizeSummaryItems(summary.keyPoints), type: 'list' },
    { title: '액션 아이템', items: normalizeSummaryItems(summary.actionItems), type: 'list' },
  ];
}

function normalizeSummaryItems(items) {
  if (Array.isArray(items)) return items.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof items === 'string' && items.trim()) return [items.trim()];
  return [];
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
      sections: getRenderedSummarySections(),
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
  elements.summarySections.replaceChildren();
  const wrapper = document.createElement('section');
  const title = document.createElement('h3');
  const paragraph = document.createElement('p');

  wrapper.className = 'summary-section';
  title.textContent = '회의 요약';
  paragraph.id = 'summaryOverview';
  paragraph.className = 'summary-overview guidance-text';
  paragraph.textContent = '회의 종료 후 요약이 표시됩니다.';
  wrapper.append(title, paragraph);
  elements.summarySections.append(wrapper);
}

function getRenderedSummarySections() {
  return [...elements.summarySections.querySelectorAll('.summary-section')]
    .map((section) => {
      const title = section.querySelector('h3')?.textContent?.trim() || '';
      const paragraph = section.querySelector('p')?.textContent?.trim();
      const listItems = [...section.querySelectorAll('li')]
        .map((item) => item.textContent?.trim())
        .filter((text) => text && !text.includes('표시됩니다') && !text.includes('없습니다'));

      return {
        title,
        items: paragraph && !paragraph.includes('표시됩니다') ? [paragraph] : listItems,
        type: paragraph ? 'paragraph' : 'list',
      };
    })
    .filter((section) => section.title && section.items.length > 0);
}

function shortenError(message) {
  if (!message) return '';

  try {
    const parsed = JSON.parse(message);
    return String(parsed.error?.message || parsed.error || message).slice(0, 90);
  } catch {
    return String(message).slice(0, 90);
  }
}

function extensionForMimeType(mimeType) {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
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
