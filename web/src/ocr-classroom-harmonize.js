import { normalizeClassroom, normalizeCourseName } from "./ocr-normalize.js";

export const subjectNormalizationKey = (value) =>
  normalizeCourseName([value]).toUpperCase().trim();

export const parseClassroom = (value, confidence = 0, source = "final") => {
  const raw = String(value || ""),
    normalized = normalizeClassroom(raw),
    match = normalized.match(/^(.*?)(\d{3})$/),
    prefix = match ? match[1].trim() : normalized.replace(/\d+$/, "").trim(),
    roomNumber = match ? match[2] : normalized.match(/(\d{3})$/)?.[1] || "",
    prefixScript = /^[\uAC00-\uD7A3]{1,3}$/.test(prefix)
      ? "korean"
      : /^[A-Za-z]{1,10}$/.test(prefix)
        ? "latin"
        : /^\d+$/.test(prefix)
          ? "digit"
          : prefix
            ? "unknown"
            : "unknown";
  return {
    raw,
    normalized,
    prefix,
    roomNumber,
    prefixScript,
    confidence,
    source,
  };
};

const sourceScore = (source) => {
  if (source === "room-line-color") return 4;
  if (source === "room-line-scaled") return 3.5;
  if (source.startsWith("room-line-")) return 2.5;
  if (source === "prefix-color") return 3.5;
  if (source === "prefix-scaled") return 3;
  if (source.startsWith("prefix-")) return 2;
  return 0.5;
};

const candidateScore = (candidate) => {
  const parsed = parseClassroom(
    candidate.text,
    candidate.confidence ?? 0,
    candidate.source || "unknown",
  );
  let score = 0;
  if (parsed.prefixScript === "korean") score += 5;
  if (parsed.prefixScript === "latin") score -= parsed.prefix.length >= 2 ? 5 : 1;
  if (parsed.roomNumber) score += 3;
  if (candidate.source) score += sourceScore(candidate.source);
  score += (candidate.confidence ?? 0) * 3;
  if (candidate.isDerived) score -= 5;
  if (candidate.needsReview) score -= 4;
  if (/[^A-Za-z\uAC00-\uD7A3]/.test(parsed.prefix)) score -= 2;
  return score;
};

const collectGroupCandidates = (members, roomNumber) => {
  const scoreMap = new Map();
  for (const member of members) {
    for (const candidate of member.prefixCandidates || []) {
      const parsed = parseClassroom(
        `${candidate.text}${roomNumber}`,
        candidate.confidence ?? 0,
        candidate.source || "prefix-unknown",
      );
      if (parsed.prefixScript !== "korean") continue;
      if (candidate.isDerived || candidate.needsReview) continue;
      if ((candidate.confidence ?? 0) < 0.45) continue;
      const score = candidateScore({
        text: `${parsed.prefix}${roomNumber}`,
        confidence: candidate.confidence ?? 0,
        source: candidate.source || "prefix-unknown",
        isDerived: false,
        needsReview: false,
      });
      scoreMap.set(parsed.prefix, (scoreMap.get(parsed.prefix) || 0) + score);
    }
    for (const candidate of member.rawRoomCandidates || []) {
      const parsed = parseClassroom(
        candidate.text,
        candidate.confidence ?? 0,
        candidate.source || "room-line-unknown",
      );
      if (parsed.roomNumber !== roomNumber || parsed.prefixScript !== "korean") continue;
      if (candidate.isDerived || candidate.needsReview) continue;
      if ((candidate.confidence ?? 0) < 0.5) continue;
      const score = candidateScore(candidate);
      scoreMap.set(parsed.prefix, (scoreMap.get(parsed.prefix) || 0) + score);
    }
  }
  return [...scoreMap.entries()]
    .map(([prefix, score]) => ({ prefix, score }))
    .sort((a, b) => b.score - a.score);
};

const shouldCorrectMember = (member, canonicalPrefix, canonicalScore) => {
  if (!canonicalPrefix) return false;
  if (member.parsed.roomNumber === "") return false;
  if (member.parsed.prefix === canonicalPrefix && member.parsed.prefixScript === "korean") return false;
  if (member.needsReview) return true;
  if (member.parsed.prefixScript !== "korean") return true;
  return (member.prefixConfidence ?? 0) + 0.2 < canonicalScore / 20;
};

