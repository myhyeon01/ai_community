import React, { useEffect, useMemo, useState } from "react"
import { CalendarDays, Clock3, MapPin, RefreshCw } from "lucide-react"
import { supabase } from "./supabase"
import { getAcademicCalendar } from "./academicApi"
import { academicFallback2026 } from "./academicData"
import { selectCurrentTimetable } from "./activeTimetable"
import { loadUserState } from "./appState"
import { buildTodayView, DAY_NAMES } from "./today"
import "./today.css"

export default function TodayPage() {
  const [data, setData] = useState({ timetable: [], schedules: [], term: null, activeTitle: "", loading: true, error: "", academicError: "" })
  const [now, setNow] = useState(new Date())
  async function load(force = false) {
    setData((value) => ({ ...value, loading: true, error: "", academicError: "" }))
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError || !authData.user) throw authError || new Error("로그인 사용자 정보를 확인할 수 없습니다.")
      const [savedTimetableId, calendarResult, collectionResult] = await Promise.all([
        loadUserState("kmu-active-timetable-id", null),
        getAcademicCalendar(force).then((calendar) => ({ calendar })).catch((error) => ({ error })),
        supabase
        .from("timetable_collections")
        .select("id,year,semester,title,updated_at")
        .eq("user_id", authData.user.id),
      ])
      if (collectionResult.error) throw collectionResult.error
      const schedules = calendarResult.calendar?.schedules?.length
        ? calendarResult.calendar.schedules
        : academicFallback2026
      const selection = selectCurrentTimetable(collectionResult.data || [], schedules, now, Number(savedTimetableId))
      const activeTimetableId = selection.timetable?.id
      const timetable = activeTimetableId
        ? await supabase.from("timetables").select("*").eq("user_id", authData.user.id).eq("timetable_id", activeTimetableId).order("weekday").order("start_time")
        : { data: [], error: null }
      const academicError = calendarResult.error ? "학사일정 정보를 불러오지 못했습니다." : ""
      if (calendarResult.error) console.error("오늘 수업 학사일정 요청 실패", { error: calendarResult.error, academicApi: "Supabase Edge Function /academic-calendar" })
      if (timetable.error) {
        console.error("오늘 수업 시간표 요청 실패", { error: timetable.error, timetableTable: "timetables" })
        setData({ timetable: [], schedules, term: selection.term, activeTitle: selection.timetable?.title || "", loading: false, error: "수업 정보를 불러오지 못했습니다.", academicError })
        return
      }
      const rows = (timetable.data || []).map((row) => ({
        ...row,
        subject: row.subject || row.name || "강의명 없음",
        weekday: Number(row.weekday),
        start_time: String(row.start_time || "").slice(0, 5),
        end_time: String(row.end_time || "").slice(0, 5),
      })).filter((row) => Number.isInteger(row.weekday) && row.weekday >= 0 && row.weekday <= 6 && /^\d{2}:\d{2}$/.test(row.start_time) && /^\d{2}:\d{2}$/.test(row.end_time))
      setData({ timetable: rows, schedules, term: selection.term, activeTitle: selection.timetable?.title || "", loading: false, error: "", academicError })
    } catch (error) {
      console.error("오늘 수업 데이터 요청 실패", { error, academicApi: "Supabase Edge Function /academic-calendar", timetableTable: "timetables" })
      setData((value) => ({ ...value, timetable: [], loading: false, error: "수업 정보를 불러오지 못했습니다.", academicError: "" }))
    }
  }
  useEffect(() => { load() }, [])
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer) }, [])
  const view = useMemo(() => buildTodayView(data.timetable, data.schedules, now), [data.timetable, data.schedules, now])
  const dateLabel = now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" })

  return <div className="today-page">
    <section className="today-hero"><div><p>오늘 수업</p><h1>{dateLabel}</h1><span>{data.term ? `${data.term.year}년 ${data.term.label} · ` : ""}{data.activeTitle || "현재 학기 시간표"}를 반영한 실제 수업입니다.</span></div><button onClick={() => load(true)} disabled={data.loading}><RefreshCw />{data.loading ? "불러오는 중" : "새로고침"}</button></section>
    {data.error && <div className="today-error">{data.error}</div>}
    {data.academicError && <div className="today-error academic-warning">{data.academicError}</div>}
    <section className="today-summary">
      <article><span>적용 요일</span><b>{DAY_NAMES[view.appliedWeekday]}요일</b><small>실제 {DAY_NAMES[view.actualWeekday]}요일</small></article>
      <article><span>다음 수업</span><b>{view.next?.subject || (view.active ? "현재 수업 진행 중" : "오늘 남은 수업 없음")}</b><small>{view.next ? `${view.next.start_time.slice(0, 5)} · ${view.next.classroom || "강의실 미정"}` : "-"}</small></article>
      <article><span>남은 시간</span><b>{view.remaining}</b><small>{view.active ? `${view.active.subject} 진행 중` : view.next ? `${view.next.subject} 시작까지` : "모든 수업 완료"}</small></article>
      <article><span>변경 안내</span><b>{view.notices.length ? `${view.notices.length}건` : "변경 없음"}</b><small>{view.notices[0] || "공식 변경 정보가 없습니다."}</small></article>
    </section>
    {view.notices.length > 0 && <section className="today-notices">{view.notices.map((notice) => <p key={notice}>{notice}</p>)}</section>}
    <section className="today-lessons"><header><div><CalendarDays /><h2>오늘 수업 목록</h2></div><span>{view.lessons.length}개 수업</span></header>
      {data.loading ? <div className="today-empty">수업 정보를 불러오는 중입니다.</div> : data.error ? <div className="today-empty">수업 정보를 불러오지 못했습니다.</div> : !data.timetable.length ? <div className="today-empty">{data.term ? `${data.term.year}년 ${data.term.label} 시간표가 등록되지 않았습니다.` : "등록된 시간표가 없습니다."}</div> : !view.lessons.length ? <div className="today-empty">오늘 예정된 수업이 없습니다.</div> : view.lessons.map((lesson) => <article key={lesson.id} className={lesson.status === "휴강" ? "cancelled" : ""} tabIndex={0} aria-label={`${lesson.subject}, ${lesson.start_time.slice(0, 5)}부터 ${lesson.end_time.slice(0, 5)}, ${lesson.status === "정규" ? lesson.timeStatus : lesson.status}`}>
        <time><b>{lesson.start_time.slice(0, 5)}</b><span>{lesson.end_time.slice(0, 5)}</span></time><i style={{ background: lesson.color || "#356AE6" }} />
        <div><div className="lesson-title"><h3>{lesson.subject}</h3><em className={`lesson-${lesson.status}`}>{lesson.status === "정규" ? lesson.timeStatus : lesson.status}</em></div><p><MapPin />{lesson.classroom || "강의실 미정"}<span>·</span>{lesson.professor || "담당 교수 미정"}</p>
          {lesson.scheduleChange && <p className="lesson-change"><Clock3 />{lesson.scheduleChange.originalDate} → {lesson.scheduleChange.changedDate || "보강 일정 미정"}</p>}
          {(lesson.scheduleChange?.changedStartTime || lesson.scheduleChange?.changedEndTime || lesson.scheduleChange?.changedClassroom) && <p className="lesson-change original"><Clock3 />기존 {[lesson.scheduleChange.originalStartTime && lesson.scheduleChange.originalEndTime ? `${lesson.scheduleChange.originalStartTime}-${lesson.scheduleChange.originalEndTime}` : "", lesson.scheduleChange.originalClassroom].filter(Boolean).join(" · ")}</p>}
        </div>
      </article>)}
    </section>
  </div>
}
