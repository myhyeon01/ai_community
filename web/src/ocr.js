import { createWorker } from "tesseract.js";
import {
  cleanOcrText,
  isLikelyClassroom,
  normalizeClassroom,
  normalizeCourseName,
  removeRepeatedWords,
} from "./ocr-normalize";
import {
  harmonizeClassroomsBySubject as harmonizeRecognizedClassrooms,
  parseClassroom as parseFinalClassroom,
} from "./ocr-classroom-harmonize.js";

const dayNames = ["월", "화", "수", "목", "금"],
  dayMap = { 월: 0, 화: 1, 수: 2, 목: 3, 금: 4, 토: 5, 일: 6 },
  timetableStartHour = 8,
  timetableEndHour = 22,
  quarterHour = 15;
const canonicalClassStartMinutes = [
  9 * 60,
  10 * 60 + 30,
  12 * 60,
  13 * 60 + 30,
  15 * 60,
  16 * 60 + 30,
  18 * 60,
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const norm = (v) => {
  const m = String(v || "").match(/(\d{1,2})[:.](\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};
const minutes = (t) => {
  const [h, m] = String(t || "00:00").split(":").map(Number);
  return h * 60 + m;
};
const formatMinutes = (value) => {
  const bounded = clamp(
    value,
    timetableStartHour * 60,
    timetableEndHour * 60,
  );
  const h = Math.floor(bounded / 60),
    m = bounded % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const addMinutes = (time, deltaMinutes) =>
  formatMinutes(minutes(time) + deltaMinutes);
const quantizeMinutes = (value) =>
  Math.round(value / quarterHour) * quarterHour;
const groups = (values, gap = 4) => {
  const out = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    const g = out.at(-1);
    if (!g || v - g.at(-1) > gap) out.push([v]);
    else g.push(v);
  }
  return out.map((g) => Math.round(g.reduce((a, b) => a + b, 0) / g.length));
};
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const mean = (arr) =>
  arr.length ? arr.reduce((sum, value) => sum + value, 0) / arr.length : 0;
const wordsOf = (data) =>
  (data?.blocks || []).flatMap((b) =>
    (b.paragraphs || []).flatMap((p) =>
      (p.lines || []).flatMap((l) => l.words || []),
    ),
  );
const wordText = (word) => String(word?.text || "").trim();

export function parseEverytimeText(raw) {
  const rows = [];
  for (const line of String(raw || "")
    .replace(/[|]/g, " ")
    .replace(/[~–—]/g, "-")
    .split(/\r?\n/)) {
    const range = line.match(/(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/),
      found = [...new Set(line.match(/[월화수목금토일]/g) || [])];
    if (!range || !found.length) continue;
    const start_time = norm(range[1]),
      end_time = norm(range[2]);
    if (!start_time || minutes(start_time) >= minutes(end_time)) continue;
    const subject =
      line
        .replace(range[0], "")
        .replace(/[월화수목금토일]/g, "")
        .replace(/\s+/g, " ")
        .trim() || "인식되지 않은 수업";
    found.forEach((d) =>
      rows.push({
        subject,
        professor: "",
        classroom: "",
        weekday: dayMap[d],
        start_time,
        end_time,
      }),
    );
  }
  return rows;
}

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const image = new Image(),
      url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = reject;
    image.src = url;
  });

const createCanvas = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};
const getImageContext = (canvas) =>
  canvas.getContext("2d", { willReadFrequently: true });

const rgbToHsv = (r, g, b) => {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255,
    max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn),
    delta = max - min;
  let h = 0;
  if (delta) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
  }
  return {
    h: Math.round(h * 60 < 0 ? h * 60 + 360 : h * 60),
    s: max ? delta / max : 0,
    v: max,
  };
};
const colorDistance = (a, b) =>
  Math.sqrt(
    (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2,
  );
const grayLine = (r, g, b) => {
  const delta = Math.max(r, g, b) - Math.min(r, g, b),
    average = (r + g + b) / 3;
  return delta < 20 && average >= 40 && average <= 245;
};

const estimateBackground = (pixels, w, h) => {
  const bucket = new Map();
  for (let y = Math.floor(h * 0.08); y < h * 0.96; y += 6)
    for (let x = Math.floor(w * 0.06); x < w * 0.98; x += 6) {
      const i = (y * w + x) * 4,
        r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2],
        hsv = rgbToHsv(r, g, b);
      if (hsv.s > 0.18) continue;
      const key = [
        Math.round(r / 16) * 16,
        Math.round(g / 16) * 16,
        Math.round(b / 16) * 16,
      ].join(",");
      bucket.set(key, (bucket.get(key) || 0) + 1);
    }
  const dominant = [...bucket.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!dominant) return { r: 244, g: 246, b: 250 };
  const [r, g, b] = dominant.split(",").map(Number);
  return { r, g, b };
};

const dilateMask = (mask, w, h, radius = 1) => {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dy = -radius; dy <= radius && !hit; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (mask[ny * w + nx]) {
            hit = 1;
            break;
          }
        }
      out[y * w + x] = hit;
    }
  return out;
};
const erodeMask = (mask, w, h, radius = 1) => {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let keep = 1;
      for (let dy = -radius; dy <= radius && keep; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) {
            keep = 0;
            break;
          }
        }
      out[y * w + x] = keep;
    }
  return out;
};
const closeMask = (mask, w, h, radius = 2) =>
  erodeMask(dilateMask(mask, w, h, radius), w, h, radius);
const fillMaskHoles = (mask, w, h) => {
  const outside = new Uint8Array(mask.length),
    queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (mask[idx] || outside[idx]) return;
    outside[idx] = 1;
    queue.push(idx);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  for (let i = 0; i < queue.length; i++) {
    const idx = queue[i],
      x = idx % w,
      y = Math.floor(idx / w);
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  const out = new Uint8Array(mask);
  for (let i = 0; i < out.length; i++) {
    if (!out[i] && !outside[i]) out[i] = 1;
  }
  return out;
};

const buildForegroundMask = (pixels, w, h) => {
  const background = estimateBackground(pixels, w, h),
    mask = new Uint8Array(w * h);
  for (let y = Math.floor(h * 0.08); y < h * 0.97; y++)
    for (let x = Math.floor(w * 0.08); x < Math.floor(w * 0.98); x++) {
      const i = (y * w + x) * 4,
        r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2],
        hsv = rgbToHsv(r, g, b),
        distance = colorDistance({ r, g, b }, background),
        foreground =
          distance > 30 &&
          ((hsv.s > 0.12 && hsv.v > 0.3) ||
            (distance > 45 && hsv.v > 0.22) ||
            hsv.s > 0.22);
      if (foreground) mask[y * w + x] = 1;
    }
  return {
    background,
    mask: fillMaskHoles(closeMask(mask, w, h, 2), w, h),
  };
};

const connectedComponents = (mask, w, h) => {
  const seen = new Uint8Array(mask.length),
    components = [],
    queue = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (!mask[start] || seen[start]) continue;
      let area = 0,
        x0 = x,
        x1 = x,
        y0 = y,
        y1 = y;
      queue.length = 0;
      queue.push(start);
      seen[start] = 1;
      for (let i = 0; i < queue.length; i++) {
        const idx = queue[i],
          cx = idx % w,
          cy = Math.floor(idx / w);
        area += 1;
        x0 = Math.min(x0, cx);
        x1 = Math.max(x1, cx);
        y0 = Math.min(y0, cy);
        y1 = Math.max(y1, cy);
        for (const next of [idx - 1, idx + 1, idx - w, idx + w]) {
          const nx = next % w,
            ny = Math.floor(next / w);
          if (
            next < 0 ||
            next >= mask.length ||
            seen[next] ||
            !mask[next] ||
            Math.abs(nx - cx) > 1 ||
            Math.abs(ny - cy) > 1
          )
            continue;
          seen[next] = 1;
          queue.push(next);
        }
      }
      components.push({ x0, y0, x1, y1, area });
    }
  return components;
};

