import test from "node:test";
import assert from "node:assert/strict";
import { resolveAcademicTerm, selectCurrentTimetable } from "./activeTimetable.js";

const schedules = [
  { title: "1학기 개시일", start_date: "2026-03-01" },
  { title: "하계방학 및 계절학기 시작", start_date: "2026-06-23" },
  { title: "2학기 개시일(개강일)", start_date: "2026-09-01" },
  { title: "동계방학 및 계절학기 시작", start_date: "2026-12-21" },
];

test("학사일정 경계로 현재 학기를 판정한다", () => {
  assert.equal(resolveAcademicTerm(schedules, new Date("2026-06-22T12:00:00")).semester, "1");
  assert.equal(resolveAcademicTerm(schedules, new Date("2026-06-23T12:00:00")).semester, "summer");
  assert.equal(resolveAcademicTerm(schedules, new Date("2026-09-01T12:00:00")).semester, "2");
  assert.equal(resolveAcademicTerm(schedules, new Date("2027-01-10T12:00:00")).semester, "winter");
});

test("현재 학기와 일치하는 시간표만 선택한다", () => {
  const collections = [
    { id: 1, year: 2026, semester: "1", updated_at: "2026-06-01" },
    { id: 2, year: 2026, semester: "summer", updated_at: "2026-06-24" },
  ];
  const result = selectCurrentTimetable(collections, schedules, new Date("2026-07-14T12:00:00"), 1);
  assert.equal(result.timetable.id, 2);
});
