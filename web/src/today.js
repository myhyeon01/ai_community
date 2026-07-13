import { calculateMakeupSchedules } from "./academic.js"

export const DAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"]

export function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function minutes(value) {
  const [hour, minute] = String(value || "").slice(0, 5).split(":").map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

function durationText(value, suffix) {
  const safe = Math.max(0, Math.ceil(value))
  const hours = Math.floor(safe / 60), rest = safe % 60
  return `${hours ? `${hours}시간 ` : ""}${rest ? `${rest}분 ` : ""}${suffix}`.trim()
}

export function buildTodayView(timetable, schedules, now = new Date()) {
  const today = isoDate(now)
  const actualWeekday = (now.getDay() + 6) % 7
  const override = schedules.find((row) => row.start_date <= today && row.end_date >= today && row.applied_weekday)
  const overrideIndex = override ? DAY_NAMES.indexOf(override.applied_weekday) : -1
  const appliedWeekday = overrideIndex >= 0 ? overrideIndex : actualWeekday
  const changes = calculateMakeupSchedules(schedules, timetable)
  const originalChanges = new Map(changes.filter((row) => row.originalDate === today).map((row) => [row.timetableId, row]))
  const makeupChanges = new Map(changes.filter((row) => row.changedDate === today).map((row) => [row.timetableId, row]))
  const holiday = schedules.find((row) => ["공휴일", "휴업일"].includes(row.event_type) && row.start_date <= today && row.end_date >= today)
  const selected = new Map()

  timetable.filter((row) => row.weekday === appliedWeekday).forEach((row) => {
    const makeup = makeupChanges.get(row.id)
    selected.set(row.id, { ...row, status: makeup ? "보강" : holiday || originalChanges.has(row.id) ? "휴강" : "정규" })
  })
  makeupChanges.forEach((change, id) => {
    if (!selected.has(id)) {
      const row = timetable.find((course) => course.id === id)
      if (row) selected.set(id, { ...row, status: "보강" })
    }
  })

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const lessons = [...selected.values()].sort((a, b) => a.start_time.localeCompare(b.start_time)).map((row) => {
    const start = minutes(row.start_time), end = minutes(row.end_time)
    if (start === null || end === null) return null
    const timeStatus = row.status === "휴강" ? "휴강" : nowMinutes < start ? "예정" : nowMinutes < end ? "진행 중" : "종료"
    return { ...row, timeStatus, startMinutes: start, endMinutes: end }
  }).filter(Boolean)
  const active = lessons.find((row) => row.status !== "휴강" && row.startMinutes <= nowMinutes && nowMinutes < row.endMinutes)
  const next = lessons.find((row) => row.status !== "휴강" && row.startMinutes > nowMinutes)
  const remaining = active ? durationText(active.endMinutes - nowMinutes, "후 종료") : next ? durationText(next.startMinutes - nowMinutes, "남음") : "오늘 수업 종료"
  const notices = []
  if (overrideIndex >= 0 && overrideIndex !== actualWeekday) notices.push(`오늘은 ${DAY_NAMES[appliedWeekday]}요일 수업이 진행됩니다.`)
  if (holiday) notices.push(`${holiday.title}: 오늘 수업은 휴강입니다.`)
  if (makeupChanges.size) notices.push(`공식 학사일정에 따른 보강 수업이 ${makeupChanges.size}건 있습니다.`)

  return { today, actualWeekday, appliedWeekday, override, lessons, active, next, remaining, notices }
}
