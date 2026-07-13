# Supabase 연결 설정

## 1. 테이블 생성

Supabase Dashboard의 **SQL Editor → New query**에서
`supabase/migrations/202607130001_profiles_and_timetables.sql` 파일 전체를 붙여넣고 **Run**을 누른다.

생성되는 항목:

- `profiles`: 이름, 학번, 학과, 학년
- `timetables`: 사용자별 수업 시간표
- 회원가입 프로필 자동 생성 트리거
- 사용자가 본인 행에만 접근하는 RLS 정책

## 2. 학번 로그인 설정

Dashboard의 **Authentication → Providers → Email**에서 Email provider를 활성화한다.
실제 이메일을 받지 않는 학번 로그인 방식이므로 개발 단계에서는 **Confirm email**을 끈다.

앱 내부에서는 `5764124`라는 학번을 `5764124@kmu.local`이라는 Auth 식별자로 변환한다.
사용자 화면이나 `profiles`에는 내부 이메일을 표시하지 않는다.

> 실제 이메일이 없으므로 이메일 기반 비밀번호 찾기는 사용할 수 없다. 추후 관리자 재설정 또는 학교 이메일 추가가 필요하다.

## 3. React 환경변수

`web/.env.example`을 `web/.env`로 복사하고 Supabase Dashboard의 **Project Settings → API** 값을 입력한다.

```env
VITE_API_URL=http://localhost:8000/api/v1
VITE_SUPABASE_URL=https://프로젝트참조.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

브라우저에 넣어도 되는 것은 publishable(또는 기존 anon) 키뿐이다. `service_role` 또는 secret 키는 절대 `VITE_` 환경변수에 넣지 않는다.

## 4. 실행

```powershell
cd C:\Users\plask\Desktop\TimeTable\web
npm install
npm run dev
```

`http://localhost:5173`에서 회원가입 후 Supabase의 Authentication → Users와 Table Editor → profiles에서 생성 결과를 확인한다.
