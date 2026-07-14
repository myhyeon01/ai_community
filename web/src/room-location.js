const CAMPUS_QUERY_PREFIX = "계명대학교 성서캠퍼스";

const ROOM_ALIASES = [
  ["쉐", "쉐턱관"],
  ["영", "영암관"],
  ["의", "의양관"],
  ["봉", "봉경관"],
  ["동", "동영관"],
  ["백", "백은관"],
  ["보", "보산관"],
  ["전", "전갑규관"],
  ["스", "스미스관"],
  ["체", "체육관"],
  ["오", "오산관"],
];

const campusSearchQuery = (target) => `${CAMPUS_QUERY_PREFIX}${target}`;

const normalizeRoom = (room) => String(room || "").trim();

const compactRoom = (room) => normalizeRoom(room).replace(/\s+/g, "");

const engineeringBuildingFromRoom = (room) => {
  const match = compactRoom(room).match(/^공(?:학(?:관)?)?(\d)?/);
  if (!match) return "";
  return match[1] ? `공학${match[1]}호관` : "공학관";
};

export const resolveRoomLocation = (room) => {
  const value = normalizeRoom(room);
  if (!value) {
    return {
      displayName: "강의실을 입력해주세요",
      searchQuery: CAMPUS_QUERY_PREFIX,
      matched: false,
    };
  }

  const engineeringBuilding = engineeringBuildingFromRoom(value);
  if (engineeringBuilding) {
    return {
      displayName: engineeringBuilding,
      searchQuery: campusSearchQuery(engineeringBuilding),
      matched: true,
    };
  }

  const compact = compactRoom(value);
  const alias = ROOM_ALIASES.find(([prefix]) => compact.startsWith(prefix));
  if (alias) {
    const [, buildingName] = alias;
    return {
      displayName: buildingName,
      searchQuery: campusSearchQuery(buildingName),
      matched: true,
    };
  }

  return {
    displayName: "강의실 건물 정보 확인 필요",
    searchQuery: campusSearchQuery(value),
    matched: false,
  };
};