export const harmonizeClassroomsBySubject = (events) => {
  const grouped = new Map();
  events.forEach((event, index) => {
    const subjectKey = subjectNormalizationKey(event.courseName),
      meta = event._ocrRoomMeta || {},
      parsed = parseClassroom(
        meta.originalClassroom ?? event.classroom,
        meta.roomConfidence ?? event.confidence ?? 0,
        meta.prefixSource || "final",
      );
    if (!subjectKey || !parsed.roomNumber) return;
    const groupKey = `${subjectKey}::${parsed.roomNumber}`,
      member = {
        blockId: event.id || `block-${index + 1}`,
        index,
        event,
        groupKey,
        courseName: event.courseName,
        day: event.day,
        startTime: event.startTime,
        endTime: event.endTime,
        originalClassroom: meta.originalClassroom ?? event.classroom,
        rawRoomCandidates: meta.rawRoomCandidates || [],
        prefixCandidates: meta.prefixCandidates || [],
        selectedPrefixBeforeHarmonization:
          meta.selectedPrefixBeforeHarmonization ?? parsed.prefix,
        roomConfidence: meta.roomConfidence ?? event.confidence ?? 0,
        prefixConfidence: meta.prefixConfidence ?? 0,
        prefixSource: meta.prefixSource || "",
        isDerived: meta.isDerived ?? false,
        needsReview: event.needsReview ?? false,
        parsed,
      };
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(member);
  });

  const nextEvents = [...events];
  const logs = [];

  for (const [groupKey, members] of grouped.entries()) {
    const roomNumber = members[0]?.parsed.roomNumber || "",
      prefixScores = collectGroupCandidates(members, roomNumber),
      canonicalPrefix = prefixScores[0]?.prefix || "",
      canonicalPrefixConfidence = prefixScores[0]?.score || 0,
      secondScore = prefixScores[1]?.score || 0,
      hasConflict =
        prefixScores.length > 1 &&
        canonicalPrefix &&
        canonicalPrefixConfidence - secondScore < 2;

    const correctedMembers = [],
      unresolvedMembers = [];

    for (const member of members) {
      if (!canonicalPrefix || hasConflict) {
        if (hasConflict) {
          nextEvents[member.index] = {
            ...nextEvents[member.index],
            needsReview: true,
            _ocr: nextEvents[member.index]._ocr
              ? { ...nextEvents[member.index]._ocr, needsReview: true }
              : nextEvents[member.index]._ocr,
          };
        }
        unresolvedMembers.push(member.blockId);
        continue;
      }

      if (!shouldCorrectMember(member, canonicalPrefix, canonicalPrefixConfidence)) continue;

      const finalClassroom = `${canonicalPrefix}${roomNumber}`,
        prevEvent = nextEvents[member.index];
      nextEvents[member.index] = {
        ...prevEvent,
        classroom: finalClassroom,
        needsReview: false,
        _ocrRoomMeta: {
          ...(prevEvent._ocrRoomMeta || {}),
          isDerived: true,
          harmonizationGroupKey: groupKey,
          originalClassroom: member.originalClassroom,
          finalPrefix: canonicalPrefix,
          prefixSource: "subject-harmonization",
          prefixConfidence: canonicalPrefixConfidence / 20,
        },
        _ocr: prevEvent._ocr
          ? {
              ...prevEvent._ocr,
              classroom: finalClassroom,
              needsReview: false,
            }
          : prevEvent._ocr,
      };
      correctedMembers.push(member.blockId);
    }

    logs.push({
      groupKey,
      courseName: members[0]?.courseName || "",
      roomNumber,
      members: members.map((member) => ({
        blockId: member.blockId,
        day: member.day,
        time: `${member.startTime}-${member.endTime}`,
        originalClassroom: member.originalClassroom,
        rawRoomCandidates: member.rawRoomCandidates,
        prefixCandidates: member.prefixCandidates,
        selectedPrefixBeforeHarmonization:
          member.selectedPrefixBeforeHarmonization,
        confidence: member.roomConfidence,
        isDerived: member.isDerived,
        needsReview: member.needsReview,
      })),
      prefixScores,
      canonicalPrefix: hasConflict ? "" : canonicalPrefix,
      canonicalPrefixConfidence,
      correctedMembers,
      unresolvedMembers,
    });
  }

  return { events: nextEvents, logs };
};
