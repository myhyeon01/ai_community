export const CATEGORY_META = {
  term: { label: "개강·종강", keywords: ["개강", "종강", "개시일"] },
  makeup: { label: "보강주", keywords: ["보강", "휴강", "대체 수업"] },
  exam: { label: "시험기간", keywords: ["시험", "중간고사", "기말고사", "정기시험"] },
  registration: { label: "수강신청", keywords: ["수강신청", "수강정정", "복학", "휴학", "등록"] },
  general: { label: "일반 일정", keywords: [] },
}

export function categoryFor(row) {
  const officialCategory = String(row.category || row.event_type || "")
  if (row.source === "personal" || row.scheduleType === "보강" || /보강|휴강|대체/.test(officialCategory)) return "makeup"
  if (/시험/.test(officialCategory)) return "exam"
  if (/수강|등록|복학|휴학/.test(officialCategory)) return "registration"
  if (/개강|종강/.test(officialCategory)) return "term"
  return Object.entries(CATEGORY_META).find(([key, meta]) => key !== "general" && meta.keywords.some((word) => row.title.includes(word)))?.[0] || "general"
}

export function safeDate(value, row) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) { console.warn("학사일정 날짜 파싱 실패", row); return null }
  const [year, month, day] = value.split("-").map(Number)
  const result = new Date(year, month - 1, day)
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) { console.warn("학사일정 날짜 파싱 실패", row); return null }
  return result
}

export function dateKey(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

export function calendarEvents(schedules, changes) {
  const official = schedules.flatMap((row) => {
    const start = safeDate(row.start_date, row), end = safeDate(row.end_date, row)
    if (!start || !end || end < start) return []
    const event = { ...row, source: "official", startDate: row.start_date, endDate: row.end_date }
    return [{ ...event, category: categoryFor(event) }]
  })
  const personal = changes.flatMap((row) => {
    const target = row.changedDate || row.originalDate
    if (!safeDate(target, row)) return []
    const event = { ...row, id: `personal-${row.id}`, title: `${row.courseName} ${row.scheduleType}`, startDate: target, endDate: target, source: "personal", category: "makeup", original_date: row.originalDate, changed_date: row.changedDate, schedule_type: row.scheduleType }
    return [event]
  })
  const unique = new Map()
  ;[...official, ...personal].forEach((event) => {
    const key = `${event.title}|${event.startDate}|${event.endDate}|${event.courseName || ""}`
    if (!unique.has(key)) unique.set(key, event)
  })
  return [...unique.values()]
}

export function yearsFor(events) {
  const years = new Set()
  events.forEach((event) => { years.add(Number(event.startDate.slice(0, 4))); years.add(Number(event.endDate.slice(0, 4))) })
  return [...years].filter(Boolean).sort((a, b) => a - b)
}

export function eventsByDate(events) {
  const result = new Map()
  events.forEach((event) => {
    const start = safeDate(event.startDate, event), end = safeDate(event.endDate, event)
    if (!start || !end) return
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const key = dateKey(cursor), current = result.get(key) || []
      if (!current.some((item) => item.id === event.id)) result.set(key, [...current, event])
    }
  })
  return result
}

export function monthCells(year, month) {
  const first = new Date(year, month, 1), start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, index) => { const value = new Date(start); value.setDate(start.getDate() + index); return value })
}

export function summaryFor(events, now = new Date()) {
  const today = dateKey(now)
  return ["term", "makeup", "exam", "registration"].map((category) => {
    const rows = events.filter((event) => event.category === category).sort((a, b) => a.startDate.localeCompare(b.startDate))
    const representative = rows.find((event) => event.endDate >= today) || rows.at(-1)
    return { category, label: CATEGORY_META[category].label, count: rows.length, representative }
  })
}