const averageBlockColor = (pixels, block, w) => {
  let r = 0,
    g = 0,
    b = 0,
    count = 0;
  for (let y = block.y0; y <= block.y1; y += 2)
    for (let x = block.x0; x <= block.x1; x += 2) {
      const i = (y * w + x) * 4;
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];
      count += 1;
    }
  return count
    ? {
        r: Math.round(r / count),
        g: Math.round(g / count),
        b: Math.round(b / count),
      }
    : { r: 0, g: 0, b: 0 };
};

const mergeNearbyBlocks = (components, pixels, w, h) => {
  const pending = components
    .filter(
      (block) =>
        block.area >= Math.max(300, w * h * 0.00012) &&
        block.x1 - block.x0 > w * 0.03 &&
        block.y1 - block.y0 > h * 0.02,
    )
    .map((block) => ({
      ...block,
      averageColor: averageBlockColor(pixels, block, w),
    }))
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const merged = [];
  for (const block of pending) {
    const prev = merged.at(-1);
    if (!prev) {
      merged.push(block);
      continue;
    }
    const overlapX = Math.min(prev.x1, block.x1) - Math.max(prev.x0, block.x0),
      overlapY = Math.min(prev.y1, block.y1) - Math.max(prev.y0, block.y0),
      gapX = block.x0 - prev.x1,
      gapY = block.y0 - prev.y1,
      colorGap = colorDistance(prev.averageColor, block.averageColor);
    const similarColumn = Math.abs(prev.x0 - block.x0) < w * 0.02;
    const shouldMerge =
      colorGap < 28 &&
      ((overlapX > Math.min(prev.x1 - prev.x0, block.x1 - block.x0) * 0.7 &&
        gapY >= 0 &&
        gapY < h * 0.012) ||
        (overlapY > Math.min(prev.y1 - prev.y0, block.y1 - block.y0) * 0.7 &&
          gapX >= 0 &&
          gapX < w * 0.01) ||
        (similarColumn && overlapY > 0));
    if (!shouldMerge) {
      merged.push(block);
      continue;
    }
    prev.x0 = Math.min(prev.x0, block.x0);
    prev.y0 = Math.min(prev.y0, block.y0);
    prev.x1 = Math.max(prev.x1, block.x1);
    prev.y1 = Math.max(prev.y1, block.y1);
    prev.area += block.area;
    prev.averageColor = averageBlockColor(pixels, prev, w);
  }
  return merged;
};

const detectVerticalLines = (pixels, w, h) => {
  const hits = [];
  for (let x = Math.floor(w * 0.02); x < w * 0.98; x++) {
    let hit = 0;
    for (let y = Math.floor(h * 0.03); y < h * 0.97; y += 2) {
      const i = (y * w + x) * 4;
      if (grayLine(pixels[i], pixels[i + 1], pixels[i + 2])) hit += 1;
    }
    if (hit > ((h * 0.94) / 2) * 0.28) hits.push(x);
  }
  return groups(hits, 3);
};

const detectHorizontalLines = (pixels, w, h, left, right) => {
  const hits = [];
  for (let y = Math.floor(h * 0.02); y < h * 0.98; y++) {
    let hit = 0;
    for (let x = Math.max(0, Math.floor(left)); x < Math.min(w, Math.floor(right)); x += 2) {
      const i = (y * w + x) * 4;
      if (grayLine(pixels[i], pixels[i + 1], pixels[i + 2])) hit += 1;
    }
    if (hit > ((right - left) / 2) * 0.34) hits.push(y);
  }
  return groups(hits, 3);
};

const interpolateMissingGridLines = (lines) => {
  if (lines.length < 2) return { interpolatedLines: lines, medianGap: 0 };
  const gaps = lines.slice(1).map((value, index) => value - lines[index]),
    medianGap = median(gaps);
  const interpolated = [lines[0]];
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1],
      current = lines[index],
      gap = current - previous;
    if (gap > medianGap * 1.5) {
      const missingCount = Math.round(gap / medianGap) - 1;
      for (let i = 1; i <= missingCount; i += 1) {
        interpolated.push(Math.round(previous + medianGap * i));
      }
    }
    interpolated.push(current);
  }
  return { interpolatedLines: interpolated, medianGap };
};

const extendGridLines = (lines, medianGap, minY, maxY) => {
  const extended = [...lines];
  while (extended[0] - medianGap > minY) {
    extended.unshift(Math.round(extended[0] - medianGap));
  }
  while (extended.at(-1) + medianGap < maxY) {
    extended.push(Math.round(extended.at(-1) + medianGap));
  }
  return extended;
};

const chooseScheduleColumns = (lines, w) => {
  let best = null;
  for (let start = 0; start <= lines.length - 6; start += 1) {
    const run = lines.slice(start, start + 6),
      gaps = run.slice(1).map((value, index) => value - run[index]),
      avg = mean(gaps),
      variance = mean(gaps.map((gap) => Math.abs(gap - avg)));
    if (avg < w * 0.08 || avg > w * 0.26 || variance > w * 0.025) continue;
    const score = variance + Math.abs(avg - median(gaps)) * 0.5;
    if (!best || score < best.score) {
      best = { run, gaps, avg, score };
    }
  }
  if (best) {
    return {
      mondayColumnLeft: best.run[0],
      fridayColumnRight: best.run[5],
      columnWidth: mean(best.gaps),
      detectedVerticalLines: best.run,
    };
  }
  const fallbackGap = median(
    lines
      .slice(1)
      .map((value, index) => value - lines[index])
      .filter((gap) => gap > w * 0.08 && gap < w * 0.26),
  );
  const columnWidth = fallbackGap || w * 0.18,
    mondayColumnLeft = lines[0] || Math.floor(w * 0.12);
  return {
    mondayColumnLeft,
    fridayColumnRight: mondayColumnLeft + columnWidth * 5,
    columnWidth,
    detectedVerticalLines: lines,
  };
};

const chooseScheduleRows = (lines, h) => {
  const rawGaps = lines
      .slice(1)
      .map((value, index) => value - lines[index])
      .filter((gap) => gap > h * 0.02 && gap < h * 0.14),
    rowHeight = median(rawGaps) || h * 0.07,
    { interpolatedLines, medianGap } = interpolateMissingGridLines(lines),
    extendedLines = extendGridLines(
      interpolatedLines,
      medianGap || rowHeight,
      Math.floor(h * 0.03),
      Math.floor(h * 0.98),
    ),
    requiredLineCount = timetableEndHour - timetableStartHour + 1,
    candidateRun = [];
  for (let start = 0; start < extendedLines.length; start += 1) {
    const run = extendedLines.slice(start, start + requiredLineCount);
    if (run.length < requiredLineCount) break;
    const hasReasonableGaps = run
      .slice(1)
      .every((value, index) => Math.abs(value - run[index] - rowHeight) <= Math.max(8, rowHeight * 0.35));
    if (!hasReasonableGaps) continue;
    candidateRun.push(run);
  }
  const scheduleLines =
      candidateRun.sort((a, b) => a[0] - b[0])[0] ||
      extendedLines.slice(0, requiredLineCount),
    firstTimeRowTop = scheduleLines[0] || lines[0] || Math.floor(h * 0.12),
    headerBottom = firstTimeRowTop,
    lastTimeRowBottom =
      scheduleLines.at(-1) ||
      firstTimeRowTop + rowHeight * (timetableEndHour - timetableStartHour);
  return {
    rowHeight,
    headerBottom,
    firstTimeRowTop,
    lastTimeRowBottom,
    detectedHorizontalLines: lines,
    interpolatedHorizontalLines: interpolatedLines,
    scheduleRowLines: scheduleLines.length ? scheduleLines : extendedLines,
    medianGap: medianGap || rowHeight,
  };
};

const scoreCanonicalStart = (minutesValue) =>
  Math.min(
    ...canonicalClassStartMinutes.map((candidate) =>
      Math.abs(candidate - minutesValue),
    ),
  );

