# FastAPI → Supabase Edge Functions 이전

## 1. CLI 로그인과 프로젝트 연결

```powershell
cd C:\Users\plask\Desktop\TimeTable
npm exec --yes supabase@latest -- login
npm exec --yes supabase@latest -- link --project-ref PROJECT_REF
```

`PROJECT_REF`는 Dashboard URL의 `/project/` 뒤 문자열이다.

## 2. 데이터베이스 적용

```powershell
npm exec --yes supabase@latest -- db push
```

마지막 마이그레이션은 Edge 캐시, 학교 행사, 행사 즐겨찾기 및 RLS를 만든다. 기존 프로필·시간표·개인일정·앱 상태 테이블은 유지된다.

## 3. 서버 비밀값 설정

`supabase/functions/.env.example`을 `supabase/functions/.env`로 복사하고 실제 값을 입력한다. 이 파일은 커밋하지 않는다.

```powershell
npm exec --yes supabase@latest -- secrets set --env-file supabase/functions/.env
```

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 배포된 Edge Function에 자동 제공되므로 직접 넣지 않는다. Story+가 로그인 페이지로 돌려보낼 때만 `STORY_SESSION_COOKIE`를 사용한다.

## 4. Edge Function 배포

```powershell
npm exec --yes supabase@latest -- functions deploy kmu-api --no-verify-jwt --use-api
```

함수의 `verify_jwt`는 꺼져 있지만 공개 접근은 허용되지 않는다. 함수 내부가 `Authorization: Bearer <Supabase access token>`을 `auth.getUser()`로 다시 검증한다. 이 구성은 publishable key와 사용자 JWT를 함께 쓰는 브라우저 요청을 지원한다.

## 5. 확인

웹 로그인 후 다음 화면을 한 번씩 연다.

- 학사일정: 학교 원본 HTML 파싱 및 DB 캐시
- 학교 공지: 목록, 상세, 새로고침, AI 요약
- 학교 행사: KMU/Story+ 동기화, 9개 페이지네이션, 즐겨찾기, 추천
- AI 일정 추천·챗봇: OpenAI 또는 규칙 기반 폴백

브라우저 Network 탭의 요청 주소가 아래 형식이면 이전이 완료된 것이다.

```text
https://PROJECT_REF.supabase.co/functions/v1/kmu-api/api/v1/...
```

더 이상 `127.0.0.1:8000`이나 `127.0.0.1:8010`에 연결하지 않는다.

## 장애 방지 원칙

- 외부 크롤링 결과는 `kmu_edge_cache`와 `school_events`에 보존한다.
- OpenAI 장애나 키 미설정 시 기존 규칙 기반 일정이 유지된다.
- Story+ 로그인 쿠키가 없으면 KMU 공식 행사 데이터는 계속 제공되고 Story+ 응답에 `requires_auth`가 표시된다.
- 프론트의 API 계약은 기존 `/api/v1` 경로와 응답 형태를 유지한다.
- AI 추천 결과는 `ai_recommended_schedules`에 사용자·날짜별로 저장되어 같은 계정의 다른 기기에서도 동기화된다.
- 학교 행사는 일반·교외알림판·모집·취업 게시판을 `pageNo` 기준으로 수집하고, 목록은 최대 200건까지 동기화한다.
