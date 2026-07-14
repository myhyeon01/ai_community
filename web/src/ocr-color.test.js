import test from "node:test";
import assert from "node:assert/strict";
import { areSimilarCourseColors, parseHexColor } from "./ocr-color.js";

test("같은 색의 미세한 캡처 오차는 같은 과목 색으로 본다", () => {
  assert.equal(areSimilarCourseColors(parseHexColor("#f3dfe1"), parseHexColor("#f0dcdf")), true);
  assert.equal(areSimilarCourseColors(parseHexColor("#72b9ad"), parseHexColor("#70b7aa")), true);
});

test("서로 다른 파스텔 색은 RGB 거리가 가까워도 합치지 않는다", () => {
  assert.equal(areSimilarCourseColors(parseHexColor("#f3dfe1"), parseHexColor("#dcefe4")), false);
  assert.equal(areSimilarCourseColors(parseHexColor("#efdfb3"), parseHexColor("#dcefe4")), false);
  assert.equal(areSimilarCourseColors(parseHexColor("#ffe8e8"), parseHexColor("#f0e8e8")), false);
});