const inferBaseStartMinutes = (grid, blocks) => {
  const pixelsPer15Minutes = Math.max(1, (grid.medianGap || grid.rowHeight || 60) / 4),
    candidates = [];
  for (
    let baseMinutes = timetableStartHour * 60 - 30;
    baseMinutes <= timetableStartHour * 60 + 90;
    baseMinutes += 15
  )
    for (let slotOffset = -8; slotOffset <= 8; slotOffset += 1) {
      const blockScores = blocks.map((block) => {
        const rawRelativeY = block.y0 - grid.firstTimeRowTop,
          rawSlotIndex = rawRelativeY / pixelsPer15Minutes,
          finalSlotIndex = Math.round(rawSlotIndex),
          correctedSlotIndex = finalSlotIndex + slotOffset,
          resultMinutes = baseMinutes + correctedSlotIndex * quarterHour,
          canonicalDistance = scoreCanonicalStart(resultMinutes);
        return {
          rawRelativeY,
          rawSlotIndex,
          finalSlotIndex,
          correctedSlotIndex,
          resultMinutes,
          canonicalDistance,
        };
      });
      const score =
        mean(
          blockScores.map((item) => item.canonicalDistance),
        ) +
        mean(
          blockScores.map((item) =>
            item.resultMinutes >= 9 * 60 && item.resultMinutes <= 18 * 60
              ? 0
              : 90,
          ),
        ) +
        Math.abs(baseMinutes - timetableStartHour * 60) * 0.35 +
        Math.abs(slotOffset) * 3;
      candidates.push({ baseMinutes, slotOffset, score, blockScores });
    }
  return candidates.sort((a, b) => a.score - b.score)[0];
};

const columnSpan = (grid, columnIndex) => ({
  x0: Math.round(grid.mondayColumnLeft + grid.columnWidth * columnIndex),
  x1: Math.round(grid.mondayColumnLeft + grid.columnWidth * (columnIndex + 1)),
});

const foregroundBoundsInRect = (mask, w, rect) => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    count = 0;
  for (let y = rect.y0; y <= rect.y1; y++)
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (!mask[y * w + x]) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      count += 1;
    }
  return count
    ? {
        x0,
        y0,
        x1,
        y1,
        count,
        ratio: count / ((rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1)),
      }
    : null;
};

const splitWideComponentByColumns = (component, grid, mask, w) => {
  const width = component.x1 - component.x0 + 1,
    widthRatio = width / grid.columnWidth,
    intersectedColumns = [],
    splitComponents = [],
    foregroundRatios = [];
  for (let columnIndex = 0; columnIndex < 5; columnIndex += 1) {
    const span = columnSpan(grid, columnIndex),
      rect = {
        x0: Math.max(component.x0, span.x0),
        x1: Math.min(component.x1, span.x1),
        y0: component.y0,
        y1: component.y1,
      };
    if (rect.x1 <= rect.x0) continue;
    const intersectionWidth = rect.x1 - rect.x0 + 1;
    intersectedColumns.push(columnIndex);
    const bounds = foregroundBoundsInRect(mask, w, rect);
    foregroundRatios.push({
      columnIndex,
      intersectionWidth,
      foregroundPixelCount: bounds?.count || 0,
      ratio: bounds?.ratio || 0,
    });
    if (
      !bounds ||
      intersectionWidth < grid.columnWidth * 0.35 ||
      bounds.ratio < 0.07 ||
      bounds.count < grid.columnWidth * Math.max(10, grid.rowHeight * 0.18) ||
      bounds.x1 - bounds.x0 + 1 < grid.columnWidth * 0.48
    )
      continue;
    splitComponents.push({
      x0: Math.max(rect.x0, bounds.x0 - 1),
      y0: Math.max(rect.y0, bounds.y0 - 1),
      x1: Math.min(rect.x1, bounds.x1 + 1),
      y1: Math.min(rect.y1, bounds.y1 + 1),
      area: bounds.count,
    });
  }
  console.log("Component split debug", {
    originalComponent: {
      x: component.x0,
      y: component.y0,
      width,
      height: component.y1 - component.y0 + 1,
    },
    columnWidth: grid.columnWidth,
    widthRatio,
    intersectedColumns,
    splitComponents: splitComponents.map((block) => ({
      x: block.x0,
      y: block.y0,
      width: block.x1 - block.x0 + 1,
      height: block.y1 - block.y0 + 1,
    })),
    foregroundRatios,
  });
  return splitComponents.length ? splitComponents : [component];
};

const detectGrid = (pixels, w, h) => {
  const verticalLines = detectVerticalLines(pixels, w, h),
    columns = chooseScheduleColumns(verticalLines, w),
    horizontalLines = detectHorizontalLines(
      pixels,
      w,
      h,
      columns.mondayColumnLeft,
      columns.fridayColumnRight,
    ),
    rows = chooseScheduleRows(horizontalLines, h),
    outerLeft =
      [...verticalLines].filter((value) => value < columns.mondayColumnLeft).at(-1) ??
      Math.max(0, columns.mondayColumnLeft - columns.columnWidth * 0.45),
    outerRight =
      verticalLines.find((value) => value > columns.fridayColumnRight) ??
      columns.fridayColumnRight,
    outerTop =
      [...horizontalLines].filter((value) => value < rows.headerBottom).at(-1) ??
      Math.max(0, rows.headerBottom - rows.rowHeight),
    scheduleGridBounds = {
      x: columns.mondayColumnLeft,
      y: rows.firstTimeRowTop,
      width: columns.fridayColumnRight - columns.mondayColumnLeft,
      height: rows.lastTimeRowBottom - rows.firstTimeRowTop,
    },
    outerTimetableBounds = {
      x: outerLeft,
      y: outerTop,
      width: outerRight - outerLeft,
      height: rows.lastTimeRowBottom - outerTop,
    },
    headerBounds = {
      x: columns.mondayColumnLeft,
      y: outerTop,
      width: columns.fridayColumnRight - columns.mondayColumnLeft,
      height: rows.headerBottom - outerTop,
    };
  console.log("Timetable bounds debug", {
    outerTimetableBounds,
    headerBounds,
    headerBottom: rows.headerBottom,
    firstTimeRowTop: rows.firstTimeRowTop,
    lastTimeRowBottom: rows.lastTimeRowBottom,
    scheduleGridBounds,
    detectedHorizontalLines: rows.detectedHorizontalLines,
    interpolatedHorizontalLines: rows.interpolatedHorizontalLines,
    scheduleRowLines: rows.scheduleRowLines,
    detectedVerticalLines: columns.detectedVerticalLines,
  });
  return {
    ...columns,
    ...rows,
    outerTimetableBounds,
    headerBounds,
    scheduleGridBounds,
    timetableTop: rows.firstTimeRowTop,
    timetableBottom: rows.lastTimeRowBottom,
    timetableBounds: scheduleGridBounds,
  };
};

const dominantColorHex = (pixels, block, w) => {
  const bucket = new Map();
  for (let y = block.y0 + 2; y < block.y1 - 2; y += 3)
    for (let x = block.x0 + 2; x < block.x1 - 2; x += 3) {
      const i = (y * w + x) * 4,
        key = [pixels[i], pixels[i + 1], pixels[i + 2]]
          .map((value) => Math.round(value / 8) * 8)
          .join(",");
      bucket.set(key, (bucket.get(key) || 0) + 1);
    }
  const rgb = [...bucket.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0]
    ?.split(",")
    .map(Number) || [100, 140, 200];
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
};

const cropCanvas = (sourceCanvas, block, padding = 2) => {
  const x = Math.max(0, block.x0 - padding),
    y = Math.max(0, block.y0 - padding),
    width = Math.min(sourceCanvas.width - x, block.x1 - block.x0 + 1 + padding * 2),
    height = Math.min(
      sourceCanvas.height - y,
      block.y1 - block.y0 + 1 + padding * 2,
    ),
    canvas = createCanvas(width, height),
    ctx = getImageContext(canvas);
  ctx.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);
  return canvas;
};
const cropCanvasRelative = (
  sourceCanvas,
  block,
  leftRatio,
  topRatio,
  widthRatio,
  heightRatio,
  padding = 1,
) => {
  const width = block.x1 - block.x0 + 1,
    height = block.y1 - block.y0 + 1;
  return cropCanvas(
    sourceCanvas,
    {
      x0: Math.round(block.x0 + width * leftRatio),
      y0: Math.round(block.y0 + height * topRatio),
      x1: Math.round(block.x0 + width * (leftRatio + widthRatio)),
      y1: Math.round(block.y0 + height * (topRatio + heightRatio)),
    },
    padding,
  );
};

