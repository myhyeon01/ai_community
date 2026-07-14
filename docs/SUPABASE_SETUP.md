# Supabase 연결 설정

## 테이블과 RLS

`supabase/migrations`의 SQL을 파일명 순서대로 적용한다. Supabase CLI를 사용하면 `npm exec --yes supabase@latest -- db push` 한 번으로 적용된다.

주요 테이블은 `profiles`, `timetables`, `personal_schedules`, `timetable_collections`, `user_app_state`, `school_events`, `school_event_favorites`, `kmu_edge_cache`다. 사용자 데이터는 RLS로 본인 행만 접근한다.

## 학번 로그인

Authentication → Providers → Email을 활성화한다. 앱은 학번을 `${학번}@kmu.local` 내부 식별자로 변환한다. 개발 중 실제 이메일 확인을 사용하지 않으면 Confirm email을 끈다.

## React 환경변수

`web/.env.example`을 `web/.env`로 복사한다.

```env
VITE_SUPABASE_URL=https://프로젝트참조.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

`VITE_API_URL`은 필요하지 않다. `service_role`, OpenAI 키, Story+ 쿠키를 `VITE_` 변수로 넣으면 안 된다.

Edge Function 배포와 비밀값 설정은 `SUPABASE_EDGE_MIGRATION.md`를 따른다.
