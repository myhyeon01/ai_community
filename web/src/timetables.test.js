import test from "node:test";
import assert from "node:assert/strict";
import {
  createTimetableTitle,
  getSemesterLabel,
  resolveTimetableTitle,
  validateSemester,
  validateYear,
} from "./timetables.js";

test("validateYear accepts 0 and 3000", () => {
  assert.equal(validateYear(0), "");
  assert.equal(validateYear(3000), "");
});

test("validateYear rejects out of range and decimals", () => {
  assert.equal(validateYear(-1), "연도는 0부터 3000 사이로 입력해주세요.");
  assert.equal(validateYear(3001), "연도는 0부터 3000 사이로 입력해주세요.");
  assert.equal(validateYear(2026.5), "연도는 정수로 입력해주세요.");
});

test("validateYear rejects empty", () => {
  assert.equal(validateYear(""), "연도를 입력해주세요.");
});

test("semester labels and titles", () => {
  assert.equal(getSemesterLabel("1"), "1학기");
  assert.equal(getSemesterLabel("summer"), "여름학기");
  assert.equal(createTimetableTitle(2026, "2"), "2026년 2학기 시간표");
  assert.equal(createTimetableTitle(0, "1"), "0년 1학기 시간표");
});

test("validateSemester validates allowed values", () => {
  assert.equal(validateSemester("1"), "");
  assert.equal(validateSemester("summer"), "");
  assert.equal(validateSemester("spring"), "학기를 선택해주세요.");
});

test("resolveTimetableTitle appends sequence for duplicates", () => {
  const title = resolveTimetableTitle(2026, "2", [
    { title: "2026년 2학기 시간표" },
  ]);
  assert.equal(title, "2026년 2학기 시간표 2");
});
