export const parseHexColor = (value) => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ""));
  if (!match) return null;
  return {
    r: Number.parseInt(match[1].slice(0, 2), 16),
    g: Number.parseInt(match[1].slice(2, 4), 16),
    b: Number.parseInt(match[1].slice(4, 6), 16),
  };
};

const rgbToHsv = ({ r, g, b }) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === rn) hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = (bn - rn) / delta + 2;
    else hue = (rn - gn) / delta + 4;
  }
  hue *= 60;
  if (hue < 0) hue += 360;
  return { h: hue, s: max ? delta / max : 0, v: max };
};

export const rgbDistance = (left, right) => Math.sqrt(
  (left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2,
);

export const areSimilarCourseColors = (left, right) => {
  if (!left || !right) return false;
  const distance = rgbDistance(left, right);
  if (distance <= 12) return true;
  const leftHsv = rgbToHsv(left);
  const rightHsv = rgbToHsv(right);
  if (Math.min(leftHsv.s, rightHsv.s) < 0.025) return distance <= 13;
  const hueDistance = Math.min(
    Math.abs(leftHsv.h - rightHsv.h),
    360 - Math.abs(leftHsv.h - rightHsv.h),
  );
  return distance <= 22
    && hueDistance <= 6
    && Math.abs(leftHsv.s - rightHsv.s) <= 0.035
    && Math.abs(leftHsv.v - rightHsv.v) <= 0.06;
};
