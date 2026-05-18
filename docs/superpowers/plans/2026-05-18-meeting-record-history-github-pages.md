# Meeting Record History and GitHub Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add meeting metadata entry, saved meeting history lookup, and GitHub Pages deployment support.

**Architecture:** A new `src/meetingStore.js` module stores normalized meeting records in `localStorage`. The existing static UI gains metadata fields and a history panel, and GitHub Pages serves the static files from the repository root.

**Tech Stack:** HTML, CSS, JavaScript modules, Web Speech API, `localStorage`, Node built-in test runner, GitHub Pages.

---

### Task 1: Meeting Record Storage

**Files:**
- Create: `src/meetingStore.js`
- Create: `test/meetingStore.test.js`

- [ ] Write tests for saving records, newest-first listing, selected record lookup, and invalid storage fallback.
- [ ] Run `npm test` and verify tests fail because `src/meetingStore.js` does not exist.
- [ ] Implement `createMeetingStore(storage)`.
- [ ] Run `npm test` and verify all tests pass.

### Task 2: Metadata and History UI

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `src/styles.css`

- [ ] Add meeting date/time, attendees, and notes inputs.
- [ ] Save the completed meeting record after `endMeeting()` generates the summary.
- [ ] Render saved meeting records in a history list.
- [ ] Restore a selected record into the detail view.
- [ ] Keep existing start, pause, end, transcript, summary, copy, and reset behavior.

### Task 3: GitHub Pages Support

**Files:**
- Create: `.nojekyll`
- Modify: `README.md`

- [ ] Add `.nojekyll` so GitHub Pages serves static assets as-is.
- [ ] Document GitHub Pages publishing from the repository root.
- [ ] Initialize Git repository if needed.
- [ ] If GitHub authentication and network access are available, create or push to a GitHub repository and enable Pages.

### Task 4: Verification

**Files:**
- Inspect all changed files.

- [ ] Run `npm test`.
- [ ] Run `node --check src/app.js`, `node --check src/summary.js`, `node --check src/meetingStore.js`, and `node --check server.js`.
- [ ] Start the local server and verify `http://localhost:4173` returns HTTP 200.
- [ ] Audit every requested deliverable against file contents and command output.
