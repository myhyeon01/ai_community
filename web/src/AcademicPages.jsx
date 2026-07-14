import React, { useEffect, useMemo, useState } from "react"
import { CalendarDays, RefreshCw } from "lucide-react"
import { supabase } from "./supabase"
import { calculateMakeupSchedules } from "./academic"
import { getAcademicCalendar } from "./academicApi"
import AcademicCalendarView from "./AcademicCalendarView"
import "./academic.css"

function useAcademicData() {
  const [state, setState] = useState({ schedules: [], timetable: [], loading: true, error: "", fetchedAt: "" })
  async function load(force = false) {
    setState((value) => ({ ...value, loading: true, error: "" }))
    try {
      const [calendar, timetable] = await Promise.all([
        getAcademicCalendar(force),
        supabase.from("timetables").select("*").order("weekday").order("start_time"),
      ])
      if (timetable.error) {
        console.warn("개인 시간표를 불러오지 못해 학사일정만 표시합니다.", timetable.error)
      }
      setState({ schedules: calendar.schedules || [], timetable: timetable.data || [], loading: false, error: "", fetchedAt: calendar.fetched_at })
    } catch (error) {
      if (error.name === "AbortError") return
      console.error("학사일정 요청 실패", error)
      setState((value) => ({ ...value, loading: false, error: error.message || "학사일정을 불러오지 못했습니다." }))
    }
  }
  useEffect(() => { load() }, [])
  return { ...state, load }
}

function PageHeader({ icon: Icon, title, description, loading, refresh }) {
  return <section className="academic-hero">
    <span><Icon /></span><div><p>KMU SMART SCHEDULER</p><h1>{title}</h1><small>{description}</small></div>
    <button disabled={loading} onClick={() => refresh(true)}><RefreshCw />{loading ? "불러오는 중" : "새로고침"}</button>
  </section>
}

export function AcademicPage() {
  const data = useAcademicData()
  const changes = useMemo(() => calculateMakeupSchedules(data.schedules, data.timetable), [data.schedules, data.timetable])
  return <AcademicCalendarView schedules={data.schedules} changes={changes} loading={data.loading} error={data.error} fetchedAt={data.fetchedAt} refresh={data.load} />
}

export function CalendarPage() {
  const data = useAcademicData()
  const changes = useMemo(() => calculateMakeupSchedules(data.schedules, data.timetable), [data.schedules, data.timetable])
  const entries = useMemo(() => [
    ...data.schedules.map((row) => ({ id: `a-${row.id}`, date: row.start_date, end: row.end_date, title: row.title, kind: "학사" })),
    ...changes.map((row) => ({ id: `c-${row.id}`, date: row.changedDate || row.originalDate, title: `${row.courseName} ${row.scheduleType}`, kind: row.scheduleType })),
  ].sort((a, b) => a.date.localeCompare(b.date)), [data.schedules, changes])
  return <div className="academic-page"><PageHeader icon={CalendarDays} title="통합 캘린더" description="학사일정과 개인 휴강·보강 일정을 날짜순으로 확인합니다." loading={data.loading} refresh={data.load} />
    {data.error && <div className="academic-error">{data.error}</div>}
    <div className="calendar-legend"><span className="legend-academic">학사일정</span><span className="legend-makeup">보강</span><span className="legend-cancel">휴강</span></div>
    <section className="academic-panel calendar-list">{entries.map((row) => <article key={row.id}><time>{row.date}{row.end && row.end !== row.date ? ` ~ ${row.end}` : ""}</time><b>{row.title}</b><span className={`calendar-${row.kind}`}>{row.kind}</span></article>)}</section>
  </div>
}
