export const ROMAN_NUMERALS = new Set([
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
]);

export const cleanOcrText = (text) =>
  String(text || "")
    .replace(/[|]/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

export const removeRepeatedWords = (text) => {
  const parts = cleanOcrText(text).split(/\s+/).filter(Boolean),
    out = [];
  for (const part of parts) {
    const prev = out.at(-1);
    if (prev && prev.toLowerCase() === part.toLowerCase()) continue;
    out.push(part);
  }
  return out.join(" ");
};

export const normalizeClassroom = (text) =>
  removeRepeatedWords(text)
    .replace(/[|]/g, "")
    .replace(/[()[\]{}]/g, "")
    .replace(/[,]+/g, " ")
    .replace(/[^\uAC00-\uD7A3A-Za-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .replace(/([\uAC00-\uD7A3A-Za-z])\s+(?=\d)/g, "$1")
    .trim();

export const isRomanNumeral = (token) =>
  ROMAN_NUMERALS.has(String(token || "").toUpperCase());

export const isLikelyClassroom = (text) => {
  const value = normalizeClassroom(text);
  if (!value || isRomanNumeral(value)) return false;
  return (
    /^[\uAC00-\uD7A3A-Za-z]+[\s-]?[A-Za-z0-9-]*\d+[A-Za-z0-9-]*$/.test(value) ||
    /(?:\uAD00|\uAC15\uC758\uC2E4|\uD638)/.test(value)
  );
};

export const normalizeCourseName = (lines) => {
  const tokens = lines
    .flatMap((line) =>
      removeRepeatedWords(line)
        .replace(/\bENGLISH\s+[lI|1]\b/g, "ENGLISH I")
        .split(/\s+/),
    )
    .map((token) => token.replace(/[,.;:]+$/g, ""))
    .map((token) =>
      ["l", "|", "1"].includes(token) ? "I" : token,
    )
    .filter(Boolean)
    .filter(
      (token) =>
        token.length > 1 || isRomanNumeral(token) || /^[A-Z]$/.test(token),
    );
  return removeRepeatedWords(tokens.join(" ")).trim();
};
