const dateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const semesterLabels = {
  "1": "1학기",
  summer: "여름학기",
  "2": "2학기",
  winter: "겨울학기",
};

function firstScheduleDate(schedules, academicYear, startMonth, endMonth, pattern) {
  const rangeStart = `${academicYear}-${String(startMonth).padStart(2, "0")}-01`;
  const rangeEndYear = endMonth < startMonth ? academicYear + 1 : academicYear;
  const lastDay = new Date(rangeEndYear, endMonth, 0).getDate();
  const rangeEnd = `${rangeEndYear}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return (Array.isArray(schedules) ? schedules : [])
    .filter((item) => {
      const start = String(item.start_date || "").slice(0, 10);
      return start >= rangeStart && start <= rangeEnd && pattern.test(String(item.title || ""));
    })
    .map((item) => String(item.start_date).slice(0, 10))
    .sort()[0] || "";
}

export function resolveAcademicTerm(schedules, target = new Date()) {
  const targetKey = dateKey(target);
  const targetDate = target instanceof Date ? target : new Date(`${targetKey}T00:00:00`);
  const academicYear = targetDate.getMonth() < 2 ? targetDate.getFullYear() - 1 : targetDate.getFullYear();
  const springStart = firstScheduleDate(schedules, academicYear, 3, 4, /1학기.*(?:개시일|개강(?!\s*예배))/) || `${academicYear}-03-01`;
  const summerStart = firstScheduleDate(schedules, academicYear, 6, 8, /하계.*(?:방학|계절학기)|(?:방학|계절학기).*하계/) || `${academicYear}-06-22`;
  const fallStart = firstScheduleDate(schedules, academicYear, 8, 10, /2학기.*(?:개시일|개강)/) || `${academicYear}-09-01`;
  const winterStart = firstScheduleDate(schedules, academicYear, 11, 2, /동계.*(?:방학|계절학기)|(?:방학|계절학기).*동계/) || `${academicYear}-12-21`;
  const nextSpringStart = `${academicYear + 1}-03-01`;

  let semester = "1";
  let startDate = springStart;
  let endDate = summerStart;
  if (targetKey >= winterStart && targetKey < nextSpringStart) {
    semester = "winter";
    startDate = winterStart;
    endDate = nextSpringStart;
  } else if (targetKey >= fallStart) {
    semester = "2";
    startDate = fallStart;
    endDate = winterStart;
  } else if (targetKey >= summerStart) {
    semester = "summer";
    startDate = summerStart;
    endDate = fallStart;
  }

  return {
    year: academicYear,
    semester,
    label: semesterLabels[semester],
    startDate,
    endDate,
  };
}

export function selectCurrentTimetable(collections, schedules, target = new Date(), preferredId = null) {
  const term = resolveAcademicTerm(schedules, target);
  const matching = (Array.isArray(collections) ? collections : [])
    .filter((item) => Number(item.year) === term.year && String(item.semester) === term.semester)
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")) || Number(b.id) - Number(a.id));
  const preferred = matching.find((item) => Number(item.id) === Number(preferredId));
  return { term, timetable: preferred || matching[0] || null };
}

