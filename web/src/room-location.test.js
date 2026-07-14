import test from "node:test";
import assert from "node:assert/strict";
import { resolveRoomLocation } from "./room-location.js";

test("resolves engineering building number from the first digit after the prefix", () => {
  assert.deepEqual(resolveRoomLocation("공1402"), {
    displayName: "공학1호관",
    searchQuery: "계명대학교 성서캠퍼스공학1호관",
    matched: true,
  });
  assert.deepEqual(resolveRoomLocation("공2402"), {
    displayName: "공학2호관",
    searchQuery: "계명대학교 성서캠퍼스공학2호관",
    matched: true,
  });
  assert.deepEqual(resolveRoomLocation("공학1402"), {
    displayName: "공학1호관",
    searchQuery: "계명대학교 성서캠퍼스공학1호관",
    matched: true,
  });
});

test("resolves configured classroom aliases", () => {
  const cases = [
    ["영101", "영암관"],
    ["의101", "의양관"],
    ["봉202", "봉경관"],
    ["쉐301", "쉐턱관"],
    ["동101", "동영관"],
    ["백201", "백은관"],
    ["보301", "보산관"],
    ["전101", "전갑규관"],
    ["스201", "스미스관"],
    ["체101", "체육관"],
    ["오101", "오산관"],
  ];

  for (const [room, building] of cases) {
    assert.deepEqual(resolveRoomLocation(room), {
      displayName: building,
      searchQuery: `계명대학교 성서캠퍼스${building}`,
      matched: true,
    });
  }
});

test("trims spaces and falls back to the original input for unknown rooms", () => {
  assert.equal(resolveRoomLocation(" 공1402 ").displayName, "공학1호관");
  assert.deepEqual(resolveRoomLocation("새건물101"), {
    displayName: "강의실 건물 정보 확인 필요",
    searchQuery: "계명대학교 성서캠퍼스새건물101",
    matched: false,
  });
});
