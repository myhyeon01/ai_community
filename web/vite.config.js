import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const KMU_URL = "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=3373";
const cache = new Map();

const cleanText = (html) =>
  html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&middot;/g, "·")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

function eventType(title) {
  if (title.includes("보강")) return "makeup";
  if (title.includes("시험")) return "exam";
  if (title.includes("수강")) return "registration";
  if (/개강|개시일/.test(title)) return "semester";
  if (/방학|종강/.test(title)) return "vacation";
  if (/휴업|공휴일|휴강|연휴/.test(title)) return "holiday";
  if (/학위|졸업/.test(title)) return "graduation";
  if (/복학|재입학|휴학/.test(title)) return "application";
  return "academic";
}

function parseAcademicHtml(html, year) {
  const rows = [];
  const seen = new Set();
  const rowPattern = /<td[^>]*class=["'][^"']*taC[^"']*["'][^>]*>\s*([0-9]{2}-[0-9]{2}(?:\s*[~～-]\s*(?:[0-9]{2}-)?[0-9]{2})?)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  for (const match of html.matchAll(rowPattern)) {
    const dateMatch = match[1].match(/(\d{2})-(\d{2})(?:\s*[~～-]\s*(?:(\d{2})-)?(\d{2}))?/);
    if (!dateMatch) continue;
    const [, smText, sdText, emText, edText] = dateMatch;
    const sm = Number(smText), sd = Number(sdText);
    const em = Number(emText || smText), ed = Number(edText || sdText);
    const startYear = sm < 3 ? year + 1 : year;
    const endYear = em < sm ? startYear + 1 : startYear;
    const start_date = `${startYear}-${String(sm).padStart(2, "0")}-${String(sd).padStart(2, "0")}`;
    const end_date = `${endYear}-${String(em).padStart(2, "0")}-${String(ed).padStart(2, "0")}`;
    const title = cleanText(match[2]);
    const key = `${start_date}|${end_date}|${title}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    let applied_weekday = null;
    const original = title.match(/\[(\d{1,2})\.\s*(\d{1,2})\.?\]/);
    if (title.includes("보강") && original) {
      const originalYear = Number(original[1]) < 3 ? year + 1 : year;
      applied_weekday = (new Date(originalYear, Number(original[1]) - 1, Number(original[2])).getDay() + 6) % 7;
    }
    rows.push({ id: key, title, start_date, end_date, event_type: eventType(title), applied_weekday, source_url: KMU_URL });
  }
  return rows.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.title.localeCompare(b.title));
}

async function schoolHtml(year) {
  const url = new URL(KMU_URL);
  if (year) url.searchParams.set("parm_doc_year", String(year));
  const response = await fetch(url, { headers: { "User-Agent": "KMU-Smart-Scheduler/0.1 (student project)" } });
  if (!response.ok) throw new Error(`KMU ${response.status}`);
  return response.text();
}

function kmuAcademicPlugin() {
  return {
    name: "kmu-academic-dev-api",
    configureServer(server) {
      server.middlewares.use("/kmu-api/academic-years", async (_req, res) => {
        try {
          const html = await schoolHtml();
          const years = [...html.matchAll(/<option[^>]+value=["'](\d{4})["']/g)].map((match) => Number(match[1]));
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify([...new Set(years)].sort((a, b) => b - a)));
        } catch (error) { res.statusCode = 502; res.end(JSON.stringify({ message: error.message })); }
      });
      server.middlewares.use("/kmu-api/academic-calendar", async (req, res) => {
        try {
          const requestUrl = new URL(req.url || "", "http://localhost");
          const year = Number(requestUrl.searchParams.get("year")) || new Date().getFullYear();
          const force = requestUrl.searchParams.get("refresh") === "true";
          const saved = cache.get(year);
          let events;
          if (!force && saved && Date.now() - saved.time < 10 * 60 * 1000) events = saved.events;
          else {
            events = parseAcademicHtml(await schoolHtml(year), year);
            cache.set(year, { time: Date.now(), events });
          }
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(events));
        } catch (error) { res.statusCode = 502; res.end(JSON.stringify({ message: error.message })); }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), kmuAcademicPlugin()],
  server: { port: 5173 },
});
