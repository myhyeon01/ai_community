import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeClassroom,
  normalizeCourseName,
  removeRepeatedWords,
} from "./ocr-normalize.js";

test("normalizeCourseName keeps roman numerals", () => {
  assert.equal(
    normalizeCourseName(["COLLEGE", "ENGLISH", "I"]),
    "COLLEGE ENGLISH I",
  );
});

test("normalizeCourseName rejoins korean syllables split by OCR", () => {
  assert.equal(normalizeCourseName(["\uC0DD \uCCB4 \uC5ED \uD559 (1)"]), "\uC0DD\uCCB4\uC5ED\uD559(1)");
});

test("normalizeCourseName repairs a line-broken THEORY token", () => {
  assert.equal(
    normalizeCourseName(["CIRCUIT T", "HEORY (영어 강의)"]),
    "CIRCUIT THEORY (영어 강의)",
  );
});

test("removeRepeatedWords collapses adjacent duplicates", () => {
  assert.equal(
    removeRepeatedWords("COLLEGE COLLEGE ENGLISH ENGLISH I"),
    "COLLEGE ENGLISH I",
  );
});

test("normalizeClassroom preserves korean prefixes", () => {
  assert.equal(normalizeClassroom("영432"), "영432");
  assert.equal(normalizeClassroom("스305"), "스305");
});
