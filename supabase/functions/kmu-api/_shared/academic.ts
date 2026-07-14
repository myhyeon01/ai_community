import { readCache, writeCache } from "./client.ts";
import { cheerio, cleanText, fetchHtml, shaKey } from "./scrape.ts";

const ACADEMIC_URL = "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=3373";
const DATE_RANGE = /(\d{1,2})-(\d{1,2})(?:\s*[~～-]\s*(?:(\d{1,2})-)?(\d{1,2}))?/;
const ORIGINAL_DAY = /\[(\d{1,2})\.\s*(\d{1,2})\.?\]/;

function category(title: string): string {
  if (title.includes("보강")) return "makeup";
  if (title.includes("시험")) return "exam";
  if (title.includes("수강")) return "registration";
  if (/개강|개시일/.test(title)) return "semester";
  if (/방학|종강/.test(title)) return "vacation";
  if (/휴업|공휴일|휴강/.test(title)) return "holiday";
  if (/학위|졸업/.test(title)) return "graduation";
  if (/복학|재입학|휴학/.test(title)) return "application";
  return "academic";
}

function dateIso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null;
}

export async function academicCalendar(year: number, refresh = false): Promise<unknown[]> {
  const key = `academic:${year}`;
  if (!refresh) {
    const cached = await readCache<unknown[]>(key);
    if (cached?.length) return cached;
  }
  const url = new URL(ACADEMIC_URL);
  url.searchParams.set("parm_doc_year", String(year));
  const { html } = await fetchHtml(url.toString());
  const $ = cheerio.load(html);
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const row of $("tr").toArray()) {
    const cells = $(row).find("th,td").toArray().map((cell) => cleanText($(cell).text()));
    if (cells.length < 2) continue;
    const match = cells[0].match(DATE_RANGE);
    if (!match) continue;
    const title = cleanText(cells.slice(1).join(" "));
    if (!title) continue;
    const sm = Number(match[1]), sd = Number(match[2]);
    const em = Number(match[3] || sm), ed = Number(match[4] || sd);
    const startYear = sm >= 3 ? year : year + 1;
    const endYear = startYear + (em < sm ? 1 : 0);
    const start = dateIso(startYear, sm, sd), end = dateIso(endYear, em, ed);
    if (!start || !end) continue;
    let appliedWeekday: number | null = null;
    const original = title.match(ORIGINAL_DAY);
    if (title.includes("보강") && original) {
      const month = Number(original[1]), day = Number(original[2]);
      const originalYear = month >= 3 ? year : year + 1;
      appliedWeekday = (new Date(Date.UTC(originalYear, month - 1, day)).getUTCDay() + 6) % 7;
    }
    const sourceKey = await shaKey(`${start}|${end}|${title}`);
    if (seen.has(sourceKey)) continue;
    seen.add(sourceKey);
    rows.push({ title, start_date: start, end_date: end, event_type: category(title), applied_weekday: appliedWeekday, source_url: ACADEMIC_URL, source_key: sourceKey });
  }
  if (!rows.length) throw new Error("계명대학교 학사일정 표를 찾지 못했습니다.");
  rows.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)) || String(a.title).localeCompare(String(b.title)));
  await writeCache(key, rows, 600);
  return rows;
}

export async function academicYears(): Promise<number[]> {
  const cached = await readCache<number[]>("academic:years");
  if (cached?.length) return cached;
  const { html } = await fetchHtml(ACADEMIC_URL);
  const $ = cheerio.load(html);
  const years = [...new Set($('select[name="parm_doc_year"] option').toArray()
    .map((node) => Number($(node).attr("value"))).filter(Number.isFinite))].sort((a, b) => b - a);
  await writeCache("academic:years", years, 3600);
  return years;
}
