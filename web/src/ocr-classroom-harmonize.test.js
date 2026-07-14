import test from "node:test";
import assert from "node:assert/strict";
import {
  harmonizeClassroomsBySubject,
  parseClassroom,
} from "./ocr-classroom-harmonize.js";

const makeEvent = (id, classroom, confidence, rawCandidates = [], prefixCandidates = []) => ({
  id,
  day: "월",
  startTime: "12:00",
  endTime: "13:15",
  courseName: "COLLEGE ENGLISH I",
  classroom,
  confidence,
  needsReview: classroom !== "영432",
  _ocrRoomMeta: {
    originalClassroom: classroom,
    rawRoomCandidates: rawCandidates,
    prefixCandidates,
    selectedPrefixBeforeHarmonization: parseClassroom(classroom).prefix,
    roomConfidence: confidence,
    prefixConfidence: confidence,
    prefixSource: rawCandidates[0]?.source || "",
    isDerived: false,
  },
  _ocr: {
    classroom,
    needsReview: classroom !== "영432",
  },
});

test("harmonizes 305 group from reliable korean candidate", () => {
  const input = [
      makeEvent("a", "가305", 0.35, [
        { text: "가305", source: "threshold", confidence: 0.35 },
        { text: "305", source: "number-color", confidence: 0.94 },
      ]),
      makeEvent("b", "스305", 0.91, [
        { text: "스305", source: "room-line-color", confidence: 0.91 },
      ], [
        { text: "스", source: "prefix-color", confidence: 0.86 },
      ]),
    ],
    { events } = harmonizeClassroomsBySubject(input);
  assert.deepEqual(events.map((event) => event.classroom), ["스305", "스305"]);
});

test("harmonizes 456 group from reliable korean candidate", () => {
  const input = [
      makeEvent("a", "가456", 0.33, [
        { text: "가456", source: "threshold", confidence: 0.33 },
      ]),
      makeEvent("b", "영456", 0.93, [
        { text: "영456", source: "room-line-color", confidence: 0.93 },
      ], [
        { text: "영", source: "prefix-color", confidence: 0.9 },
      ]),
    ],
    { events } = harmonizeClassroomsBySubject(input);
  assert.deepEqual(events.map((event) => event.classroom), ["영456", "영456"]);
});

test("keeps stable 432 group unchanged", () => {
  const input = [
      makeEvent("a", "영432", 0.91, [
        { text: "영432", source: "room-line-color", confidence: 0.91 },
      ], [
        { text: "영", source: "prefix-color", confidence: 0.88 },
      ]),
      makeEvent("b", "영432", 0.89, [
        { text: "영432", source: "room-line-scaled", confidence: 0.89 },
      ], [
        { text: "영", source: "prefix-scaled", confidence: 0.84 },
      ]),
    ],
    { events } = harmonizeClassroomsBySubject(input);
  assert.deepEqual(events.map((event) => event.classroom), ["영432", "영432"]);
});

test("marks conflict as needsReview instead of auto harmonizing", () => {
  const input = [
      makeEvent("a", "스305", 0.91, [
        { text: "스305", source: "room-line-color", confidence: 0.91 },
      ], [
        { text: "스", source: "prefix-color", confidence: 0.91 },
      ]),
      makeEvent("b", "영305", 0.9, [
        { text: "영305", source: "room-line-color", confidence: 0.9 },
      ], [
        { text: "영", source: "prefix-color", confidence: 0.9 },
      ]),
    ],
    { events } = harmonizeClassroomsBySubject(input);
  assert.deepEqual(events.map((event) => event.classroom), ["스305", "영305"]);
  assert.equal(events[0].needsReview, true);
  assert.equal(events[1].needsReview, true);
});

test("does not promote latin or digits-only candidates as canonical prefix", () => {
  const input = [
      makeEvent("a", "HN305", 0.99, [
        { text: "HN305", source: "room-line-color", confidence: 0.99 },
      ]),
      makeEvent("b", "305", 0.98, [
        { text: "305", source: "number-color", confidence: 0.98 },
      ]),
    ],
    { events, logs } = harmonizeClassroomsBySubject(input);
  assert.deepEqual(events.map((event) => event.classroom), ["HN305", "305"]);
  assert.equal(logs[0].canonicalPrefix, "");
});
