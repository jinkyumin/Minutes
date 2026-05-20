# Meeting Notes 개발산출물

## 1. 문서 개요

- 프로젝트명: Meeting Notes
- 목적: 회의 내용을 브라우저에서 전사하고, LLM으로 회의 결과를 요약하며, 회의록을 저장/조회/삭제하고 Notion으로 전송하는 웹앱 구축
- 작성일: 2026-05-20
- 저장소: `https://github.com/jinkyumin/Minutes.git`
- 배포 방식: GitHub `main` 브랜치 push 시 Vercel 자동 배포

## 2. 시스템 개요

Meeting Notes는 Vite 기반 프론트엔드와 Vercel Serverless Function API로 구성된 회의록 작성 웹앱이다.

사용자는 회의 제목, 회의 일시, 참석자, Note를 입력하고 회의를 시작한다. 브라우저 내장 STT가 실시간 전사를 수행하며, 회의 종료 시 전사 내용과 Note를 기반으로 LLM 요약을 생성한다. 생성된 회의록은 Supabase에 저장하고, 사용자가 선택하면 Notion 데이터베이스로 전송할 수 있다.

## 3. 주요 기능

### 3.1 회의 준비

- 회의록 제목 직접 입력
- 회의 일시 입력
- 참석자 입력
- Note 입력
- 안내 문구는 실제 입력값과 구분되도록 흐린 색상과 가는 글꼴로 표시

### 3.2 실시간 전사

- Chrome/Edge 브라우저 내장 `SpeechRecognition` 또는 `webkitSpeechRecognition` 사용
- 언어: `ko-KR`
- 회의 시작, 일시정지, 다시 시작, 회의 종료 제어
- 전사 문장 자동 추가
- 실시간 전사 목록 자동 스크롤
- 사용자가 Note에 직접 텍스트를 붙여넣어 요약에 반영 가능
- STT 인식 품질 향상을 위해 주요 용어 보정 적용
  - SAP
  - S/4HANA
  - DDA
  - BTP
  - FI
  - CO
  - TR
  - ERP
  - PI

### 3.3 회의 결과 요약

- 회의 종료 시 전사 내용과 Note를 LLM API로 전송하여 요약 생성
- 요약 결과 항목
  - 요약
  - 핵심 내용
  - 할 일
- 전사 내용과 Note가 모두 비어 있으면 요약 생성 및 회의록 저장을 수행하지 않음
- LLM 호출 실패 시 로컬 규칙 기반 요약으로 fallback
- 기본 안내 문구는 흐리고 가는 글꼴로 표시하며, 실제 요약 결과는 정상 가독성으로 표시

### 3.4 회의록 목록

- 저장된 회의록 목록 조회
- 회의 일시와 회의록 제목 표시
- 회의록 선택 시 작성 화면과 결과 화면에 상세 내용 표시
- `...` 메뉴를 통한 회의록 삭제
- 회의록 건수 표시는 제거
- PC 화면에서는 왼쪽 목록 패널 접기/열기 지원
- 모바일 화면에서는 목록이 위쪽으로 접히고 가로형 `열기` 버튼으로 표시

### 3.5 회의록 복사

- 현재 회의록을 Markdown 형식으로 클립보드에 복사
- 포함 내용
  - 회의 제목
  - 회의 일시
  - 참석자
  - Note
  - 요약
  - 핵심 내용
  - 할 일
  - 전사

### 3.6 Notion 전송

- Notion 설정 팝업 제공
- 브라우저에는 Notion Database ID만 저장
- Notion Token은 Vercel 환경변수로 관리
- 연결 테스트 기능 제공
- 회의록을 Notion 데이터베이스에 페이지로 생성

### 3.7 원격 저장소 연동

- Supabase를 사용하여 회의록을 로컬 브라우저가 아닌 원격 DB에 저장
- Supabase API 호출 실패 시 기존 `localStorage` 기반 저장소로 fallback
- 저장, 조회, 삭제 API 제공

## 4. 화면 구성

### 4.1 상단 헤더

