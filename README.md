# 회의 음성 전사 및 요약 웹앱

브라우저 내장 음성 인식으로 회의 내용을 실시간 전사하고, 회의 종료 시 로컬 규칙 기반 요약을 생성하는 정적 웹앱입니다.

## 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:4173`을 열고 마이크 권한을 허용합니다.

## 테스트

```bash
npm test
```

## 참고

- Chrome 또는 Edge의 `SpeechRecognition`/`webkitSpeechRecognition` 지원이 필요합니다.
- 요약은 외부 AI API 없이 브라우저에서 처리됩니다.
- 회의록 일시, 참석자, 비고, 전사, 요약은 브라우저 `localStorage`에 저장됩니다.
- GitHub Pages 배포 워크플로는 `.github/workflows/pages.yml`에 포함되어 있습니다. GitHub 저장소의 Pages 설정에서 Source를 `GitHub Actions`로 지정하면 `main` 브랜치 푸시 시 배포됩니다.
