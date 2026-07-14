# Vercel 배포 직전 체크리스트

저장소 루트를 Vercel 프로젝트로 Import한다. 루트의 `vercel.json`이 `web` 설치·빌드와 SPA 라우팅을 처리한다.

## 현재 준비 상태

- Supabase 프로젝트 연결 및 DB 마이그레이션 적용 완료
- `kmu-api` Edge Function 배포 완료
- React 프로덕션 빌드 확인 완료
- FastAPI·MySQL·로컬 API 서버 의존성 제거 완료
- 학사일정·학교 공지·KMU 공식 행사 크롤링과 DB 캐시 확인 완료

OpenAI 기능은 유효한 `OPENAI_API_KEY`를 Supabase Secrets에 등록하면 활성화된다. 키가 없거나 API 호출이 실패해도 기존 규칙 기반 일정 추천은 유지된다. Story+ 비교과 프로그램은 해당 사이트의 로그인 세션이 필요한 경우에만 `STORY_SESSION_COOKIE`를 추가하며, 쿠키가 없어도 KMU 공식 행사 목록은 계속 제공된다.

## Vercel 환경변수

Project Settings → Environment Variables에 Production, Preview, Development 공통으로 등록한다.

```env
VITE_SUPABASE_URL=https://fhzyzxsnlpkbaieceqww.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=Supabase Project Settings의 publishable key
```

다음 값은 Vercel에 넣지 않는다.

- `OPENAI_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRAWLER_SYNC_SECRET`
- `STORY_SESSION_COOKIE`

이 값들은 Supabase Edge Function Secrets에만 둔다.

필요한 비밀값을 추가하거나 교체할 때는 저장소 루트에서 다음 명령을 사용한다.

```powershell
npm exec --yes supabase@latest -- secrets set OPENAI_API_KEY=실제_키
npm exec --yes supabase@latest -- secrets set STORY_SESSION_COOKIE="실제_쿠키"
```

비밀값을 변경한 뒤에는 Edge Function 코드를 다시 배포할 필요가 없다.

## Supabase Auth URL

배포 URL이 정해지면 Supabase Dashboard → Authentication → URL Configuration에서 다음을 갱신한다.

- Site URL: `https://배포도메인.vercel.app`
- Redirect URLs: `https://배포도메인.vercel.app/**`

현재 로그인은 학번을 내부 이메일로 변환하며 브라우저에서 Supabase Auth로 직접 처리한다.

## 최종 확인

```powershell
npm --prefix web ci
npm --prefix web run build
```

배포 후 로그인하여 시간표, 오늘 수업, 학사일정, 학교 공지, 학교 행사, 개인 일정, AI 일정, 챗봇을 확인한다. Network 요청은 모두 `*.supabase.co`로 향해야 하며 `127.0.0.1:8000/8010` 요청이 없어야 한다.
