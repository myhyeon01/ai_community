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
