# Meeting UI, ChatGPT Summary, and Notion Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved simplified meeting UI, ChatGPT-backed summary, Note input, and Notion export.

**Architecture:** Keep the browser app small and use serverless API routes for secret-backed integrations. Move request formatting and fallback helpers into testable modules so UI code mostly coordinates state and rendering.

**Tech Stack:** Vite static frontend, Vercel serverless Node functions, OpenAI Responses API, Notion REST API, Node test runner.

---

### Task 1: Testable Data Helpers

**Files:**
- Create: `src/meetingPayload.js`
- Modify: `src/meetingStore.js`
- Test: `test/meetingPayload.test.js`
- Test: `test/meetingStore.test.js`

- [ ] Add `buildSummaryPayload(record)` that returns date/time, attendees, note, and transcript text.
- [ ] Add `formatMeetingMarkdown(record)` for copy and Notion content.
- [ ] Normalize `note` in saved records while keeping old `notes` records readable.
- [ ] Verify with `npm test`.

### Task 2: ChatGPT Summary API

**Files:**
- Create: `api/summarize.js`
- Create: `test/apiHandlers.test.js`
- Modify: `test/run-tests.js`

- [ ] Add a serverless handler accepting only POST JSON.
- [ ] Validate transcript and note content.
- [ ] Call OpenAI Responses API with model `process.env.OPENAI_MODEL || 'chat-latest'`.
- [ ] Return `{ overview, keyPoints, actionItems }`.
- [ ] Verify success and missing-key behavior with mocked `fetch`.

### Task 3: Notion Export API

**Files:**
- Create: `api/notion.js`
- Modify: `test/apiHandlers.test.js`

- [ ] Add a serverless handler accepting only POST JSON.
- [ ] Use `process.env.NOTION_TOKEN`.
- [ ] Use payload `databaseId` first, then `process.env.NOTION_DATABASE_ID`.
- [ ] Create a Notion page with title, date, attendees, overview, key points, action items, note, and transcript.
- [ ] Verify request shape with mocked `fetch`.

### Task 4: Simplified App UI

**Files:**
- Replace: `index.html`
- Replace: `src/styles.css`
- Replace: `src/app.js`

- [ ] Remove old tab-first layout and `비고`.
- [ ] Add equal `회의 준비` and `회의 결과` panels.
- [ ] Add compact stage/status header.
- [ ] Add scrollable transcript area.
- [ ] Add `Note` textarea that is included automatically.
- [ ] Keep recent record click-to-detail behavior.
- [ ] Add Notion settings modal and export button.

### Task 5: Verification

**Files:**
- No new files.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run local preview and inspect the main screen.
- [ ] Report required Vercel environment variables.
