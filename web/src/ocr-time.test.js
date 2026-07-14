import test from "node:test";
import assert from "node:assert/strict";
import { durationSlotsFromPixels, inferGridStartHour } from "./ocr-time.js";

test("오전·오후가 섞인 시간 라벨로 첫 행 시각을 찾는다", () => {
  assert.equal(inferGridStartHour([
    { hour: 9, rowIndex: 0 },
    { hour: 10, rowIndex: 1 },
    { hour: 12, rowIndex: 3 },
    { hour: 1, rowIndex: 4 },
    { hour: 5, rowIndex: 8 },
  ]), 9);
});

test("블록 높이를 15분 단위로 계산하며 60분을 75분으로 바꾸지 않는다", () => {
  assert.equal(durationSlotsFromPixels(80, 20), 4);
  assert.equal(durationSlotsFromPixels(100, 20), 5);
});
