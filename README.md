# KMU Smart Scheduler

계명대학교 학생용 스마트 시간표·일정 관리 웹이다. React 클라이언트, Supabase Auth/Postgres, Supabase Edge Functions로 구성된다. 별도의 FastAPI·MySQL·로컬 백엔드 서버는 필요하지 않다.

## 구성

```text
web/src/                         React 웹
supabase/migrations/             Postgres 스키마·RLS
supabase/functions/kmu-api/      학사일정·공지·행사 크롤링과 AI Edge API
docs/                            설정 및 운영 문서
```

## 로컬 실행

1. `web/.env.example`을 `web/.env`로 복사한다.
2. Supabase Dashboard의 Project Settings → API에 있는 URL과 publishable key를 입력한다.
3. 웹을 실행한다.

```powershell
cd C:\Users\plask\Desktop\TimeTable\web
npm install
npm run dev
```

웹은 `VITE_SUPABASE_URL/functions/v1/kmu-api/api/v1`을 자동으로 사용한다. `uvicorn`이나 MySQL을 실행하지 않는다.

## Supabase 최초 배포

상세 절차는 [docs/SUPABASE_EDGE_MIGRATION.md](docs/SUPABASE_EDGE_MIGRATION.md)를 따른다. 요약하면 다음과 같다.

```powershell
npm exec --yes supabase@latest -- login
npm exec --yes supabase@latest -- link --project-ref PROJECT_REF
npm exec --yes supabase@latest -- db push
npm exec --yes supabase@latest -- secrets set --env-file supabase/functions/.env
npm exec --yes supabase@latest -- functions deploy kmu-api --no-verify-jwt --use-api
```

`OPENAI_API_KEY`, Story+ 쿠키 같은 비밀값은 브라우저 `.env`가 아니라 Supabase Edge Function Secrets에만 저장한다. Edge Function은 요청의 Supabase 사용자 토큰을 직접 검증한다.

## 데이터와 외부 연동

- Auth: 학번을 내부 `${학번}@kmu.local` 이메일로 변환하여 Supabase Auth 사용
- DB: 프로필, 학기별 시간표, 개인 일정, 사용자 앱 상태, 날짜별 AI 추천 일정, 학교 행사와 즐겨찾기
- Edge API: 학사일정, 학교 공지, 학교 행사·Story+, OpenAI 일정 추천과 챗봇
- 캐시: 외부 학교 페이지 응답을 Postgres `kmu_edge_cache`에 저장
- 에브리타임: 비공식 API/로그인 자동화 없이 이미지 OCR 및 허용된 파일 가져오기만 사용

## 검증

```powershell
cd web
npm run build
```

배포 후 로그인한 상태에서 학사일정, 학교 공지, 학교 행사, AI 일정 추천과 챗봇을 각각 확인한다.
