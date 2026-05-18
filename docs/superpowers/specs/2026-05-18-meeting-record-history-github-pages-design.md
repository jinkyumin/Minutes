# Meeting Record History and GitHub Pages Design

## Goal

Improve the meeting minutes app so users can enter meeting date/time, attendees, and notes, save finished meeting minutes, browse previously saved minutes, and publish the static app through GitHub Pages.

## Scope

- Add editable meeting metadata fields: meeting date/time, attendees, and notes.
- Save a completed meeting record when the meeting ends.
- Store meeting records in browser `localStorage`.
- Show a previous meeting list with date/time, attendees, and summary preview.
- Let users select a previous meeting and restore its metadata, transcript, and summary into the current view.
- Add GitHub Pages deployment configuration for the static app.

## Architecture

`src/meetingStore.js` owns record normalization and `localStorage` persistence. `src/app.js` reads and writes metadata fields, saves a record at meeting end, renders the history list, and restores a selected record.

The app remains static HTML/CSS/JavaScript, so GitHub Pages can host it directly from the repository root without a build step.

## Decisions

- Records are local to each browser because the app has no backend database.
- Meeting date/time defaults to the current local date/time when the app loads or resets.
- Attendees are stored as a single comma- or newline-separated text field to keep the UI simple.
- Notes are free-form text.
