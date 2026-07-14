export const SEMESTER_OPTIONS = [
  { value: "1", label: "1학기", rank: 0 },
  { value: "summer", label: "여름학기", rank: 1 },
  { value: "2", label: "2학기", rank: 2 },
  { value: "winter", label: "겨울학기", rank: 3 },
];

export const DEFAULT_SEMESTER = "1";

export const getCurrentYear = () => new Date().getFullYear();

export const getSemesterLabel = (semester) =>
  SEMESTER_OPTIONS.find((item) => item.value === semester)?.label ||
  `${semester}학기`;

export const createTimetableTitle = (year, semester) =>
  `${year}년 ${getSemesterLabel(semester)} 시간표`;

export const validateYear = (year) => {
  if (year === "") return "연도를 입력해주세요.";
  if (!Number.isFinite(year)) return "올바른 연도를 입력해주세요.";
  if (!Number.isInteger(year)) return "연도는 정수로 입력해주세요.";
  if (year < 0 || year > 3000)
    return "연도는 0부터 3000 사이로 입력해주세요.";
  return "";
};

export const validateSemester = (semester) =>
  SEMESTER_OPTIONS.some((item) => item.value === semester)
    ? ""
    : "학기를 선택해주세요.";

export const semesterRank = (semester) =>
  SEMESTER_OPTIONS.find((item) => item.value === semester)?.rank ??
  SEMESTER_OPTIONS.length;

export const sortTimetables = (items) =>
  [...items].sort(
    (a, b) =>
      Number(b.year ?? 0) - Number(a.year ?? 0) ||
      semesterRank(b.semester) - semesterRank(a.semester) ||
      String(b.updated_at || "").localeCompare(String(a.updated_at || "")),
  );

export const resolveTimetableTitle = (year, semester, existing = []) => {
  const base = createTimetableTitle(year, semester);
  const sameTitles = existing.filter((item) => item.title === base);
  return sameTitles.length ? `${base} ${sameTitles.length + 1}` : base;
};

export const courseCountLabel = (count) => `수업 ${count}개`;