const makeRecognitionVariants = (canvas) => {
  const variants = [{ kind: "color", canvas }];
  const enlarged = createCanvas(canvas.width * 4, canvas.height * 4),
    ectx = getImageContext(enlarged);
  ectx.imageSmoothingEnabled = false;
  ectx.drawImage(canvas, 0, 0, enlarged.width, enlarged.height);
  variants.push({ kind: "scaled", canvas: enlarged });

  const grayscale = createCanvas(enlarged.width, enlarged.height),
    gctx = getImageContext(grayscale);
  gctx.drawImage(enlarged, 0, 0);
  const imageData = gctx.getImageData(0, 0, grayscale.width, grayscale.height),
    data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114),
      contrasted = value > 168 ? 255 : value < 96 ? 0 : value;
    data[i] = contrasted;
    data[i + 1] = contrasted;
    data[i + 2] = contrasted;
  }
  gctx.putImageData(imageData, 0, 0);
  variants.push({ kind: "contrast", canvas: grayscale });

  const threshold = createCanvas(enlarged.width, enlarged.height),
    tctx = getImageContext(threshold);
  tctx.drawImage(grayscale, 0, 0);
  const tData = tctx.getImageData(0, 0, threshold.width, threshold.height),
    thresholdPixels = tData.data;
  for (let i = 0; i < thresholdPixels.length; i += 4) {
    const value = thresholdPixels[i] > 150 ? 255 : 0;
    thresholdPixels[i] = value;
    thresholdPixels[i + 1] = value;
    thresholdPixels[i + 2] = value;
  }
  tctx.putImageData(tData, 0, 0);
  variants.push({ kind: "threshold", canvas: threshold });

  const inverted = createCanvas(enlarged.width, enlarged.height),
    ictx = getImageContext(inverted);
  ictx.drawImage(threshold, 0, 0);
  const iData = ictx.getImageData(0, 0, inverted.width, inverted.height),
    invertedPixels = iData.data;
  for (let i = 0; i < invertedPixels.length; i += 4) {
    const value = 255 - invertedPixels[i];
    invertedPixels[i] = value;
    invertedPixels[i + 1] = value;
    invertedPixels[i + 2] = value;
  }
  ictx.putImageData(iData, 0, 0);
  variants.push({ kind: "inverted", canvas: inverted });
  return variants;
};

const groupWordsIntoLines = (words) => {
  const groupsOut = [];
  for (const word of words.filter((item) => item?.bbox && wordText(item))) {
    const height = word.bbox.y1 - word.bbox.y0,
      centerY = (word.bbox.y0 + word.bbox.y1) / 2;
    let line = groupsOut.find((item) => Math.abs(item.centerY - centerY) < height * 0.8);
    if (!line) {
      line = { centerY, height, words: [] };
      groupsOut.push(line);
    }
    line.words.push(word);
    line.height = Math.max(line.height, height);
  }
  return groupsOut
    .sort((a, b) => a.centerY - b.centerY)
    .map((line) => ({
      x:
        Math.min(...line.words.map((word) => word.bbox.x0)),
      y: line.centerY,
      width:
        Math.max(...line.words.map((word) => word.bbox.x1)) -
        Math.min(...line.words.map((word) => word.bbox.x0)),
      height: line.height,
      confidence: mean(
        line.words.map((word) =>
          word.confidence != null ? word.confidence / 100 : 0.5,
        ),
      ),
      text: removeRepeatedWords(
        line.words
          .sort((a, b) => a.bbox.x0 - b.bbox.x0)
          .map(wordText)
          .join(" "),
      ),
    }))
    .filter((line) => line.text);
};

const classroomCandidateScore = (candidate) => {
  const text = normalizeClassroom(candidate.text || ""),
    hasDigits = /\d{3,5}/.test(text),
    hasKorean = /[\uAC00-\uD7A3]/.test(text),
    hasLetters = /[A-Za-z]/.test(text),
    noisePenalty =
      (/^[A-Za-z]{1,3}$/.test(text) ? 2 : 0) +
      (/^[^\w\uAC00-\uD7A3]+$/.test(text) ? 3 : 0) +
      (text.length > 14 ? 2 : 0) +
      (!hasDigits ? 2 : 0);
  return (
    (hasDigits ? 4 : 0) +
    (hasKorean ? 3 : 0) +
    (hasLetters ? 1 : 0) +
    (candidate.relativeY > 0.65 ? 2 : 0) +
    (text.length >= 4 && text.length <= 12 ? 2 : 0) +
    (candidate.confidence || 0) * 3 -
    noisePenalty
  );
};

const courseCandidateScore = (candidate) => {
  const text = normalizeCourseName([candidate]),
    upper = text.toUpperCase();
  return (
    (upper.includes("COLLEGE") ? 2 : 0) +
    (upper.includes("ENGLISH") ? 2 : 0) +
    (/\bI\b/.test(upper) ? 1 : 0) -
    (/\d{3,}/.test(text) ? 3 : 0) -
    (/^[0-9]/.test(text) ? 2 : 0)
  );
};

const hasVerticalRomanGlyphAfterEnglish = (rawWords = [], height = 1) =>
  rawWords.some((word, wordIndex, words) => {
    const upper = String(word.text || "").toUpperCase(),
      previous = words[wordIndex - 1]?.text?.toUpperCase?.() || "";
    return (
      previous === "ENGLISH" &&
      ["I", "L", "|", "1", "!"].includes(upper) &&
      word.y < height * 0.65
    );
  });

