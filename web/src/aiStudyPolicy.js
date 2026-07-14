function mergedDuration(blocks, start, end) {
  const ranges = (Array.isArray(blocks) ? blocks : [])
    .map((item) => ({ start: Math.max(start, Number(item.start)), end: Math.min(end, Number(item.end)) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let current = null;
  ranges.forEach((range) => {
    if (!current || range.start > current.end) {
      if (current) total += current.end - current.start;
      current = { ...range };
      return;
    }
    current.end = Math.max(current.end, range.end);
  });
  if (current) total += current.end - current.start;
  return total;
}

export function postCommuteStudyStart(classes, commuteMinutes, fallbackStart = 17 * 60) {
  const lastClassEnd = (Array.isArray(classes) ? classes : [])
    .map((item) => Number(item.end))
    .filter(Number.isFinite)
    .reduce((latest, value) => Math.max(latest, value), 0);
  if (!lastClassEnd) return fallbackStart;
  return Math.min(24 * 60, lastClassEnd + Math.max(0, Number(commuteMinutes) || 0));
}

export function isPersonalScheduleHeavy(personal, studyStart, dayEnd = 22 * 60) {
  const valid = (Array.isArray(personal) ? personal : []).filter((item) => (
    Number.isFinite(Number(item.start)) && Number.isFinite(Number(item.end)) && Number(item.end) > Number(item.start)
  ));
  if (valid.length >= 3) return true;
  const relevant = valid.filter((item) => (
    Number(item.end) > studyStart && Number(item.start) < dayEnd
  ));
  const windowMinutes = Math.max(0, dayEnd - studyStart);
  if (!windowMinutes) return true;
  const occupied = mergedDuration(relevant, studyStart, dayEnd);
  return occupied >= Math.max(120, windowMinutes * 0.45);
}
