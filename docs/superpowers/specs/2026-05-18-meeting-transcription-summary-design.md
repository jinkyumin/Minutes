# Meeting Transcription Summary Design

## Goal

Build a browser web app that transcribes meeting speech and creates a summary when the meeting ends.

## Scope

- Use the browser Web Speech API for live Korean transcription.
- Provide meeting start, pause, resume, end, copy, and reset controls.
- Show live interim text and confirmed transcript entries in time order.
- Generate a local rule-based summary at meeting end.
- Run without API keys, backend services, or external dependencies.

## Architecture

The app is a static browser application. `index.html` defines the interface, `src/app.js` wires UI state to the Web Speech API, `src/summary.js` contains testable summary logic, and `src/styles.css` handles presentation.

The summary module is intentionally independent from the DOM so it can be verified with Node's built-in test runner.

## Limitations

- Speech recognition depends on Chrome or Edge support for `SpeechRecognition` or `webkitSpeechRecognition`.
- The summary is local and rule-based, not AI-generated.
- Microphone access requires a secure context or localhost in supported browsers.