const buildCourseCandidateFromWords = (rawWords = [], height = 1) =>
  normalizeCourseName([
    rawWords
      .filter((word) => {
        const text = String(word.text || "").trim(),
          relativeY = height ? word.y / height : 0;
        return (
          text &&
          relativeY < 0.72 &&
          !isLikelyClassroom(text) &&
          !/^\d{3,5}$/.test(text)
        );
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((word) =>
        /\bENGLISH\s+[lI|1]\b/i.test(word.text)
          ? word.text.replace(/\bENGLISH\s+[lI|1]\b/i, "ENGLISH I")
          : word.text,
      )
      .join(" "),
  ]);

const pickCourseCandidate = (candidates) =>
  candidates
    .map((candidate) => normalizeCourseName([candidate]))
    .filter(Boolean)
    .sort((a, b) => courseCandidateScore(b) - courseCandidateScore(a))[0] ||
  "인식되지 않은 수업";

const prefixCandidateMeta = (candidate) =>
  typeof candidate === "string"
    ? { text: candidate, kind: "unknown", confidence: 0 }
    : {
        text: candidate?.text || "",
        kind: candidate?.kind || "unknown",
        confidence: candidate?.confidence ?? 0,
      };

const scorePrefixCandidate = (candidate) => {
  const { text: rawText, kind, confidence } = prefixCandidateMeta(candidate),
    value = normalizeClassroom(rawText).replace(/\d+/g, "").trim();
  return (
    (/^[\uAC00-\uD7A3]{1,3}$/.test(value) ? 8 : 0) +
    (/^[A-Za-z]$/.test(value) ? 0.5 : 0) -
    (/^[A-Za-z]{2,}$/.test(value) ? 8 : 0) -
    (/\d/.test(value) ? 4 : 0) -
    (/[^A-Za-z\uAC00-\uD7A3]/.test(value) ? 3 : 0) +
    (kind === "color" ? 1.5 : 0) +
    (kind === "scaled" ? 1 : 0) -
    (kind === "inverted" ? 1 : 0) +
    confidence * 2
  );
};

const pickPrefixCandidate = (candidates) =>
  candidates
    .map(prefixCandidateMeta)
    .map((candidate) => ({
      ...candidate,
      text: normalizeClassroom(candidate.text).replace(/\d+/g, "").trim(),
    }))
    .filter((candidate) => candidate.text)
    .sort((a, b) => scorePrefixCandidate(b) - scorePrefixCandidate(a))[0] || "";

const pickNumberCandidate = (candidates) =>
  candidates
    .map((candidate) => String(candidate || "").replace(/\D/g, ""))
    .filter(Boolean)
    .map((candidate) => candidate.slice(-3))
    .find((candidate) => /^\d{3}$/.test(candidate)) || "";

const restoreClassroomPrefix = (room, prefixCandidates, numberCandidates) => {
  const normalized = normalizeClassroom(room),
    prefix = pickPrefixCandidate(prefixCandidates),
    number = pickNumberCandidate([normalized, ...numberCandidates]);
  if (!number) return { classroom: normalized, needsReview: !normalized };
  if (/^[\uAC00-\uD7A3]{1,3}\d{3}$/.test(normalized))
    return {
      classroom: normalized,
      needsReview: false,
      classroomPrefixCandidate: normalized.replace(/\d{3}$/, ""),
    };
  if (/^[A-Za-z]{2,}\d{3}$/.test(normalized))
    return {
      classroom: number,
      needsReview: true,
      classroomPrefixCandidate: "",
    };
  if (/^[\uAC00-\uD7A3]{1,3}$/.test(prefix.text))
    return {
      classroom: `${prefix.text}${number}`,
      needsReview: false,
      classroomPrefixCandidate: prefix.text,
    };
  if (/^\d{4}$/.test(normalized))
    return { classroom: number, needsReview: true, classroomPrefixCandidate: "" };
  if (/^\d{3}$/.test(normalized))
    return { classroom: normalized, needsReview: true, classroomPrefixCandidate: "" };
  return {
    classroom: normalized,
    needsReview: !normalized || /^\d{3,4}$/.test(normalized),
    classroomPrefixCandidate: "",
  };
};

const subjectNormalizationKey = (value) =>
  normalizeCourseName([value]).toUpperCase().trim();

const classroomParts = (value) => {
  const normalized = normalizeClassroom(value),
    match = normalized.match(/^([\uAC00-\uD7A3A-Za-z]{0,10})\s*(\d{3})$/);
  if (match) {
    return {
      normalized,
      prefix: (match[1] || "").trim(),
      number: match[2],
    };
  }
  const trailingNumber = normalized.match(/(\d{3})$/);
  return {
    normalized,
    prefix: normalized.replace(/\d+$/, "").trim(),
    number: trailingNumber?.[1] || "",
  };
};

const scoreResolvedClassroom = (value) => {
  const { prefix, number, normalized } = classroomParts(value);
  return (
    (/^[\uAC00-\uD7A3]{1,3}$/.test(prefix) ? 8 : 0) +
    (/^[A-Za-z]$/.test(prefix) ? 1 : 0) -
    (/^[A-Za-z]{2,}$/.test(prefix) ? 6 : 0) +
    (/^\d{3}$/.test(number) ? 4 : 0) -
    (!normalized ? 6 : 0)
  );
};

const harmonizeClassroomsBySubject = (events) => {
  const subjectRoomMap = new Map();
  for (const event of events) {
    const subjectKey = subjectNormalizationKey(event.courseName),
      room = classroomParts(event.classroom);
    if (!subjectKey || !room.number) continue;
    const roomKey = `${subjectKey}::${room.number}`,
      current = subjectRoomMap.get(roomKey),
      candidate = {
        classroom: room.normalized,
        prefix: room.prefix,
        score: scoreResolvedClassroom(room.normalized),
      };
    if (!current || candidate.score > current.score) {
      subjectRoomMap.set(roomKey, candidate);
    }
  }

  return events.map((event, index) => {
    const subjectKey = subjectNormalizationKey(event.courseName),
      room = classroomParts(event.classroom);
    if (!subjectKey || !room.number) return event;
    const resolved = subjectRoomMap.get(`${subjectKey}::${room.number}`);
    if (!resolved || !/^[\uAC00-\uD7A3]{1,3}$/.test(resolved.prefix)) return event;
    if (room.normalized === resolved.classroom) return event;
    if (room.prefix && /^[\uAC00-\uD7A3]{1,3}$/.test(room.prefix)) return event;

    const nextEvent = {
      ...event,
      classroom: resolved.classroom,
      needsReview: event.needsReview && room.normalized !== resolved.classroom,
      _ocr: event._ocr
        ? {
            ...event._ocr,
            classroom: resolved.classroom,
            needsReview: event.needsReview && room.normalized !== resolved.classroom,
          }
        : event._ocr,
    };
    console.log("Subject classroom harmonization", {
      blockIndex: index,
      subjectKey,
      originalClassroom: event.classroom,
      harmonizedClassroom: resolved.classroom,
      roomNumber: room.number,
    });
    return nextEvent;
  });
};

const pickClassroomEntry = (candidates) =>
  candidates
    .filter(Boolean)
    .map((candidate) => ({
      text: normalizeClassroom(candidate.text || candidate),
      confidence: candidate.confidence ?? 0,
      y: candidate.y ?? 0,
      height: candidate.height ?? 0,
      relativeY: candidate.relativeY ?? 0,
      source: candidate.source || "room-line-unknown",
    }))
    .filter((candidate) => candidate.text)
    .sort((a, b) => classroomCandidateScore(b) - classroomCandidateScore(a))
    .find((candidate) => classroomCandidateScore(candidate) > 1) || null;

const findLikelyRoomLine = (roomVariantResults, roomCanvas, roomOrigin) => {
  const colorResult =
      roomVariantResults.find((result) => result.kind === "color") ||
      roomVariantResults[0],
    line =
      colorResult?.lines
        ?.map((candidate) => ({
          ...candidate,
          relativeY: candidate.y / Math.max(colorResult.height || roomCanvas.height, 1),
        }))
        .sort((a, b) => classroomCandidateScore(b) - classroomCandidateScore(a))[0] ||
      null;
  if (!line) return null;
  return {
    x0: clamp(roomOrigin.x + Math.floor(line.x) - 1, 0, roomOrigin.x + roomCanvas.width - 1),
    y0: clamp(
      roomOrigin.y + Math.floor(line.y - line.height / 2) - 1,
      0,
      roomOrigin.y + roomCanvas.height - 1,
    ),
    x1: clamp(
      roomOrigin.x + Math.ceil(line.x + line.width) + 1,
      roomOrigin.x,
      roomOrigin.x + roomCanvas.width - 1,
    ),
    y1: clamp(
      roomOrigin.y + Math.ceil(line.y + line.height / 2) + 1,
      roomOrigin.y,
      roomOrigin.y + roomCanvas.height - 1,
    ),
  };
};

const classifyBlockText = (
  variantResults,
  roomVariantResults,
  prefixVariantResults,
  numberVariantResults,
  blockIndex,
  blockBounds,
) => {
  const primary = variantResults[0] || { rawLines: [], text: "", lines: [], height: 1 },
    mergedRaw = [];
  variantResults.forEach((result) => {
    result.rawLines.forEach((line) => {
      if (!mergedRaw.includes(line)) mergedRaw.push(line);
    });
  });
  const lines = (primary.lines.length ? primary.lines : variantResults.flatMap((v) => v.lines)).map(
      (line) => ({
        ...line,
        relativeY: primary.height ? line.y / primary.height : 0,
      }),
    ),
    maxHeight = Math.max(...lines.map((line) => line.height), 0),
    classifiedLines = lines.map((line) => {
      const containsDigit = /\d/.test(line.text),
        classification =
          line.relativeY > 0.55 &&
          containsDigit &&
          (isLikelyClassroom(line.text) || line.text.length <= 10)
            ? "classroom"
            : line.relativeY <= 0.72 &&
                line.height >= maxHeight * 0.68 &&
                !(
                  line.relativeY > 0.5 &&
                  containsDigit &&
                  line.text.length <= 12
                )
              ? "course"
              : "other";
      return { ...line, classification };
    }),
    courseCandidates = classifiedLines
      .filter((line) => line.classification === "course")
      .map((line) => line.text),
    courseVariantCandidates = [
      courseCandidates.join(" "),
      ...variantResults.map((result) =>
        buildCourseCandidateFromWords(result.rawWords || [], result.height),
      ),
      ...variantResults.map((result) =>
        result.lines
          .filter((line) => {
            const relativeY = result.height ? line.y / result.height : 0;
            return relativeY < 0.72 && !/\d{3,}/.test(line.text);
          })
          .map((line) =>
            /\bENGLISH\s+[lI|1]\b/i.test(line.text)
              ? line.text.replace(/\bENGLISH\s+[lI|1]\b/i, "ENGLISH I")
              : line.text,
          )
          .join(" "),
      ),
    ],
    classroomCandidates = [
      ...classifiedLines
        .filter((line) => line.classification === "classroom")
        .map((line) => ({
          text: line.text,
          confidence: line.confidence,
          y: line.y,
          height: line.height,
          relativeY: line.relativeY,
          source: "block-line",
        })),
      ...roomVariantResults.flatMap((result) =>
        result.lines.map((line) => ({
          text: line.text,
          confidence: Math.max(result.confidence, line.confidence || 0),
          y: line.y,
          height: line.height,
          relativeY: line.y / Math.max(result.height, 1),
          source: `room-line-${result.kind}`,
        })),
      ),
    ],
    courseName =
      pickCourseCandidate(
        courseVariantCandidates.length
          ? courseVariantCandidates
          : mergedRaw
              .filter((line) => !isLikelyClassroom(line) && !/\d{3,5}/.test(line))
              .slice(0, 2),
      ) || "인식되지 않은 수업",
    classroomEntry = pickClassroomEntry(classroomCandidates),
    classroomCandidate = classroomEntry?.text || "",
    hasVerticalGlyphAfterEnglish = variantResults.some((result) =>
      hasVerticalRomanGlyphAfterEnglish(result.rawWords || [], result.height),
    ),
    finalCourseName =
      courseName === "COLLEGE ENGLISH" && hasVerticalGlyphAfterEnglish
        ? "COLLEGE ENGLISH I"
        : courseName,
    prefixCandidatesDetailed = prefixVariantResults.flatMap((result) =>
      result.rawLines.map((candidate) => ({
        text: normalizeClassroom(candidate).replace(/\d+/g, "").trim(),
        kind: result.kind,
        source: `prefix-${result.kind}`,
        confidence: result.confidence,
        isDerived: false,
        needsReview: false,
      })),
    ),
    prefixScoreTrace = prefixVariantResults.flatMap((result) =>
      result.rawLines.map((candidate) => ({
        candidate,
        score: scorePrefixCandidate(
          {
            text: candidate,
            kind: result.kind,
            confidence: result.confidence,
          },
        ),
      })),
    ),
    restoredClassroom = restoreClassroomPrefix(
      classroomCandidate,
      prefixCandidatesDetailed,
      numberVariantResults.flatMap((result) => result.rawLines),
    ),
    rawRoomCandidates = [
      ...classroomCandidates.map((candidate) => ({
        text: candidate.text,
        source: candidate.source || "room-line-unknown",
        confidence: candidate.confidence ?? 0,
        isDerived: false,
        needsReview: false,
      })),
      ...numberVariantResults.flatMap((result) =>
        result.rawLines.map((candidate) => ({
          text: candidate,
          source: `number-${result.kind}`,
          confidence: result.confidence,
          isDerived: false,
          needsReview: false,
        })),
      ),
    ],
    confidence = Math.max(
      ...variantResults.map((result) => result.confidence || 0),
      courseName === "인식되지 않은 수업" ? 0.35 : 0.6,
    );
  console.log("OCR line classification", {
    blockIndex,
    blockBounds,
    lines: classifiedLines.map((line) => ({
      text: line.text,
      x: line.x,
      y: line.y,
      width: line.width,
      height: line.height,
      relativeY: line.relativeY,
      confidence: line.confidence,
      classification: line.classification,
    })),
    courseCandidates: courseVariantCandidates,
    classroomCandidates: classroomCandidates.map((candidate) => candidate.text),
    finalCourseName,
    finalClassroom: restoredClassroom.classroom,
  });
  console.log("Roman numeral trace", {
    blockIndex,
    rawWords: variantResults[0]?.rawWords || [],
    rawLines: mergedRaw,
    courseCandidates: courseVariantCandidates,
    filteredTokens: courseVariantCandidates.flatMap((line) => line.split(/\s+/)),
    normalizedTokens: finalCourseName.split(/\s+/),
    finalCourseName,
  });
  console.log("Prefix OCR candidates", {
    blockIndex,
    candidates: prefixScoreTrace,
    roomCandidates: roomVariantResults.flatMap((result) => result.rawLines),
    finalClassroom: restoredClassroom.classroom,
  });
  return {
    subject: finalCourseName,
    professor: "",
    classroom: restoredClassroom.classroom,
    confidence,
    needsReview:
      restoredClassroom.needsReview || finalCourseName === "인식되지 않은 수업",
    classroomPrefixCandidate: restoredClassroom.classroomPrefixCandidate || "",
    roomConfidence: classroomEntry?.confidence ?? 0,
    prefixConfidence:
      prefixCandidatesDetailed.find(
        (candidate) =>
          candidate.text === (restoredClassroom.classroomPrefixCandidate || ""),
      )?.confidence ?? 0,
    prefixSource:
      prefixCandidatesDetailed.find(
        (candidate) =>
          candidate.text === (restoredClassroom.classroomPrefixCandidate || ""),
      )?.source || "",
    rawRoomCandidates,
    prefixCandidates: prefixCandidatesDetailed,
    rawText: mergedRaw,
  };
};

const analyzeBlock = async (worker, sourceCanvas, block) => {
  const variants = makeRecognitionVariants(cropCanvas(sourceCanvas, block)),
    roomBlock = {
      x0: block.x0,
      x1: block.x1,
      y0: Math.round(block.y0 + (block.y1 - block.y0 + 1) * 0.55),
      y1: block.y1,
    },
    roomCanvas = cropCanvas(sourceCanvas, roomBlock, 1),
    roomOrigin = {
      x: Math.max(0, roomBlock.x0 - 1),
      y: Math.max(0, roomBlock.y0 - 1),
    },
    roomVariants = makeRecognitionVariants(roomCanvas),
    variantResults = [],
    roomVariantResults = [],
    prefixVariantResults = [],
    numberVariantResults = [];
  let prefixCanvas = cropCanvasRelative(sourceCanvas, roomBlock, 0, 0, 0.28, 1, 1),
    numberCanvas = cropCanvasRelative(sourceCanvas, roomBlock, 0.22, 0, 0.78, 1, 1);
  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: "6",
  });
  for (const variant of variants) {
    const result = await worker.recognize(variant.canvas, {}, { text: true, blocks: true }),
      words = wordsOf(result?.data),
      lines = groupWordsIntoLines(words);
    variantResults.push({
      kind: variant.kind,
      rawWords: words.map((word) => ({
        text: wordText(word),
        x: word.bbox?.x0 || 0,
        y: word.bbox?.y0 || 0,
        width: (word.bbox?.x1 || 0) - (word.bbox?.x0 || 0),
        height: (word.bbox?.y1 || 0) - (word.bbox?.y0 || 0),
        confidence: word.confidence != null ? word.confidence / 100 : 0.5,
      })),
      text: cleanOcrText(result?.data?.text || ""),
      rawLines: cleanOcrText(result?.data?.text || "")
        .split(/\r?\n/)
        .map(removeRepeatedWords)
        .filter(Boolean),
      lines,
      confidence:
        result?.data?.confidence != null ? result.data.confidence / 100 : 0,
      height: variant.canvas.height,
    });
  }
  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: "7",
  });
  for (const variant of roomVariants) {
    const result = await worker.recognize(variant.canvas, {}, { text: true, blocks: true }),
      words = wordsOf(result?.data),
      lines = groupWordsIntoLines(words);
    roomVariantResults.push({
      kind: variant.kind,
      rawWords: words.map((word) => ({
        text: wordText(word),
        x: word.bbox?.x0 || 0,
        y: word.bbox?.y0 || 0,
        width: (word.bbox?.x1 || 0) - (word.bbox?.x0 || 0),
        height: (word.bbox?.y1 || 0) - (word.bbox?.y0 || 0),
        confidence: word.confidence != null ? word.confidence / 100 : 0.5,
      })),
      rawLines: cleanOcrText(result?.data?.text || "")
        .split(/\r?\n/)
        .map(removeRepeatedWords)
        .filter(Boolean),
      lines,
      confidence:
        result?.data?.confidence != null ? result.data.confidence / 100 : 0,
      height: variant.canvas.height,
    });
  }
  const roomLineBlock = findLikelyRoomLine(roomVariantResults, roomCanvas, roomOrigin);
  if (roomLineBlock) {
    prefixCanvas = cropCanvasRelative(sourceCanvas, roomLineBlock, 0, 0, 0.24, 1, 1);
    numberCanvas = cropCanvasRelative(sourceCanvas, roomLineBlock, 0.18, 0, 0.82, 1, 1);
  }
  const prefixVariants = makeRecognitionVariants(prefixCanvas),
    numberVariants = makeRecognitionVariants(numberCanvas);
  await worker.setParameters({
    preserve_interword_spaces: "0",
    tessedit_pageseg_mode: "10",
  });
  for (const variant of prefixVariants) {
    const result = await worker.recognize(variant.canvas, {}, { text: true, blocks: true });
    prefixVariantResults.push({
      kind: variant.kind,
      rawLines: cleanOcrText(result?.data?.text || "")
        .split(/\r?\n/)
        .map(removeRepeatedWords)
        .filter(Boolean),
      confidence:
        result?.data?.confidence != null ? result.data.confidence / 100 : 0,
    });
  }
  await worker.setParameters({
    preserve_interword_spaces: "0",
    tessedit_pageseg_mode: "7",
  });
  for (const variant of numberVariants) {
    const result = await worker.recognize(variant.canvas, {}, { text: true, blocks: true });
    numberVariantResults.push({
      kind: variant.kind,
      rawLines: cleanOcrText(result?.data?.text || "")
        .split(/\r?\n/)
        .map(removeRepeatedWords)
        .filter(Boolean),
      confidence:
        result?.data?.confidence != null ? result.data.confidence / 100 : 0,
    });
  }
  return {
    variantResults,
    roomVariantResults,
    prefixVariantResults,
    numberVariantResults,
  };
};

