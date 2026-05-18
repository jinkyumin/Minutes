# Meeting Transcription Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dependency-free browser app that transcribes meeting audio and summarizes it at meeting end.

**Architecture:** A static HTML/CSS/JavaScript app uses the browser Web Speech API for transcription. Summary logic lives in a separate module with Node tests.

**Tech Stack:** HTML, CSS, JavaScript modules, Web Speech API, Node built-in test runner.

---

### Task 1: Summary Logic

**Files:**
- Create: `src/summary.js`
- Create: `test/summary.test.js`

- [ ] Write tests for empty transcripts, keyword extraction, action item detection, and summary fallback.
- [ ] Run `npm test` and verify the tests fail because `src/summary.js` does not exist.
- [ ] Implement `summarizeMeeting(entries)`.
- [ ] Run `npm test` and verify all tests pass.

### Task 2: Browser App

**Files:**
- Create: `index.html`
- Create: `src/app.js`
- Create: `src/styles.css`
- Create: `package.json`
- Create: `README.md`

- [ ] Create the app shell with controls, live transcript, transcript list, and summary panel.
- [ ] Wire `SpeechRecognition` lifecycle to start, pause, resume, and end controls.
- [ ] Call `summarizeMeeting` when the meeting ends.
- [ ] Add copy and reset actions.
- [ ] Add a small dependency-free local server script via `npm run dev`.

### Task 3: Verification

**Files:**
- Inspect all created files.

- [ ] Run `npm test`.
- [ ] Run `npm run dev` long enough to confirm the server starts.
- [ ] Audit the objective against the actual files and command output.
