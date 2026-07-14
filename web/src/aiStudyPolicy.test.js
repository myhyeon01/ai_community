import test from "node:test";
import assert from "node:assert/strict";
import { isPersonalScheduleHeavy, postCommuteStudyStart } from "./aiStudyPolicy.js";

test("공부 시작 기준을 마지막 수업과 하교 시간 이후로 계산한다", () => {
  const classes = [{ start: 900, end: 975 }, { start: 1050, end: 1125 }];
  assert.equal(postCommuteStudyStart(classes, 60), 1185);
  assert.equal(postCommuteStudyStart([], 60), 1020);
});

test("하교 이후 개인 일정이 많은 날을 과밀일로 판정한다", () => {
  assert.equal(isPersonalScheduleHeavy([
    { start: 1080, end: 1110 },
    { start: 1140, end: 1170 },
    { start: 1200, end: 1230 },
  ], 1020, 1320), true);
  assert.equal(isPersonalScheduleHeavy([{ start: 1140, end: 1200 }], 1020, 1320), false);
  assert.equal(isPersonalScheduleHeavy([
    { start: 480, end: 510 },
    { start: 540, end: 570 },
    { start: 600, end: 630 },
  ], 1020, 1320), true);
});