const createEvent = (block, textInfo, grid, baseTime, pixels, w, index) => {
  const centerX = block.x0 + (block.x1 - block.x0 + 1) / 2,
    columnIndex = clamp(
      Math.round(
        (centerX - grid.mondayColumnLeft - grid.columnWidth / 2) / grid.columnWidth,
      ),
      0,
      4,
    ),
    rowLines = grid.scheduleRowLines || [],
    slotPositions = [];
  for (let rowIndex = 0; rowIndex < rowLines.length - 1; rowIndex += 1) {
    const top = rowLines[rowIndex],
      bottom = rowLines[rowIndex + 1];
    for (let quarter = 0; quarter < 4; quarter += 1) {
      slotPositions.push({
        y: top + ((bottom - top) * quarter) / 4,
        minutes: (timetableStartHour + rowIndex) * 60 + quarter * quarterHour,
      });
    }
  }
  slotPositions.push({
    y: rowLines.at(-1) || grid.lastTimeRowBottom,
    minutes: timetableEndHour * 60,
  });
  const nearestSlot = (y) =>
      slotPositions.reduce(
        (best, slot, slotIndex) =>
          Math.abs(slot.y - y) < Math.abs(best.y - y)
            ? { ...slot, slotIndex }
            : best,
        { ...slotPositions[0], slotIndex: 0 },
      ),
    startSlot = nearestSlot(block.y0),
    endSlot = nearestSlot(block.y1),
    startSlotIndex = startSlot.slotIndex,
    endSlotIndex = endSlot.slotIndex,
    pixelsPer15MinuteSlot =
      (grid.medianGap || grid.rowHeight || 60) / 4,
    rawDurationSlots = Math.round((block.y1 - block.y0 + 1) / pixelsPer15MinuteSlot),
    normalizedDurationSlots =
      Math.abs(rawDurationSlots - 5) <= 1 ? 5 : clamp(rawDurationSlots, 3, 8),
    rawRelativeY = block.y0 - grid.firstTimeRowTop,
    rawSlotIndex = rawRelativeY / pixelsPer15MinuteSlot,
    slotOffset = baseTime?.slotOffset ?? 0,
    finalSlotIndex = Math.round(rawSlotIndex),
    correctedSlotIndex = finalSlotIndex + slotOffset,
    baseStartMinutes = baseTime?.baseMinutes ?? timetableStartHour * 60,
    resultMinutes = baseStartMinutes + correctedSlotIndex * quarterHour,
    snappedStartMinutes = canonicalClassStartMinutes.reduce((best, candidate) =>
      Math.abs(candidate - resultMinutes) < Math.abs(best - resultMinutes)
        ? candidate
        : best,
    canonicalClassStartMinutes[0]);
  let endMinutes = snappedStartMinutes + normalizedDurationSlots * quarterHour;
  const startTime = formatMinutes(quantizeMinutes(snappedStartMinutes)),
    endTime = formatMinutes(quantizeMinutes(endMinutes)),
    relativeTop =
      (block.y0 - grid.firstTimeRowTop) /
      Math.max(1, grid.lastTimeRowBottom - grid.firstTimeRowTop),
    relativeBottom =
      (block.y1 - grid.firstTimeRowTop) /
      Math.max(1, grid.lastTimeRowBottom - grid.firstTimeRowTop),
    boundingBox = {
      x: block.x0,
      y: block.y0,
      width: block.x1 - block.x0 + 1,
      height: block.y1 - block.y0 + 1,
    },
    event = {
      id: `ocr-block-${index + 1}`,
      courseName: textInfo.subject,
      professor: textInfo.professor,
      classroom: textInfo.classroom,
      day: dayNames[columnIndex],
      startTime,
      endTime,
      color: dominantColorHex(pixels, block, w),
      confidence: textInfo.confidence,
      needsReview:
        textInfo.needsReview ||
        textInfo.subject === "인식되지 않은 수업" ||
        textInfo.confidence < 0.5,
      boundingBox,
      rawText: textInfo.rawText || [],
      subject: textInfo.subject,
      weekday: columnIndex,
      start_time: startTime,
      end_time: endTime,
      _ocrRoomMeta: {
        originalClassroom: textInfo.classroom,
        rawRoomCandidates: textInfo.rawRoomCandidates || [],
        prefixCandidates: textInfo.prefixCandidates || [],
        selectedPrefixBeforeHarmonization:
          textInfo.classroomPrefixCandidate || "",
        roomConfidence: textInfo.roomConfidence ?? textInfo.confidence ?? 0,
        prefixConfidence: textInfo.prefixConfidence ?? 0,
        prefixSource: textInfo.prefixSource || "",
        isDerived: false,
      },
      _ocr: null,
    };
  event._ocr = {
    id: event.id,
    courseName: event.courseName,
    professor: event.professor,
    classroom: event.classroom,
    day: event.day,
    startTime: event.startTime,
    endTime: event.endTime,
    color: event.color,
    confidence: event.confidence,
    needsReview: event.needsReview,
    boundingBox,
    rawText: event.rawText,
  };
  console.log("Time mapping debug", {
    timetableTop: grid.timetableTop,
    timetableBottom: grid.timetableBottom,
    headerBottom: grid.headerBottom,
    firstTimeRowTop: grid.firstTimeRowTop,
    blockTop: block.y0,
    blockBottom: block.y1,
    relativeTop,
    relativeBottom,
    startSlotIndex,
    endSlotIndex,
    startTime,
    endTime,
  });
  console.log("Time base debug", {
    firstTimeRowTop: grid.firstTimeRowTop,
    scheduleGridTop: grid.scheduleGridBounds.y,
    firstSlotTime: formatMinutes(baseStartMinutes),
    slotDurationMinutes: quarterHour,
    blockTop: block.y0,
    rawSlotIndex: startSlotIndex,
    mappedStartTime: startTime,
  });
  console.log("Time formula trace", {
    blockIndex: index,
    blockTop: block.y0,
    firstTimeRowTop: grid.firstTimeRowTop,
    scheduleGridTop: grid.scheduleGridBounds.y,
    pixelsPer15Minutes: pixelsPer15MinuteSlot,
    rawRelativeY,
    rawSlotIndex,
    slotOffset,
    finalSlotIndex,
    correctedSlotIndex,
    baseStartMinutes,
    resultMinutes,
    mappedStartTime: startTime,
  });
  console.log(
    `[Time] block=${index} top=${block.y0} bottom=${block.y1} start=${startTime} end=${endTime} gridTop=${grid.scheduleGridBounds.y} gridBottom=${grid.scheduleGridBounds.y + grid.scheduleGridBounds.height}`,
  );
  console.log("Schedule time validation", {
    blockId: event.id,
    day: event.day,
    blockTop: block.y0,
    blockHeight: boundingBox.height,
    startTime,
    endTime,
    durationMinutes: minutes(endTime) - minutes(startTime),
    expectedDurationMinutes: 75,
    isDurationValid: minutes(endTime) - minutes(startTime) === 75,
  });
  console.log("Final event validation", {
    blockIndex: index,
    courseName: event.courseName,
    classroom: event.classroom,
    day: event.day,
    startTime: event.startTime,
    endTime: event.endTime,
    durationMinutes: minutes(event.endTime) - minutes(event.startTime),
    hasRomanNumeral: /\bI\b/.test(event.courseName),
    roomHasPrefix: /^[\uAC00-\uD7A3A-Za-z]/.test(event.classroom),
    needsReview: event.needsReview,
  });
  return event;
};

