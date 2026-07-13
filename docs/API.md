# REST API

실행 후 `/docs`에서 Swagger UI, `/openapi.json`에서 기계 판독 가능한 전체 명세를 확인한다. 모든 보호 API는 `Authorization: Bearer <JWT>`를 요구한다.

| Method | Path | 설명 |
|---|---|---|
| POST | `/api/v1/auth/register` | 학번·학과·이름·비밀번호·학년 회원가입 |
| POST | `/api/v1/auth/login` | 학번 로그인 |
| GET | `/api/v1/auth/me` | 내 프로필 |
| GET/POST | `/api/v1/courses` | 시간표 조회/등록 |
| DELETE | `/api/v1/courses/{id}` | 과목 삭제 |
| POST | `/api/v1/imports/everytime/csv` | 공식 CSV 내보내기 가져오기 |
| POST | `/api/v1/imports/everytime/ics` | 공식 ICS 내보내기 가져오기 |
| POST | `/api/v1/imports/ocr/preview` | ML Kit 추출 블록 검증 |
| GET | `/api/v1/calendar/today?target=YYYY-MM-DD` | 보강 규칙 반영 실제 시간표 |
| GET | `/api/v1/calendar/range` | 기간 일정 |
| POST | `/api/v1/schedules` | 개인/과제/시험 일정 생성 |
| GET | `/api/v1/academic-events` | 학사 일정 |
| GET | `/api/v1/ai/today` | 오늘 AI 추천 |

