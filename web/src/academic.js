export function calculateMakeupSchedules(schedules, timetable) {
  const relations = new Map()
  schedules.forEach((row) => {
    if (row.schedule_type === "보강" && row.original_date && row.changed_date)
      relations.set(row.original_date, row)
  })

  const results = new Map()
  relations.forEach((row, originalDate) => {
    timetable
      .filter((course) => ["월", "화", "수", "목", "금", "토", "일"][course.weekday] === row.original_weekday)
      .forEach((course) => results.set(`${course.id}|${originalDate}`, makeResult(course, row, originalDate, row.changed_date)))
  })

  schedules.forEach((row) => {
    if (!["공휴일", "휴업일"].includes(row.event_type)) return
    const originalDate = row.original_date || row.start_date
    if (!originalDate || relations.has(originalDate)) return
    timetable
      .filter((course) => ["월", "화", "수", "목", "금", "토", "일"][course.weekday] === row.original_weekday)
      .forEach((course) => results.set(`${course.id}|${originalDate}`, makeResult(course, row, originalDate, null)))
  })
  return [...results.values()].sort((a, b) => a.originalDate.localeCompare(b.originalDate) || a.courseName.localeCompare(b.courseName))
}

function makeResult(course, row, originalDate, changedDate) {
  const changedStartTime = (row.changed_start_time || row.changedStartTime)?.slice(0, 5) || null
  const changedEndTime = (row.changed_end_time || row.changedEndTime)?.slice(0, 5) || null
  const changedClassroom = row.changed_classroom || row.changedClassroom || null
  return {
    id: `${course.id}-${originalDate}`,
    timetableId: course.id,
    courseName: course.subject,
    originalDate,
    changedDate,
    startTime: changedStartTime || course.start_time?.slice(0, 5),
    endTime: changedEndTime || course.end_time?.slice(0, 5),
    classroom: changedClassroom || course.classroom,
    originalStartTime: course.start_time?.slice(0, 5),
    originalEndTime: course.end_time?.slice(0, 5),
    originalClassroom: course.classroom,
    changedStartTime,
    changedEndTime,
    changedClassroom,
    scheduleType: changedDate ? "보강" : "휴강",
    academicTitle: row.title,
  }
}
