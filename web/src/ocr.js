import { createWorker } from "tesseract.js";

const days = ["월", "화", "수", "목", "금"],
  dayMap = { 월: 0, 화: 1, 수: 2, 목: 3, 금: 4, 토: 5, 일: 6 };
const norm = (v) => {
  const m = String(v || "").match(/(\d{1,2})[:.](\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};
const minutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const roundTime = (value) => {
  const total = Math.round(value * 4) * 15,
    h = Math.floor(total / 60),
    m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
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

export function parseEverytimeText(raw) {
  const rows = [];
  for (const line of String(raw || "")
    .replace(/[|]/g, " ")
    .replace(/[～~—–]/g, "-")
    .split(/\r?\n/)) {
    const range = line.match(/(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})/),
      found = [...new Set(line.match(/[월화수목금토일]/g) || [])];
    if (!range || !found.length) continue;
    const start_time = norm(range[1]),
      end_time = norm(range[2]);
    if (!start_time || start_time >= end_time) continue;
    const subject =
      line
        .replace(range[0], "")
        .replace(/[월화수목금토일]/g, "")
        .replace(/\s+/g, " ")
        .trim() || "수업";
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
const colorful = (r, g, b, a) => {
  if (a < 180) return false;
  const max = Math.max(r, g, b) / 255,
    min = Math.min(r, g, b) / 255;
  return max > 0.35 && max && (max - min) / max > 0.16;
};
const grayLine = (r, g, b) =>
  Math.max(r, g, b) - Math.min(r, g, b) < 18 &&
  ((r + g + b) / 3 > 170 || (r + g + b) / 3 < 105);
const wordsOf = (data) =>
  (data?.blocks || []).flatMap((b) =>
    (b.paragraphs || []).flatMap((p) =>
      (p.lines || []).flatMap((l) => l.words || []),
    ),
  );
const classifyBlockText = (words) => {
  const lineGroups = [];
  for (const word of words) {
    const cy = (word.bbox.y0 + word.bbox.y1) / 2;
    let line = lineGroups.find(
      (x) =>
        Math.abs(x.y - cy) < Math.max(10, (word.bbox.y1 - word.bbox.y0) * 0.7),
    );
    if (!line) {
      line = { y: cy, words: [] };
      lineGroups.push(line);
    }
    line.words.push(word);
  }
  const lines = lineGroups
    .sort((a, b) => a.y - b.y)
    .map((line) =>
      line.words
        .sort((a, b) => a.bbox.x0 - b.bbox.x0)
        .map((x) => x.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  const roomPattern =
      /(강의실|강의동|관\s*\d|[A-Za-z가-힣]+관|[A-Za-z]\s*[-]?\s*\d{2,4}|\d{2,4}호)/i,
    profPattern = /(교수|선생|강사|prof)/i;
  let classroom = "",
    professor = "";
  for (const line of lines.slice(1)) {
    if (!classroom && roomPattern.test(line)) classroom = line;
    else if (!professor && profPattern.test(line))
      professor = line.replace(/교수님?|선생님?|강사/g, "").trim();
  }
  const subject =
    (
      lines.find((line) => line !== classroom && !profPattern.test(line)) ||
      lines[0] ||
      "수업"
    )
      .replace(roomPattern, "")
      .trim() || "수업";
  if (!professor) {
    const extra = lines.find(
      (line) =>
        line !== subject && line !== classroom && /^[가-힣]{2,5}$/.test(line),
    );
    if (extra) professor = extra;
  }
  return { subject, professor, classroom };
};
const classifyPlainText = (text) => {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const roomPattern =
    /(강의실|강의동|[가-힣A-Za-z]+관\s*\d*|[A-Za-z]\s*-?\s*\d{2,4}|\d{2,4}호)/i;
  const classroom = lines.find((line) => roomPattern.test(line)) || "";
  const subject =
    lines.find(
      (line) => line !== classroom && line.length >= 2 && !/^\d/.test(line),
    ) || "수업";
  const professor =
    lines
      .find(
        (line) =>
          line !== subject &&
          line !== classroom &&
          /(교수|강사|선생)/.test(line),
      )
      ?.replace(/교수님?|강사|선생님?/g, "")
      .trim() || "";
  return { subject, professor, classroom };
};

async function visualRows(file, data) {
  const image = await loadImage(file),
    canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const { width: w, height: h } = canvas,
    p = ctx.getImageData(0, 0, w, h).data,
    mask = new Uint8Array(w * h),
    seen = new Uint8Array(w * h),
    minArea = Math.max(700, w * h * 0.00035);
  for (let y = Math.floor(h * 0.08); y < h * 0.97; y++)
    for (let x = Math.floor(w * 0.06); x < w * 0.99; x++) {
      const o = (y * w + x) * 4;
      if (colorful(p[o], p[o + 1], p[o + 2], p[o + 3])) mask[y * w + x] = 1;
    }
  const components = [],
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
      for (let q = 0; q < queue.length; q++) {
        const cur = queue[q],
          cx = cur % w,
          cy = Math.floor(cur / w);
        area++;
        x0 = Math.min(x0, cx);
        x1 = Math.max(x1, cx);
        y0 = Math.min(y0, cy);
        y1 = Math.max(y1, cy);
        for (const n of [cur - 1, cur + 1, cur - w, cur + w]) {
          if (
            n < 0 ||
            n >= mask.length ||
            seen[n] ||
            !mask[n] ||
            Math.abs((n % w) - cx) > 1
          )
            continue;
          seen[n] = 1;
          queue.push(n);
        }
      }
      if (area >= minArea && x1 - x0 > w * 0.045 && y1 - y0 > 25)
        components.push({ x0, x1, y0, y1 });
    }
  if (!components.length) return [];
  // 에브리타임의 세로 격자선을 찾아 월~금 열을 결정한다.
  const vertical = [];
  for (let x = Math.floor(w * 0.05); x < w * 0.99; x++) {
    let hit = 0;
    for (let y = Math.floor(h * 0.1); y < h * 0.95; y += 3) {
      const o = (y * w + x) * 4;
      if (grayLine(p[o], p[o + 1], p[o + 2])) hit++;
    }
    if (hit > ((h * 0.85) / 3) * 0.35) vertical.push(x);
  }
  const lines = groups(vertical, 3),
    gaps = lines
      .slice(1)
      .map((v, i) => v - lines[i])
      .filter((v) => v > w * 0.1 && v < w * 0.25),
    column = median(gaps) || w * 0.17,
    minX = Math.min(...components.map((c) => c.x0)),
    gridLeft =
      [...lines].filter((x) => x <= minX + column * 0.3).at(-1) ||
      Math.max(0, minX - column * 0.08);
  // 가로 격자선 간격을 한 시간 높이로 사용한다.
  const horizontal = [];
  for (let y = Math.floor(h * 0.08); y < h * 0.98; y++) {
    let hit = 0;
    for (
      let x = Math.max(0, Math.floor(gridLeft));
      x < Math.min(w, Math.floor(gridLeft + column * 5));
      x += 3
    ) {
      const o = (y * w + x) * 4;
      if (grayLine(p[o], p[o + 1], p[o + 2])) hit++;
    }
    if (hit > column * 0.75) horizontal.push(y);
  }
  const hLines = groups(horizontal, 3),
    hGaps = hLines
      .slice(1)
      .map((v, i) => v - hLines[i])
      .filter((v) => v > h * 0.025 && v < h * 0.16),
    hour = median(hGaps) || h * 0.075,
    firstTop = Math.min(...components.map((c) => c.y0)),
    gridTop =
      [...hLines].filter((y) => y <= firstTop + hour * 0.25).at(-1) || firstTop;
  const words = wordsOf(data);
  return components
    .map((c) => {
      const weekday = Math.floor(((c.x0 + c.x1) / 2 - gridLeft) / column);
      if (weekday < 0 || weekday > 4) return null;
      const start_time = roundTime(9 + (c.y0 - gridTop) / hour),
        end_time = roundTime(9 + (c.y1 - gridTop) / hour);
      if (minutes(start_time) >= minutes(end_time)) return null;
      const inside = words
        .filter((word) => {
          const b = word.bbox;
          if (!b) return false;
          const x = (b.x0 + b.x1) / 2,
            y = (b.y0 + b.y1) / 2;
          return (
            x >= c.x0 - 8 && x <= c.x1 + 8 && y >= c.y0 - 8 && y <= c.y1 + 8
          );
        })
        .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
      return {
        ...classifyBlockText(inside),
        weekday,
        start_time,
        end_time,
        _rect: {
          left: c.x0,
          top: c.y0,
          width: c.x1 - c.x0 + 1,
          height: c.y1 - c.y0 + 1,
        },
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
    );
}

export async function recognizeTimetable(file, onProgress) {
  const worker = await createWorker("kor+eng", 1, {
    logger: (e) =>
      e.status === "recognizing text" &&
      onProgress(Math.round((e.progress || 0) * 100)),
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: "1" });
    const result = await worker.recognize(
      file,
      {},
      { blocks: true, text: true },
    );
    const text = result?.data?.text || "";
    const positioned = await visualRows(file, result?.data);
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: "6",
    });
    for (const row of positioned) {
      if (row.subject !== "수업" && row.classroom) continue;
      const detail = await worker.recognize(
        file,
        { rectangle: row._rect },
        { text: true, blocks: true },
      );
      const fromWords = classifyBlockText(wordsOf(detail?.data));
      const fromText = classifyPlainText(detail?.data?.text);
      if (row.subject === "수업")
        row.subject =
          fromWords.subject !== "수업" ? fromWords.subject : fromText.subject;
      row.classroom =
        row.classroom || fromWords.classroom || fromText.classroom;
      row.professor =
        row.professor || fromWords.professor || fromText.professor;
    }
    positioned.forEach((row) => delete row._rect);
    return {
      text,
      rows: positioned.length ? positioned : parseEverytimeText(text),
    };
  } finally {
    await worker.terminate();
  }
}