const detectBlockShells = async (file) => {
  const image = await loadImage(file),
    sourceCanvas = createCanvas(image.naturalWidth, image.naturalHeight),
    ctx = getImageContext(sourceCanvas);
  ctx.drawImage(image, 0, 0);
  const { width: w, height: h } = sourceCanvas,
    pixels = ctx.getImageData(0, 0, w, h).data,
    { background, mask } = buildForegroundMask(pixels, w, h),
    grid = detectGrid(pixels, w, h),
    rawBlocks = mergeNearbyBlocks(connectedComponents(mask, w, h), pixels, w, h)
      .filter(
        (block) =>
          block.x1 >= grid.scheduleGridBounds.x &&
          block.x0 <= grid.scheduleGridBounds.x + grid.scheduleGridBounds.width &&
          block.y1 >= grid.scheduleGridBounds.y &&
          block.y0 <= grid.scheduleGridBounds.y + grid.scheduleGridBounds.height,
      ),
    blocks = rawBlocks
      .flatMap((block) =>
        block.x1 - block.x0 + 1 > grid.columnWidth * 1.4
          ? splitWideComponentByColumns(block, grid, mask, w)
          : [block],
      )
      .filter(
        (block) =>
          block.x1 - block.x0 + 1 > grid.columnWidth * 0.55 &&
          block.y1 - block.y0 + 1 > grid.rowHeight * 0.45,
      )
      .map((block) => ({
        ...block,
        averageColor: averageBlockColor(pixels, block, w),
      }))
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0),
    baseTime = inferBaseStartMinutes(grid, blocks);
  console.log("Detected timetable blocks", {
    count: blocks.length,
    blocks: blocks.map((block, index) => ({
      index,
      x: block.x0,
      y: block.y0,
      width: block.x1 - block.x0 + 1,
      height: block.y1 - block.y0 + 1,
      area: (block.x1 - block.x0 + 1) * (block.y1 - block.y0 + 1),
      averageColor: block.averageColor,
    })),
    background,
    baseTime,
  });
  return {
    sourceCanvas,
    pixels,
    width: w,
    height: h,
    blocks,
    grid,
    background,
    baseTime,
  };
};

