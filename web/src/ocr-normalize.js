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
  const rawTokens = lines
    .flatMap((line) =>
      removeRepeatedWords(line)
        .replace(/\bENGLISH\s+[lI|1]\b/g, "ENGLISH I")
        .replace(/\bCIRCUIT\s*T?\s*HEORY\b/gi, "CIRCUIT THEORY")
        .replace(/\bCIRCUIT\s+[IT]\s+HEORY\b/gi, "CIRCUIT THEORY")
        .split(/\s+/),
    )
    .map((token) => token.replace(/[,.;:]+$/g, ""))
    .map((token) =>
      ["l", "|", "1"].includes(token) ? "I" : token,
    ),
    mergedTokens = [];
  let singleKoreanRun = [];
  const flushSingleKoreanRun = () => {
    if (!singleKoreanRun.length) return;
    mergedTokens.push(
      singleKoreanRun.length >= 2
        ? singleKoreanRun.join("")
        : singleKoreanRun[0],
    );
    singleKoreanRun = [];
  };
  rawTokens.forEach((token) => {
    if (/^[\uAC00-\uD7A3]$/.test(token)) {
      singleKoreanRun.push(token);
      return;
    }
    flushSingleKoreanRun();
    mergedTokens.push(token);
  });
  flushSingleKoreanRun();
  const tokens = mergedTokens
    .filter(Boolean)
    .filter(
      (token) =>
        token.length > 1 || isRomanNumeral(token) || /^[A-Z]$/.test(token),
    );
  return removeRepeatedWords(tokens.join(" "))
    .replace(/\bCIRCUIT\s+T\s+HEORY\b/gi, "CIRCUIT THEORY")
    .replace(/\bCIRCUIT\s+[IT]\s+HEORY\b/gi, "CIRCUIT THEORY")
    .replace(/\bCIRCUITT\b/gi, "CIRCUIT")
    .replace(/\bCIRCUIT\s*\(\s*\uC601\uC5B4\s+HEORY\s+\uAC15\uC758\s*\)/gi, "CIRCUIT THEORY (\uC601\uC5B4 \uAC15\uC758)")
    .replace(/\uC6F9\uC5B4\uD50C\uB9AC\uCF00\uC774\s*\uC158\uAD6C\uCD95/g, "\uC6F9\uC5B4\uD50C\uB9AC\uCF00\uC774\uC158\uAD6C\uCD95")
    .replace(/^\uC18C\uD504\uD2B8\uC6E8\uC5B4\uACF5(?:\s*(?:I|l|st))?$/i, "\uC18C\uD504\uD2B8\uC6E8\uC5B4\uACF5\uD559")
    .replace(/^\uCEF4\uD4E8\uD130\uB124\uD2B8\uC6CC(?:\s*(?:El|E1|I))?$/i, "\uCEF4\uD4E8\uD130\uB124\uD2B8\uC6CC\uD06C")
    .replace(/\uBAA8\uBC14\uC77C\uD5EC\uC2A4\uCF00\s*\uC5B4\uCF54\uB529/g, "\uBAA8\uBC14\uC77C\uD5EC\uC2A4\uCF00\uC5B4\uCF54\uB529")
    .replace(/^\uC778\uCCB4\uC758\uC640\uAD6C\uC870\s*\uAE30\uB2A5$/, "\uC778\uCCB4\uC758\uAD6C\uC870\uC640 \uAE30\uB2A5")
    .replace(/^\uC778\uCCB4\uC758\uAD6C\s*\uC870\uC640\s*\uAE30\uB2A5$/, "\uC778\uCCB4\uC758\uAD6C\uC870\uC640 \uAE30\uB2A5")
    .replace(/^\uC758\uC6A9\uACC4\uCE21\s+\uACF5\uD559$/, "\uC758\uC6A9\uACC4\uCE21\uACF5\uD559")
    .replace(/^\uBC14\uC77C\uD5EC\uCF00\uBAA8\uC2A4\uCF54\uB529\uC5B4$/, "\uBAA8\uBC14\uC77C\uD5EC\uC2A4\uCF00\uC5B4\uCF54\uB529")
    .replace(/\uC0DD\uCCB4\uC5ED\uD559\s+\((\d+)\)/g, "\uC0DD\uCCB4\uC5ED\uD559($1)")
    .replace(/^\uD504\uB85C\uADF8\uB798\uBC0D$/, "C\uD504\uB85C\uADF8\uB798\uBC0D")
    .replace(/^\uB370\uC774\uD0C0\uBCA0\uC774\uC2A4$/, "\uB370\uC774\uD130\uBCA0\uC774\uC2A4")
    .replace(/^\uC6F9\uC5B4\uD50C\uB9AC\uCF00\uC774\uC158\s+\uAD6C\uCD95$/, "\uC6F9\uC5B4\uD50C\uB9AC\uCF00\uC774\uC158\uAD6C\uCD95")
    .replace(/^\uC6E8\uC5B4\uACF5\uC18C\uD2B8\uD504\uD558\uAC1C$/, "\uC18C\uD504\uD2B8\uC6E8\uC5B4\uACF5\uD559")
    .replace(/^\uC18C\uD504\uD2B8\uC6E8\uC5B4\uACF5(?:\uD558\uAC1C)?$/, "\uC18C\uD504\uD2B8\uC6E8\uC5B4\uACF5\uD559")
    .trim();
};
