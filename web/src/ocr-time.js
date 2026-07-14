const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

export const inferGridStartHour = (samples, minHour = 7, maxHour = 11) => {
  const candidates = [];
  for (const sample of samples || []) {
    const rawHour = Number(sample?.hour);
    const rowIndex = Number(sample?.rowIndex);
    if (!Number.isInteger(rawHour) || !Number.isInteger(rowIndex)) continue;
    if (rawHour < 1 || rawHour > 24 || rowIndex < 0) continue;

    const hourVariants = rawHour > 12
      ? [rawHour]
      : [...new Set([rawHour, rawHour + 12, rawHour + 24])];
    for (const hour of hourVariants) {
      const gridStart = hour - rowIndex;
      if (gridStart >= minHour && gridStart <= maxHour) candidates.push(gridStart);
    }
  }

  const result = median(candidates);
  return result == null ? null : Math.round(result);
};

export const durationSlotsFromPixels = (height, pixelsPer15Minutes) => {
  if (!(height > 0) || !(pixelsPer15Minutes > 0)) return 4;
  return Math.max(2, Math.min(12, Math.round(height / pixelsPer15Minutes)));
};