export async function recognizeTimetable(file, onProgress) {
  const worker = await createWorker("kor+eng", 1, {
    logger: (event) =>
      event.status === "recognizing text" &&
      onProgress(Math.round((event.progress || 0) * 100)),
  });
  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6",
    });
    const shells = await detectBlockShells(file),
      generatedEvents = [],
      recognizedBlocks = [];
    for (let index = 0; index < shells.blocks.length; index += 1) {
      const block = shells.blocks[index],
        analysis = await analyzeBlock(worker, shells.sourceCanvas, block),
        textInfo = classifyBlockText(
          analysis.variantResults,
          analysis.roomVariantResults,
          analysis.prefixVariantResults,
          analysis.numberVariantResults,
          index,
          {
            x: block.x0,
            y: block.y0,
            width: block.x1 - block.x0 + 1,
            height: block.y1 - block.y0 + 1,
          },
        ),
        event = createEvent(
          block,
          textInfo,
          shells.grid,
          shells.baseTime,
          shells.pixels,
          shells.width,
          index,
        );
      if (textInfo.subject !== "인식되지 않은 수업" || textInfo.classroom)
        recognizedBlocks.push(event._ocr);
      console.log("OCR block result", {
        blockIndex: index,
        boundingBox: event.boundingBox,
        rawText: event.rawText,
        normalizedCourseName: event.courseName,
        normalizedClassroom: event.classroom,
        day: event.day,
        startTime: event.startTime,
        endTime: event.endTime,
        confidence: event.confidence,
      });
      console.log(
        `[OCR] block=${index} course="${event.courseName}" room="${event.classroom}" day=${event.day} time=${event.startTime}-${event.endTime}`,
      );
      generatedEvents.push(event);
    }
    let text = "";
    if (!generatedEvents.length) {
      const fallback = await worker.recognize(file, {}, { text: true });
      text = fallback?.data?.text || "";
      generatedEvents.push(...parseEverytimeText(text));
    }
    const { events: finalEvents, logs: harmonizationLogs } =
      harmonizeRecognizedClassrooms(generatedEvents);
    harmonizationLogs.forEach((entry) =>
      console.log("Subject classroom harmonization", entry),
    );
    finalEvents.forEach((event) => {
      const parsedOriginal = parseFinalClassroom(
          event._ocrRoomMeta?.originalClassroom || event.classroom,
        ),
        parsedFinal = parseFinalClassroom(event.classroom),
        durationMinutes = minutes(event.endTime) - minutes(event.startTime);
      console.log("Final event validation", {
        blockId: event.id,
        day: event.day,
        startTime: event.startTime,
        endTime: event.endTime,
        durationMinutes,
        courseName: event.courseName,
        originalClassroom: event._ocrRoomMeta?.originalClassroom || event.classroom,
        finalClassroom: event.classroom,
        roomNumber: parsedFinal.roomNumber,
        originalPrefix: parsedOriginal.prefix,
        finalPrefix: parsedFinal.prefix,
        prefixSource: event._ocrRoomMeta?.prefixSource || "",
        prefixConfidence: event._ocrRoomMeta?.prefixConfidence ?? 0,
        wasHarmonized: Boolean(event._ocrRoomMeta?.isDerived),
        harmonizationGroupKey: event._ocrRoomMeta?.harmonizationGroupKey || "",
        needsReview: event.needsReview,
      });
    });
    console.log("OCR timetable debug", {
      timetableBounds: shells.grid?.timetableBounds || null,
      detectedBlockCount: shells.blocks.length,
      detectedBlocks: shells.blocks.map((block) => ({
        x: block.x0,
        y: block.y0,
        width: block.x1 - block.x0 + 1,
        height: block.y1 - block.y0 + 1,
        averageColor: block.averageColor,
      })),
      recognizedBlockCount: recognizedBlocks.length,
      recognizedBlocks,
      generatedEventCount: finalEvents.length,
      generatedEvents: finalEvents.map((event) => event._ocr || event),
    });
    return { text, rows: finalEvents };
  } catch (error) {
    console.error("OCR language/model error", error);
    throw error;
  } finally {
    await worker.terminate();
  }
}