- 타이틀: `Meeting Notes`
- 현재 단계 표시
- 회의 상태 표시
- 진행 시간 표시
- 어두운 헤더 배경과 흰색 텍스트 적용
- 상태 배지는 배경과 구분되도록 밝은 반투명 톤 적용

### 4.2 본문 레이아웃

PC 화면은 3개 섹션으로 구성한다.

- 회의록 목록
- 회의 준비
- 회의 결과

각 섹션은 동일한 높이로 맞추고, 섹션 제목 영역은 어두운 배경과 흰색 텍스트로 통일했다.

모바일 화면에서는 1열 레이아웃으로 전환되며, 회의록 목록 접기 상태는 상단 가로 버튼으로 표시된다.

## 5. 기술 구성

### 5.1 프론트엔드

- Vite
- Vanilla JavaScript
- CSS
- Web Speech API

### 5.2 API

Vercel Serverless Function으로 API를 구성한다.

- `api/summarize.js`: LLM 요약 API
- `api/notion.js`: Notion 전송 API
- `api/meetings.js`: Supabase 회의록 저장/조회/삭제 API

### 5.3 저장소

- 1차 저장소: Supabase `meeting_records` 테이블
- fallback 저장소: 브라우저 `localStorage`

### 5.4 외부 서비스

- Gemini API 또는 OpenAI API
- Notion API
- Supabase
- Vercel
- GitHub

## 6. 주요 파일 구조

```text
api/
  summarize.js              LLM 요약 API
  notion.js                 Notion 전송 API
  meetings.js               Supabase 회의록 API
src/
  app.js                    화면 이벤트, 회의 진행, 요약/저장 흐름
  styles.css                화면 스타일
  summary.js                로컬 요약 fallback
  transcriptProcessing.js   전사 문장 정리 및 용어 보정
  meetingContent.js         요약 가능 콘텐츠 존재 여부 판단
  meetingPayload.js         요약/복사용 회의록 payload 생성
  meetingStore.js           localStorage 저장소
  remoteMeetingStore.js     Supabase API 저장소 및 fallback 처리
test/
  *.test.js                 단위 테스트
server.js                   로컬 개발 서버
index.html                  앱 HTML
```

## 7. 환경변수

Vercel Project Settings의 Environment Variables에 아래 값을 설정한다.

### 7.1 LLM

Gemini 사용 시:

```text
LLM_PROVIDER=gemini
GEMINI_API_KEY=<Google AI Studio에서 발급한 Gemini API Key>
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODEL=gemini-2.5-flash-lite
```

OpenAI 사용 시:

```text
OPENAI_API_KEY=<OpenAI API Key>
OPENAI_MODEL=gpt-5.2-chat-latest
```

`OPENAI_MODEL`을 비우거나 `chat-latest`로 설정하면 내부적으로 `gpt-5.2-chat-latest`를 사용한다.

### 7.2 Notion

```text
NOTION_TOKEN=<Notion Integration Secret>
NOTION_DATABASE_ID=<기본 Notion Database ID, 선택값>
```

앱 화면의 Notion 설정 팝업에는 Database ID만 저장한다.

### 7.3 Supabase

```text
SUPABASE_URL=<Supabase Project URL>
SUPABASE_SERVICE_ROLE_KEY=<Supabase Secret Key>
```

`SUPABASE_SERVICE_ROLE_KEY`는 브라우저에 노출되면 안 되며, Vercel 서버 환경변수로만 관리한다.

## 8. Supabase 테이블

테이블명: `meeting_records`

권장 컬럼:

```text
id                  uuid 또는 text, primary key, 기본값 uuid 생성 권장
title               text
meeting_date_time   text
attendees           text
note                text
transcript_entries  jsonb
summary             jsonb
saved_at            timestamptz, 기본값 now()
created_at          timestamptz, 기본값 now()
```

현재 API는 `meeting_records` 테이블에 REST API로 접근하며, `saved_at.desc` 기준으로 최신 회의록을 먼저 조회한다.

## 9. 주요 처리 흐름

### 9.1 회의 시작

