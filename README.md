# KMU Smart Scheduler

계명대학교 학생용 스마트 시간표·일정 관리 모노레포다. FastAPI + MySQL 백엔드와 React 웹 및 Flutter 클라이언트로 구성되며, 핵심인 대체 요일 시간표를 서버에서 일관되게 계산한다.

## 구성

```text
backend/app/
  api.py                 REST 컨트롤러
  models.py, schemas.py  DB/전송 모델
  repositories.py       데이터 접근 계층
  services/              인증, 캘린더, AI, OCR, import, crawler
frontend/lib/
  core/                  API/인증 상태
  features/              auth, home, calendar, timetable
web/src/                 React 반응형 웹 애플리케이션
docs/                    ERD와 API 명세
```

## 빠른 실행

1. `.env.example`을 `.env`로 복사하고 `JWT_SECRET`을 변경한다.
2. `docker compose up --build`를 실행한다.
3. React 웹은 `http://localhost:5173`, API는 `http://localhost:8000`, Swagger는 `http://localhost:8000/docs`에서 열린다.

## React 웹만 개발 실행

백엔드를 먼저 실행한 상태에서 다음 명령을 사용한다.

```powershell
cd C:\Users\plask\Desktop\TimeTable\web
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`을 연다. 다른 API 주소를 사용할 때는 `web/.env.example`을 `web/.env`로 복사한 뒤 `VITE_API_URL`을 변경한다. 배포용 빌드는 `npm run build`이며 결과는 `web/dist`에 생성된다.

Supabase Auth와 테이블 최초 설정은 `docs/SUPABASE_SETUP.md`를 따른다. `supabase/migrations`의 SQL을 파일명 순서대로 실행하면 프로필, 개인 일정, 학년도·학기별 시간표가 구성된다.

Flutter 앱은 선택적으로 유지되어 있다. 필요하면 Flutter SDK에서 `cd frontend && flutter pub get && flutter run --dart-define=API_URL=http://10.0.2.2:8000/api/v1`을 실행한다.

로컬에서 MySQL 없이 API만 확인하려면 `cd backend`, 가상환경을 만든 뒤 의존성을 설치하고 `uvicorn app.main:app --reload`를 실행한다. 기본값은 SQLite다.

## 회원가입

필수 정보는 `학번, 학과, 이름, 비밀번호, 학년`이다. 학번은 유일키이며 비밀번호는 bcrypt 해시만 저장한다. 운영 환경에서는 Supabase Auth 또는 현재 JWT 인증 중 하나를 단일 인증 원천으로 선택해야 한다. 현재 실행 코드는 요청된 FastAPI/JWT/MySQL 구성을 따른다.

## 외부 연동 원칙

- 에브리타임 비공식 API, 로그인 자동화, 크롤링은 사용하지 않는다. CSV/ICS 공식 내보내기와 캡처 OCR만 허용한다.
- OCR은 Flutter Google ML Kit에서 온디바이스로 수행하고, 서버에는 사용자가 검토할 구조화 결과만 보낸다.
- 계명대학교 수집기는 HTML 파싱과 도메인 저장 계층을 분리했다. 실제 URL/선택자는 학교 페이지 확인 후 설정하며 robots.txt와 이용 정책을 준수한다.
- OpenAI 키가 없으면 결정론적 기본 추천이 동작한다. 키가 있으면 `AIService`가 Responses API를 사용한다.

## OpenAI 일정 추천 설정

API 키는 브라우저용 `web/.env`에 넣지 않는다. 루트 `.env.example`을 참고해 `backend/.env`에 아래 값을 설정한다.

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1
```

키를 설정한 뒤 백엔드를 재시작하면 AI 일정 추천의 세부 조정, 등하교 시간을 고려한 계획과 AI 일정 코치를 사용할 수 있다. 키가 없거나 API 호출이 실패하면 수업·개인 일정·공부 목표·이동시간을 반영하는 규칙 기반 추천으로 자동 전환된다. API 키는 Git에 커밋하지 않는다.

## 운영 전에 필요한 작업

푸시 알림용 FCM 자격 증명, 비밀번호 재설정 본인확인 채널, 계명대학교 실제 페이지별 파서, 개인정보 처리방침과 크롤링 허가를 설정해야 한다. DB 스키마는 SQLAlchemy가 개발 시 자동 생성하며 운영에서는 Alembic 마이그레이션 도입을 권장한다.

## 테스트

```powershell
cd backend
pytest
```

보강 핵심 테스트는 2026-07-13(월)에 수요일 시간표가 반환되는지를 검증한다.
