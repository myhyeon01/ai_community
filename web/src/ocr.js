import { createWorker } from "tesseract.js";
import {
  cleanOcrText,
  isLikelyClassroom,
  normalizeClassroom,
  normalizeCourseName,
  removeRepeatedWords,
} from "./ocr-normalize";
import { areSimilarCourseColors, parseHexColor } from "./ocr-color";
import { durationSlotsFromPixels, inferGridStartHour } from "./ocr-time";

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
        clamp(Math.round(r / 16) * 16, 0, 255),
        clamp(Math.round(g / 16) * 16, 0, 255),
        clamp(Math.round(b / 16) * 16, 0, 255),
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
    backgroundHsv = rgbToHsv(background.r, background.g, background.b),
    mask = new Uint8Array(w * h);
  for (let y = Math.floor(h * 0.08); y < h * 0.97; y++)
    for (let x = Math.floor(w * 0.08); x < Math.floor(w * 0.98); x++) {
      const i = (y * w + x) * 4,
        r = pixels[i],
        g = pixels[i + 1],
        b = pixels[i + 2],
        hsv = rgbToHsv(r, g, b),
        distance = colorDistance({ r, g, b }, background),
        valueDelta = Math.abs(hsv.v - backgroundHsv.v),
        paleColoredFill =
          distance > 24 &&
          hsv.s > 0.045 &&
          (valueDelta > 0.015 || hsv.s > 0.07),
        foreground =
          (distance > 30 &&
            ((hsv.s > 0.12 && hsv.v > 0.3) ||
              (distance > 45 && hsv.v > 0.22 && hsv.s > 0.03) ||
              hsv.s > 0.22)) ||
          paleColoredFill;
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
  return `#${rgb
    .map((value) => clamp(value, 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
};

const detectColoredColumnRuns = (pixels, w, h, grid, background) => {
  const runs = [],
    backgroundHsv = rgbToHsv(background.r, background.g, background.b),
    scheduleTop = clamp(Math.round(grid.firstTimeRowTop), 0, h - 1),
    scheduleBottom = clamp(Math.round(grid.lastTimeRowBottom), scheduleTop + 1, h - 1),
    minimumHeight = Math.max(10, (grid.rowHeight || grid.medianGap || 60) * 0.25);

  for (let column = 0; column < 5; column += 1) {
    const columnLeft = grid.mondayColumnLeft + grid.columnWidth * column,
      columnRight = columnLeft + grid.columnWidth,
      x0 = clamp(Math.round(columnLeft + grid.columnWidth * 0.08), 0, w - 1),
      x1 = clamp(Math.round(columnRight - grid.columnWidth * 0.08), x0 + 1, w - 1),
      xStep = Math.max(2, Math.round((x1 - x0) / 36)),
      activeRows = [];

    for (let y = scheduleTop; y <= scheduleBottom; y += 1) {
      let coloredCount = 0,
        sampledCount = 0,
        rowColorBuckets = new Map();
      for (let x = x0; x <= x1; x += xStep) {
        const pixelIndex = (y * w + x) * 4,
          color = {
            r: pixels[pixelIndex],
            g: pixels[pixelIndex + 1],
            b: pixels[pixelIndex + 2],
          },
          hsv = rgbToHsv(color.r, color.g, color.b),
          distance = colorDistance(color, background),
          valueDelta = Math.abs(hsv.v - backgroundHsv.v),
          colored =
            distance > 20 &&
            hsv.s > 0.035 &&
            (hsv.s > 0.065 || valueDelta > 0.018);
        sampledCount += 1;
        if (!colored) continue;
        coloredCount += 1;
        const colorKey = [color.r, color.g, color.b]
          .map((value) => clamp(Math.round(value / 8) * 8, 0, 255))
          .join(",");
        rowColorBuckets.set(colorKey, (rowColorBuckets.get(colorKey) || 0) + 1);
      }
      // 글자가 블록 폭 대부분을 덮는 작은 캡처에서도 배경색 일부만 남아 있으면
      // 같은 채색 행으로 본다. 무채색 격자선은 위의 채도 조건에서 이미 제외된다.
      if (coloredCount / Math.max(sampledCount, 1) < 0.06) continue;
      const rowColor = ([...rowColorBuckets.entries()]
        .sort((left, right) => right[1] - left[1])[0]?.[0] || "0,0,0")
        .split(",")
        .map(Number);
      activeRows.push({
        y,
        color: {
          r: rowColor[0],
          g: rowColor[1],
          b: rowColor[2],
        },
      });
    }

    let current = null;
    const finish = () => {
      if (!current || current.y1 - current.y0 + 1 < minimumHeight) return;
      runs.push({
        x0: clamp(Math.round(columnLeft + 1), 0, w - 1),
        x1: clamp(Math.round(columnRight - 1), 0, w - 1),
        y0: current.y0,
        y1: current.y1,
        area:
          (Math.round(columnRight - 1) - Math.round(columnLeft + 1) + 1)
          * (current.y1 - current.y0 + 1),
        averageColor: current.averageColor,
      });
    };
    activeRows.forEach((row) => {
      if (
        !current ||
        row.y - current.y1 > Math.max(4, Math.round(minimumHeight * 0.28))
      ) {
        finish();
        current = { y0: row.y, y1: row.y, averageColor: row.color, count: 1 };
        return;
      }
      current.y1 = row.y;
      current.averageColor = {
        r: Math.round((current.averageColor.r * current.count + row.color.r) / (current.count + 1)),
        g: Math.round((current.averageColor.g * current.count + row.color.g) / (current.count + 1)),
        b: Math.round((current.averageColor.b * current.count + row.color.b) / (current.count + 1)),
      };
      current.count += 1;
    });
    finish();
  }
  return runs.sort((left, right) => left.y0 - right.y0 || left.x0 - right.x0);
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

const otsuThreshold = (rgbaPixels) => {
  const histogram = new Uint32Array(256);
  let total = 0;
  for (let index = 0; index < rgbaPixels.length; index += 4) {
    histogram[rgbaPixels[index]] += 1;
    total += 1;
  }
  let weightedTotal = 0;
  for (let value = 0; value < 256; value += 1) {
    weightedTotal += value * histogram[value];
  }
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let maximumVariance = -1;
  let selected = 150;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight
      * foregroundWeight
      * (backgroundMean - foregroundMean) ** 2;
    if (variance > maximumVariance) {
      maximumVariance = variance;
      selected = value;
    }
  }
  return clamp(selected, 70, 205);
};

const makeBackgroundDifferenceCanvas = (canvas) => {
  const output = createCanvas(canvas.width, canvas.height),
    context = getImageContext(output);
  context.drawImage(canvas, 0, 0);
  const imageData = context.getImageData(0, 0, output.width, output.height),
    pixels = imageData.data,
    buckets = new Map();
  for (let index = 0; index < pixels.length; index += 16) {
    const color = [pixels[index], pixels[index + 1], pixels[index + 2]].map(
      (value) => Math.round(value / 12) * 12,
    ),
      key = color.join(",");
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const background = ([...buckets.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
      || "255,255,255")
    .split(",")
    .map(Number),
    sampledDistances = [];
  for (let index = 0; index < pixels.length; index += 32) {
    sampledDistances.push(
      Math.sqrt(
        (pixels[index] - background[0]) ** 2
        + (pixels[index + 1] - background[1]) ** 2
        + (pixels[index + 2] - background[2]) ** 2,
      ),
    );
  }
  sampledDistances.sort((left, right) => left - right);
  const backgroundNoise = sampledDistances[Math.floor(sampledDistances.length * 0.55)] || 0,
    differenceThreshold = clamp(backgroundNoise * 2.8, 22, 46);
  for (let index = 0; index < pixels.length; index += 4) {
    const distance = Math.sqrt(
        (pixels[index] - background[0]) ** 2
        + (pixels[index + 1] - background[1]) ** 2
        + (pixels[index + 2] - background[2]) ** 2,
      ),
      value = distance > differenceThreshold ? 0 : 255;
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
  }
  context.putImageData(imageData, 0, 0);
  return output;
};

const calibrateTimeAxis = async (worker, sourceCanvas, grid) => {
  const rowLines = (grid.scheduleRowLines || []).filter(
    (value) => value >= 0 && value < sourceCanvas.height,
  );
  if (rowLines.length < 2 || grid.mondayColumnLeft < 16) return null;

  const cropTop = Math.max(
      0,
      Math.round(grid.firstTimeRowTop - (grid.rowHeight || grid.medianGap || 60) * 0.25),
    ),
    cropBottom = Math.min(
      sourceCanvas.height - 1,
      Math.round(grid.lastTimeRowBottom + (grid.rowHeight || grid.medianGap || 60) * 0.15),
    ),
    strip = cropCanvas(
      sourceCanvas,
      {
        x0: 0,
        y0: cropTop,
        x1: Math.max(1, Math.round(grid.mondayColumnLeft - 2)),
        y1: cropBottom,
      },
      0,
    ),
    scale = 3,
    enlarged = createCanvas(strip.width * scale, strip.height * scale),
    enlargedContext = getImageContext(enlarged);
  enlargedContext.imageSmoothingEnabled = false;
  enlargedContext.drawImage(strip, 0, 0, enlarged.width, enlarged.height);

  await worker.setParameters({
    preserve_interword_spaces: "0",
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "11",
  });
  const result = await worker.recognize(enlarged, {}, { text: true, blocks: true }),
    tolerance = Math.max(8, (grid.rowHeight || grid.medianGap || 60) * 0.48),
    samples = wordsOf(result?.data)
      .map((word) => {
        const digits = wordText(word).replace(/\D/g, "");
        if (!/^\d{1,2}$/.test(digits) || !word?.bbox) return null;
        const hour = Number(digits);
        if (hour < 1 || hour > 24) return null;
        const sourceY = cropTop + (word.bbox.y0 + word.bbox.y1) / (2 * scale);
        const nearest = rowLines.reduce(
          (best, y, rowIndex) =>
            Math.abs(y - sourceY) < best.distance
              ? { rowIndex, y, distance: Math.abs(y - sourceY) }
              : best,
          { rowIndex: -1, y: 0, distance: Number.POSITIVE_INFINITY },
        );
        if (nearest.rowIndex < 0 || nearest.distance > tolerance) return null;
        return {
          hour,
          rowIndex: nearest.rowIndex,
          sourceY,
          lineY: nearest.y,
          confidence: word.confidence != null ? word.confidence / 100 : 0,
        };
      })
      .filter(Boolean),
    startHour = samples.length >= 2 ? inferGridStartHour(samples) : null,
    orderedSamples = [...samples].sort((left, right) => left.sourceY - right.sourceY),
    distinctSamples = [],
    unwrappedSamples = [],
    pixelSlopes = [],
    sequentialGaps = [];
  orderedSamples.forEach((sample) => {
    const previous = distinctSamples.at(-1),
      duplicateTolerance = Math.max(10, (grid.rowHeight || grid.medianGap || 60) * 0.25);
    if (previous && Math.abs(previous.sourceY - sample.sourceY) < duplicateTolerance) {
      if (sample.confidence > previous.confidence) distinctSamples[distinctSamples.length - 1] = sample;
    } else {
      distinctSamples.push(sample);
    }
  });
  distinctSamples.forEach((sample) => {
    let absoluteHour = sample.hour;
    const previousHour = unwrappedSamples.at(-1)?.absoluteHour;
    while (previousHour != null && absoluteHour <= previousHour) absoluteHour += 12;
    if (previousHour != null && absoluteHour - previousHour > 4) return;
    unwrappedSamples.push({ ...sample, absoluteHour });
  });
  for (let index = 1; index < distinctSamples.length; index += 1) {
    const previous = distinctSamples[index - 1],
      current = distinctSamples[index],
      expectedHour = previous.hour === 12 ? 1 : previous.hour + 1;
    if (current.hour === expectedHour) sequentialGaps.push(current.sourceY - previous.sourceY);
  }
  for (let left = 0; left < unwrappedSamples.length; left += 1) {
    for (let right = left + 1; right < unwrappedSamples.length; right += 1) {
      const hourDelta = unwrappedSamples[right].absoluteHour
          - unwrappedSamples[left].absoluteHour,
        pixelDelta = unwrappedSamples[right].sourceY - unwrappedSamples[left].sourceY;
      if (hourDelta > 0 && hourDelta <= 6 && pixelDelta > 0) {
        pixelSlopes.push(pixelDelta / hourDelta);
      }
    }
  }
  const pixelsPerHour = sequentialGaps.length >= 2
    ? median(sequentialGaps)
    : pixelSlopes.length
      ? median(pixelSlopes)
      : null,
    anchorSample = unwrappedSamples
      .filter((sample) => sample.lineY != null)
      .sort((left, right) => right.confidence - left.confidence)[0] || null;

  console.log("OCR time-axis calibration", {
    rawText: result?.data?.text || "",
    samples,
    distinctSamples,
    unwrappedSamples,
    sequentialGaps,
    startHour,
    pixelsPerHour,
    anchorSample,
  });
  return startHour == null
    ? null
    : {
        baseMinutes: startHour * 60,
        slotOffset: 0,
        calibrated: true,
        samples,
        pixelsPerHour,
        anchorY: anchorSample?.lineY,
        anchorMinutes: anchorSample?.absoluteHour * 60,
      };
};

const makeRecognitionVariants = (canvas) => {
  const variants = [{ kind: "color", canvas }];
  const enlarged = createCanvas(canvas.width * 4, canvas.height * 4),
    ectx = getImageContext(enlarged);
  ectx.imageSmoothingEnabled = false;
  ectx.drawImage(canvas, 0, 0, enlarged.width, enlarged.height);
  variants.push({ kind: "scaled", canvas: enlarged });
  variants.push({
    kind: "background-difference",
    canvas: makeBackgroundDifferenceCanvas(enlarged),
  });

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
    thresholdPixels = tData.data,
    adaptiveThreshold = otsuThreshold(thresholdPixels);
  for (let i = 0; i < thresholdPixels.length; i += 4) {
    const value = thresholdPixels[i] > adaptiveThreshold ? 255 : 0;
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
    hasDigits = /(?:[A-Za-z]\d{2,3}|\d{3,5})/.test(text),
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
    upper = text.toUpperCase(),
    koreanCount = (text.match(/[\uAC00-\uD7A3]/g) || []).length,
    latinWords = text.match(/[A-Za-z]{3,}/g) || [],
    longestCompactKoreanWord = Math.max(
      0,
      ...text.split(/\s+/).map((token) =>
        /^[\uAC00-\uD7A3]+$/.test(token) ? token.length : 0,
      ),
    ),
    scoreTextWithoutCourseSequence = text.replace(/\(\d{1,2}\)/g, ""),
    digitCount = (scoreTextWithoutCourseSequence.match(/\d/g) || []).length,
    numericTokens = (scoreTextWithoutCourseSequence.match(/(?:^|\s)\d+(?=\s|$)/g) || []).length,
    mixedScriptNoise = koreanCount > 0 && latinWords.length > 0 && digitCount > 0,
    trailingShortLatinNoise = koreanCount > 0 && /\s+[A-Za-z]{1,2}$/.test(text),
    shortLatinOnly =
      !koreanCount &&
      text.split(/\s+/).filter(Boolean).every((token) => /^[A-Za-z|I]{1,2}$/.test(token));
  return (
    (upper.includes("COLLEGE") ? 2 : 0) +
    (upper.includes("ENGLISH") ? 2 : 0) +
    (/\bI\b/.test(upper) ? 1 : 0) -
    (/\d{3,}/.test(text) ? 3 : 0) -
    digitCount * 1.1 -
    numericTokens * 1.25 -
    (mixedScriptNoise ? 3 : 0) -
    (trailingShortLatinNoise ? 3 : 0) -
    (/^[0-9]/.test(text) ? 2 : 0) +
    Math.min(koreanCount, 12) * 0.7 +
    (longestCompactKoreanWord >= 4 ? 1.4 : 0) +
    Math.min(longestCompactKoreanWord, 12) * 0.06 +
    Math.min(latinWords.join("").length, 24) * 0.12 +
    Math.min(text.length, 36) * 0.035 -
    (shortLatinOnly ? 4 : 0) -
    (/[^\uAC00-\uD7A3A-Za-z0-9()\s.,+&/-]/.test(text) ? 2 : 0) -
    (isLikelyClassroom(text) ? 6 : 0)
  );
};

const courseKeysSimilar = (left, right) => {
  const leftCompact = left.replace(/\s+/g, ""),
    rightCompact = right.replace(/\s+/g, "");
  if (Math.min(leftCompact.length, rightCompact.length) >= 2) {
    if (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact)) return true;
  }
  const meaningfulTokens = (value) =>
      value
        .split(/\s+/)
        .map((token) => token.replace(/[^\uAC00-\uD7A3A-Z]/g, ""))
        .filter((token) => token.length >= 3),
    leftTokens = new Set(meaningfulTokens(left)),
    rightTokens = new Set(meaningfulTokens(right)),
    smallerSize = Math.min(leftTokens.size, rightTokens.size);
  if (!smallerSize) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared >= 1 && shared / smallerSize >= 0.6;
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
      .filter((word, wordIndex, words) => {
        const text = String(word.text || "").trim(),
          relativeY = height ? word.y / height : 0,
          nextText = String(words[wordIndex + 1]?.text || "").trim(),
          isRoomPrefixBeforeNumber =
            /^[\uAC00-\uD7A3A-Za-z]{1,3}$/.test(text) &&
            /^(?:[A-Za-z]\d{2,3}|\d{3,4})$/.test(nextText);
        return (
          text &&
          relativeY < 0.72 &&
          !isRoomPrefixBeforeNumber &&
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
    (/^[\uAC00-\uD7A3]$/.test(value) ? 2 : 0) -
    (/^[\uAC00-\uD7A3]{2,3}$/.test(value) ? 0.75 : 0) +
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
    .map(
      (candidate) =>
        String(candidate || "").match(/([A-Za-z]\d{2,3}|\d{3,4})(?!.*[A-Za-z0-9])/)?.[1]
        || "",
    )
    .filter(Boolean)
    .find((candidate) => /^(?:[A-Za-z]\d{2,3}|\d{3,4})$/.test(candidate)) || "";

const restoreClassroomPrefix = (room, prefixCandidates, numberCandidates) => {
  const normalized = normalizeClassroom(room),
    prefix = pickPrefixCandidate(prefixCandidates),
    number = pickNumberCandidate([normalized, ...numberCandidates]);
  if (!number) return { classroom: "", needsReview: true };
  const directKoreanMatch = normalized.match(
    /^([\uAC00-\uD7A3]{1,3})(?:[A-Za-z]\d{2,3}|\d{3,4})$/,
  );
  if (directKoreanMatch && directKoreanMatch[1].length === 1)
    return {
      classroom: normalized,
      needsReview: false,
      classroomPrefixCandidate: normalized.replace(/(?:[A-Za-z]\d{2,3}|\d{3,4})$/, ""),
    };
  if (directKoreanMatch && /^[\uAC00-\uD7A3]$/.test(prefix.text))
    return {
      classroom: `${prefix.text}${number}`,
      needsReview: false,
      classroomPrefixCandidate: prefix.text,
    };
  if (directKoreanMatch)
    return {
      classroom: normalized,
      needsReview: true,
      classroomPrefixCandidate: directKoreanMatch[1],
    };
  if (/^[A-Za-z]+\d{2,4}$/.test(normalized))
    return {
      classroom: normalized,
      needsReview: true,
      classroomPrefixCandidate: "",
    };
  if (/^(?:[A-Za-z]\d{2,3}|\d{3,4})$/.test(normalized))
    return { classroom: normalized, needsReview: true, classroomPrefixCandidate: "" };
  if (/^[\uAC00-\uD7A3]{1,3}$/.test(prefix.text))
    return {
      classroom: `${prefix.text}${number}`,
      needsReview: false,
      classroomPrefixCandidate: prefix.text,
    };
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
    match = normalized.match(
      /^([\uAC00-\uD7A3A-Za-z]{0,10}?)\s*((?:[A-Za-z]\d{2,3})|(?:\d{3,4}))$/,
    );
  if (match) {
    return {
      normalized,
      prefix: (match[1] || "").trim(),
      number: match[2],
    };
  }
  const trailingNumber = normalized.match(/([A-Za-z]\d{2,3}|\d{3,4})$/);
  return {
    normalized,
    prefix: normalized.replace(/(?:[A-Za-z]\d{2,3}|\d{3,4})$/, "").trim(),
    number: trailingNumber?.[1] || "",
  };
};

const scoreResolvedClassroom = (value) => {
  const { prefix, number, normalized } = classroomParts(value);
  return (
    (/^[\uAC00-\uD7A3]{1,3}$/.test(prefix) ? 8 : 0) +
    (/^[\uAC00-\uD7A3]$/.test(prefix) ? 2 : 0) -
    (/^[\uAC00-\uD7A3]{2,3}$/.test(prefix) ? 0.75 : 0) +
    (/^[A-Za-z]$/.test(prefix) ? 1 : 0) -
    (/^[A-Za-z]{2,}$/.test(prefix) ? 6 : 0) +
    (/^(?:[A-Za-z]\d{2,3}|\d{3,4})$/.test(number) ? 4 : 0) -
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

const resolveColorGroupClassroom = (groupedEvents) => {
  const entries = groupedEvents.flatMap((event, eventIndex) => [
      {
        text: event.classroom,
        eventIndex,
        confidence: event._ocrRoomMeta?.roomConfidence ?? event.confidence ?? 0,
        primary: true,
      },
      ...(event._ocrRoomMeta?.rawRoomCandidates || []).map((candidate) => ({
        text: candidate.text,
        eventIndex,
        confidence: candidate.confidence ?? 0,
        primary: false,
      })),
    ])
    .map((entry) => ({ ...entry, room: classroomParts(entry.text) }))
    .filter((entry) => entry.room.number),
    threeDigitNumbers = new Set(
      entries
        .map((entry) => entry.room.number)
        .filter((number) => /^\d{3}$/.test(number)),
    ),
    normalizedEntries = entries.map((entry) => {
      const number = /^\d{4}$/.test(entry.room.number) &&
          threeDigitNumbers.has(entry.room.number.slice(-3))
        ? entry.room.number.slice(-3)
        : entry.room.number;
      return { ...entry, number };
    }),
    numberStats = new Map();
  normalizedEntries.forEach((entry) => {
    const current = numberStats.get(entry.number) || {
      number: entry.number,
      events: new Set(),
      count: 0,
      confidence: 0,
      primaryCount: 0,
    };
    current.events.add(entry.eventIndex);
    current.count += 1;
    current.confidence += entry.confidence;
    if (entry.primary) current.primaryCount += 1;
    numberStats.set(entry.number, current);
  });
  const canonicalNumber = [...numberStats.values()].sort(
    (left, right) =>
      right.events.size * 10 + right.primaryCount * 3 + right.count + right.confidence
      - (left.events.size * 10 + left.primaryCount * 3 + left.count + left.confidence),
  )[0]?.number;
  if (!canonicalNumber) return "";

  const nearbyNumber = (candidate) => {
      if (candidate === canonicalNumber) return true;
      if (candidate.length !== canonicalNumber.length) return false;
      let differences = 0;
      for (let index = 0; index < candidate.length; index += 1) {
        if (candidate[index] !== canonicalNumber[index]) differences += 1;
      }
      return differences <= 1;
    },
    prefixStats = new Map(),
    knownCampusPrefixes = new Set(["공", "쉐", "영"]),
    hasLatinA = normalizedEntries.some(
      (entry) => entry.room.prefix.toUpperCase() === "A" && nearbyNumber(entry.number),
    );
  normalizedEntries
    .filter((entry) => entry.room.prefix && nearbyNumber(entry.number))
    .forEach((entry) => {
      const prefix = entry.room.prefix,
        current = prefixStats.get(prefix) || {
          prefix,
          events: new Set(),
          confidence: 0,
          exactCount: 0,
          primaryCount: 0,
        };
      current.events.add(entry.eventIndex);
      current.confidence += entry.confidence;
      if (entry.number === canonicalNumber) current.exactCount += 1;
      if (entry.primary) current.primaryCount += 1;
      prefixStats.set(prefix, current);
    });
  const canonicalPrefix = [...prefixStats.values()].sort((left, right) => {
    const score = (candidate) =>
      candidate.events.size * 5 +
      candidate.exactCount * 2 +
      candidate.primaryCount +
      candidate.confidence +
      (knownCampusPrefixes.has(candidate.prefix) ? 6 : 0) +
      (/^[A-Za-z]$/.test(candidate.prefix) ? 2 : 0) -
      (candidate.prefix === "스" && hasLatinA ? 7 : 0);
    return score(right) - score(left);
  })[0]?.prefix;
  return `${canonicalPrefix || ""}${canonicalNumber}`;
};

const harmonizeEventsByColor = (events) => {
  const colorGroups = [];
  events.forEach((event, index) => {
    const rgb = parseHexColor(event.color);
    const group = rgb
      ? colorGroups.find((candidate) =>
          areSimilarCourseColors(candidate.anchorColor, rgb),
        )
      : null;
    if (group) group.indices.push(index);
    else colorGroups.push({ anchorColor: rgb, indices: [index] });
  });

  const resolvedByIndex = new Map();
  for (const group of colorGroups) {
    const groupedEvents = group.indices.map((index) => events[index]),
      subjectStats = [];
    groupedEvents.forEach((event, eventIndex) => {
      const candidates = [
        event.courseName || event.subject || "",
        ...(event._ocrCourseCandidates || []),
      ],
        eventCandidates = new Map();
      candidates.forEach((candidate) => {
        const subject = normalizeCourseName([candidate]),
          key = subjectNormalizationKey(subject),
          quality = courseCandidateScore(subject);
        if (
          !subject ||
          !key ||
          subject === "인식되지 않은 수업" ||
          quality < -1
        ) return;
        const current = eventCandidates.get(key);
        if (!current || quality > current.quality) {
          eventCandidates.set(key, { subject, quality });
        }
      });
      eventCandidates.forEach(({ subject, quality }, key) => {
        const compactKey = key.replace(/\s+/g, ""),
          current = subjectStats.find((stat) => {
            return courseKeysSimilar(stat.key, key);
          }) || {
            subject,
            key,
            compactKey,
            count: 0,
            confidence: 0,
            quality,
            eventIndexes: new Set(),
          },
          isNewEvent = !current.eventIndexes.has(eventIndex),
          currentRepresentativeScore =
            current.quality + Math.min(current.subject.length, 36) * 0.12,
          candidateRepresentativeScore =
            quality + Math.min(subject.length, 36) * 0.12;
        if (!subjectStats.includes(current)) subjectStats.push(current);
        current.eventIndexes.add(eventIndex);
        current.count = current.eventIndexes.size;
        if (isNewEvent) current.confidence += event.confidence || 0;
        if (candidateRepresentativeScore > currentRepresentativeScore) {
          current.subject = subject;
          current.key = key;
          current.compactKey = compactKey;
          current.quality = quality;
        } else {
          current.quality = Math.max(current.quality, quality);
        }
      });
    });
    let canonicalSubject = [...subjectStats].sort(
      (left, right) =>
        right.count * 6 + right.confidence * 2 + right.quality
        - (left.count * 6 + left.confidence * 2 + left.quality),
      )[0]?.subject;
    const canonicalBase = canonicalSubject?.replace(/\(\d{1,2}\)$/, "").trim(),
      sequencedCandidate = groupedEvents
        .flatMap((event) => [
          event.courseName || event.subject || "",
          ...(event._ocrCourseCandidates || []),
        ])
        .map((candidate) => normalizeCourseName([candidate]))
        .find(
          (candidate) =>
            /\(\d{1,2}\)$/.test(candidate) &&
            candidate.replace(/\(\d{1,2}\)$/, "").trim() === canonicalBase,
        );
    if (sequencedCandidate) canonicalSubject = sequencedCandidate;
    const canonicalRoom = resolveColorGroupClassroom(groupedEvents);

    group.indices.forEach((index) => {
      const event = events[index],
        courseName = canonicalSubject || event.courseName,
        classroom = canonicalRoom || event.classroom,
        room = classroomParts(classroom);
      resolvedByIndex.set(index, {
        ...event,
        courseName,
        subject: courseName,
        classroom,
        needsReview:
          !courseName ||
          courseName === "인식되지 않은 수업" ||
          !classroom ||
          scoreResolvedClassroom(classroom) < 8,
        _ocrRoomMeta: {
          ...(event._ocrRoomMeta || {}),
          finalPrefix: room.prefix,
          harmonizationGroupKey: event.color || "",
          wasHarmonized:
            classroom !== event.classroom || courseName !== event.courseName,
        },
        _ocr: event._ocr
          ? {
              ...event._ocr,
              courseName,
              classroom,
              needsReview:
                !courseName ||
                courseName === "인식되지 않은 수업" ||
                !classroom ||
                scoreResolvedClassroom(classroom) < 8,
            }
          : event._ocr,
      });
    });
  }
  return events.map((event, index) => resolvedByIndex.get(index) || event);
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
          containsDigit &&
          (isLikelyClassroom(line.text) ||
            /^[\uAC00-\uD7A3A-Za-z]{0,3}\s*(?:[A-Za-z]\d{2,3}|\d{3,4})$/.test(
              normalizeClassroom(line.text),
            ))
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
      ...variantResults.flatMap((result) => {
        const plausibleLines = result.rawLines.filter(
          (line) =>
            line.length >= 2 &&
            !isLikelyClassroom(line) &&
            !/(?:[A-Za-z]\d{2,3}|\d{3,4})/.test(line),
        );
        return plausibleLines.flatMap((line, index) => [
          line,
          plausibleLines.slice(index, index + 2).join(" "),
          plausibleLines.slice(index, index + 3).join(" "),
        ]);
      }),
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
      ...variantResults.flatMap((result) =>
        result.rawLines
          .filter((line) => /(?:[A-Za-z]\d{2,3}|\d{3,4})/.test(line))
          .map((line) => ({
            text: line,
            confidence: result.confidence,
            y: result.height * 0.72,
            height: 0,
            relativeY: 0.72,
            source: `block-raw-${result.kind}`,
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
      [
        ...roomVariantResults.flatMap((result) => result.rawLines),
        ...numberVariantResults.flatMap((result) => result.rawLines),
      ],
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
    courseCandidates: courseVariantCandidates,
  };
};

const analyzeBlock = async (worker, sourceCanvas, block) => {
  const variants = makeRecognitionVariants(cropCanvas(sourceCanvas, block)),
    roomBlock = {
      x0: block.x0,
      x1: block.x1,
      y0: Math.round(block.y0 + (block.y1 - block.y0 + 1) * 0.3),
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
  const initialCourseScore = Math.max(
    -10,
    ...variantResults.flatMap((result) =>
      result.rawLines
        .filter((line) => !isLikelyClassroom(line))
        .map((line) => courseCandidateScore(line)),
    ),
  );
  if (initialCourseScore < 1.5) {
    const fullBlockCanvas = cropCanvas(sourceCanvas, block),
      courseTopCanvas = cropCanvasRelative(
        fullBlockCanvas,
        { x0: 0, y0: 0, x1: fullBlockCanvas.width - 1, y1: fullBlockCanvas.height - 1 },
        0,
        0,
        1,
        0.68,
        0,
      ),
      courseTopVariants = makeRecognitionVariants(courseTopCanvas).filter(
        (variant) => ["scaled", "background-difference"].includes(variant.kind),
      );
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6",
    });
    for (const variant of courseTopVariants) {
      const result = await worker.recognize(variant.canvas, {}, { text: true, blocks: true }),
        words = wordsOf(result?.data),
        lines = groupWordsIntoLines(words);
      variantResults.push({
        kind: `course-top-${variant.kind}`,
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
        confidence: result?.data?.confidence != null ? result.data.confidence / 100 : 0,
        height: variant.canvas.height,
      });
    }
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
      (baseTime?.pixelsPerHour || grid.rowHeight || grid.medianGap || 60) / 4,
    rawDurationSlots = Math.round((block.y1 - block.y0 + 1) / pixelsPer15MinuteSlot),
    normalizedDurationSlots = durationSlotsFromPixels(
      block.y1 - block.y0 + 1,
      pixelsPer15MinuteSlot,
    ),
    rawRelativeY = block.y0 - grid.firstTimeRowTop,
    rawSlotIndex = rawRelativeY / pixelsPer15MinuteSlot,
    slotOffset = baseTime?.slotOffset ?? 0,
    finalSlotIndex = Math.round(rawSlotIndex),
    correctedSlotIndex = finalSlotIndex + slotOffset,
    baseStartMinutes = baseTime?.baseMinutes ?? timetableStartHour * 60,
    resultMinutes =
      baseTime?.calibrated && baseTime?.anchorY != null && baseTime?.anchorMinutes != null
        ? baseTime.anchorMinutes
          + ((block.y0 - baseTime.anchorY) / Math.max(baseTime.pixelsPerHour, 1)) * 60
        : baseStartMinutes + correctedSlotIndex * quarterHour,
    mappedStartMinutes = baseTime?.calibrated
      ? quantizeMinutes(resultMinutes)
      : canonicalClassStartMinutes.reduce((best, candidate) =>
          Math.abs(candidate - resultMinutes) < Math.abs(best - resultMinutes)
            ? candidate
            : best,
        canonicalClassStartMinutes[0]);
  let endMinutes = mappedStartMinutes + normalizedDurationSlots * quarterHour;
  const startTime = formatMinutes(quantizeMinutes(mappedStartMinutes)),
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
      _ocrCourseCandidates: textInfo.courseCandidates || [],
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
    expectedDurationMinutes: normalizedDurationSlots * quarterHour,
    isDurationValid:
      minutes(endTime) - minutes(startTime) ===
      normalizedDurationSlots * quarterHour,
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
    componentBlocks = mergeNearbyBlocks(connectedComponents(mask, w, h), pixels, w, h)
      .filter(
        (block) =>
          block.x1 >= grid.scheduleGridBounds.x &&
          block.x0 <= grid.scheduleGridBounds.x + grid.scheduleGridBounds.width &&
          block.y1 >= grid.scheduleGridBounds.y &&
          block.y0 <= grid.scheduleGridBounds.y + grid.scheduleGridBounds.height,
      ),
    columnRunBlocks = detectColoredColumnRuns(pixels, w, h, grid, background),
    detectionMode = columnRunBlocks.length ? "column-color-runs" : "connected-components",
    rawBlocks = columnRunBlocks.length ? columnRunBlocks : componentBlocks,
    blocks = rawBlocks
      .flatMap((block) =>
        detectionMode === "connected-components" &&
        block.x1 - block.x0 + 1 > grid.columnWidth * 1.4
          ? splitWideComponentByColumns(block, grid, mask, w)
          : [block],
      )
      .filter(
        (block) =>
          block.x1 - block.x0 + 1 > grid.columnWidth * 0.55 &&
          block.y1 - block.y0 + 1 > grid.rowHeight * 0.32,
      )
      .map((block) => ({
        ...block,
        averageColor: averageBlockColor(pixels, block, w),
      }))
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0),
    baseTime = inferBaseStartMinutes(grid, blocks);
  console.log("Detected timetable blocks", {
    detectionMode,
    componentCount: componentBlocks.length,
    columnRunCount: columnRunBlocks.length,
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
      onProgress?.(Math.round((event.progress || 0) * 100)),
  });
  try {
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6",
    });
    const shells = await detectBlockShells(file),
      calibratedBaseTime = await calibrateTimeAxis(
        worker,
        shells.sourceCanvas,
        shells.grid,
      ),
      generatedEvents = [],
      recognizedBlocks = [];
    if (calibratedBaseTime) shells.baseTime = calibratedBaseTime;
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_char_whitelist: "",
      tessedit_pageseg_mode: "6",
    });
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
    const finalEvents = harmonizeClassroomsBySubject(
      harmonizeEventsByColor(generatedEvents),
    );
    finalEvents.forEach((event) => {
      console.log("Final event validation", {
        blockId: event.id,
        day: event.day,
        startTime: event.startTime,
        endTime: event.endTime,
        durationMinutes: minutes(event.endTime) - minutes(event.startTime),
        courseName: event.courseName,
        originalClassroom: event._ocrRoomMeta?.originalClassroom || "",
        finalClassroom: event.classroom || "",
        roomNumber: classroomParts(event.classroom).number,
        originalPrefix: classroomParts(
          event._ocrRoomMeta?.originalClassroom,
        ).prefix,
        finalPrefix: classroomParts(event.classroom).prefix,
        prefixSource: event._ocrRoomMeta?.prefixSource || "",
        prefixConfidence: event._ocrRoomMeta?.prefixConfidence || 0,
        wasHarmonized: event._ocrRoomMeta?.wasHarmonized || false,
        harmonizationGroupKey:
          event._ocrRoomMeta?.harmonizationGroupKey || "",
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