1. 전사 목록과 임시 전사 초기화
2. 회의 상태를 진행 중으로 변경
3. 브라우저 STT 시작
4. 진행 시간 타이머 시작

### 9.2 회의 종료

1. STT 중지
2. 임시 전사 문장을 확정 전사에 반영
3. 전사 내용과 Note 존재 여부 확인
4. 내용이 없으면 요약과 저장을 건너뜀
5. 내용이 있으면 LLM 요약 API 호출
6. 실패 시 로컬 요약 fallback
7. 회의록 저장
8. 회의록 목록 갱신

### 9.3 회의록 저장

1. 프론트엔드에서 `/api/meetings`로 저장 요청
2. Supabase `meeting_records`에 저장
3. Supabase API 실패 시 localStorage에 저장

### 9.4 Notion 전송

1. 사용자가 Notion 설정에서 Database ID 저장
2. `Notion으로 보내기` 클릭
3. `/api/notion`으로 회의록 전송
4. Notion API로 데이터베이스 페이지 생성

## 10. 예외 처리

- 브라우저가 Web Speech API를 지원하지 않으면 회의 시작 버튼 비활성화
- LLM API 실패 시 로컬 요약 사용
- Gemini 503 오류 발생 시 fallback 모델 재시도
- Gemini JSON 파싱 실패 시 완화 파서로 복구 시도
- Supabase API 실패 시 localStorage fallback
- 전사 내용과 Note가 모두 비어 있으면 요약/저장 미수행
- Notion Token 미설정 시 Notion API 오류 반환

## 11. 테스트

실행 명령:

```bash
npm test
```

현재 테스트 범위:

- 로컬 요약
- 전사 문장 정리 및 용어 보정
- 요약 가능 콘텐츠 판단
- localStorage 저장소
- 원격 저장소 fallback
- Vercel 빌드 설정
- 회의록 payload 생성
- LLM API 핸들러
- Notion API 핸들러
- Supabase 회의록 API 핸들러

최근 확인 결과:

```text
33 tests passed
```

## 12. 빌드 및 배포

### 12.1 로컬 실행

```bash
npm run dev
```

기본 접속 주소:

```text
http://localhost:4173
```

### 12.2 프로덕션 빌드

```bash
npm run build
```

### 12.3 배포

GitHub 원격 저장소:

```text
https://github.com/jinkyumin/Minutes.git
```

배포 절차:

```bash
git add .
git commit -m "<commit message>"
git push origin main
```

Vercel 프로젝트가 GitHub `main` 브랜치와 연결되어 있으므로 push 후 자동 배포된다.

## 13. GitHub CLI 연결 상태

- GitHub CLI 설치 확인 완료
- GitHub 계정 `jinkyumin` 인증 완료
- Git 원격 저장소 `origin` 연결 완료
- `main` 브랜치 push 가능

## 14. 현재 완료된 개선 사항

- Vercel 배포 설정
- 도메인 변경 및 배포 확인
- UI 단순화 및 3영역 레이아웃 개선
- 회의록 목록 좌측 배치
- 회의록 목록 숨기기/열기
- 모바일 목록 접힘 방식 개선
- 회의록 삭제 기능
- 회의록 제목 직접 입력
- Note 자동 요약 반영
- LLM 요약 연동
- Gemini API 지원
- Gemini JSON 오류 복구
- 빈 회의 종료 시 요약/저장 방지
- Notion 전송 기능
- Notion 설정 팝업
- Supabase 원격 저장
- 안내 문구 시각 스타일 개선
- 상단 헤더 및 섹션 타이틀 디자인 개선

## 15. 향후 개선 후보

- 유료 또는 서버 기반 STT API 도입
- 사용자 로그인 기반 회의록 소유자 분리
- Supabase RLS 정책 정교화
- Notion 전송 결과 링크 표시
- 회의록 검색 기능
- 회의록 태그/분류 기능
- 긴 회의 전사에 대한 chunk 기반 요약
- 요약 품질 비교 및 프롬프트 개선
- 배포 상태를 앱 내부에서 확인하는 기능
