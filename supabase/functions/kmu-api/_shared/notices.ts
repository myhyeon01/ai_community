import { readCache, removeCache, writeCache } from "./client.ts";
import { absoluteUrl, cheerio, cleanText, fetchHtml } from "./scrape.ts";
import { summarizeNotice } from "./ai.ts";

const NOTICE_URL = Deno.env.get("KMU_NOTICE_URL") || "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=143&";
const KEYWORDS: Record<string, string[]> = {
  "학사": ["학사", "수강", "등록", "휴학", "복학", "졸업", "성적", "학점"],
  "장학": ["장학", "학자금", "근로학생"],
  "취업": ["취업", "채용", "인턴", "현장실습", "진로"],
  "행사": ["행사", "축제", "특강", "포럼", "세미나", "공모전", "교육", "프로그램"],
};

function category(title: string, department: string) {
  const text = `${title} ${department}`;
  return Object.entries(KEYWORDS).find(([, words]) => words.some((word) => text.includes(word)))?.[0] || "기타";
}

function withToken(value: string) {
  const url = new URL(value);
  url.searchParams.set("hasToken", "1");
  return url.toString();
}

function parseList(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const rows: any[] = [];
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    const link = $(row).find('a[href*="parm_bod_uid"]').first();
    if (cells.length < 4 || !link.length) return;
    const url = absoluteUrl(baseUrl, String(link.attr("href") || ""));
    const id = new URL(url).searchParams.get("parm_bod_uid");
    if (!id) return;
    const title = cleanText(link.text()), department = cleanText(cells.eq(2).text());
    const rawDate = cleanText(cells.eq(3).text());
    const year = Number(rawDate.slice(0, 2));
    const date = /^\d{2}-\d{2}-\d{2}$/.test(rawDate) ? `${year >= 70 ? 19 : 20}${rawDate}` : rawDate;
    const icons = $(row).find("img").toArray().map((node) => $(node).attr("alt") || "").join(" ");
    rows.push({ id, title, date, department, category: category(title, department), url: withToken(url), isImportant: icons.includes("공지") || !/^\d+$/.test(cleanText(cells.eq(0).text())), isNew: icons.includes("새") });
  });
  return rows;
}

async function allNotices(force = false) {
  if (!force) {
    const cached = await readCache<any[]>("notices:list");
    if (cached?.length) return cached;
  }
  const first = await fetchHtml(NOTICE_URL);
  const $ = cheerio.load(first.html);
  const links = new Map<number, string>();
  $('a[href]').each((_, link) => {
    const label = cleanText($(link).text());
    if (/^\d+$/.test(label)) links.set(Number(label), absoluteUrl(first.url, String($(link).attr("href"))));
  });
  const pages = [first.html];
  const maxPages = Math.max(1, Math.min(10, Number(Deno.env.get("KMU_NOTICE_PAGES") || 5)));
  for (let page = 2; page <= maxPages; page++) {
    const url = links.get(page);
    if (!url) break;
    pages.push((await fetchHtml(url)).html);
  }
  const unique = new Map<string, any>();
  pages.flatMap((html) => parseList(html, first.url)).forEach((notice) => unique.set(notice.id, notice));
  const rows = [...unique.values()].sort((a, b) => Number(b.isImportant) - Number(a.isImportant) || String(b.date).localeCompare(String(a.date)));
  if (!rows.length) throw new Error("계명대학교 공지 목록을 찾지 못했습니다.");
  await writeCache("notices:list", rows, 600);
  return rows;
}

export async function listNotices(url: URL) {
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 20)));
  const query = cleanText(url.searchParams.get("query") || "").toLocaleLowerCase("ko");
  const selected = url.searchParams.get("category") || "전체";
  let rows = await allNotices();
  if (query) rows = rows.filter((row) => `${row.title} ${row.department} ${row.category}`.toLocaleLowerCase("ko").includes(query));
  if (selected !== "전체") rows = rows.filter((row) => row.category === selected);
  const start = (page - 1) * limit;
  return { items: rows.slice(start, start + limit), page, limit, total: rows.length, hasMore: start + limit < rows.length, fetchedAt: new Date().toISOString() };
}

export async function noticeDetail(id: string, force = false) {
  const key = `notices:detail:${id}`;
  if (!force) { const cached = await readCache<any>(key); if (cached) return cached; }
  const url = new URL(NOTICE_URL); url.searchParams.set("cmd", "2"); url.searchParams.set("parm_bod_uid", id); url.searchParams.set("hasToken", "1");
  const response = await fetchHtml(url.toString());
  const $ = cheerio.load(response.html), view = $(".bbs_view").first();
  if (!view.length) throw new Error("공지 상세 내용을 찾지 못했습니다.");
  const metadata: Record<string, string> = {};
  view.find(".bbs_info dl").each((_, dl) => { $(dl).find("dt").each((_, term) => { metadata[cleanText($(term).text())] = cleanText($(term).next("dd").text()); }); });
  const title = cleanText(view.find(".bbs_info .subject dd").first().text());
  const department = metadata["작성자"] || "";
  const attachments = view.find('.file a[href*="com_download"]').toArray().map((link) => ({ name: cleanText($(link).text()), url: absoluteUrl(response.url, String($(link).attr("href") || "")) }));
  const result = { id, title, date: (metadata["일시"] || "").slice(0, 10), department, category: category(title, department), content: view.find(".bbs_con").text().split("\n").map(cleanText).filter(Boolean).join("\n").slice(0, 50000), attachments, url: withToken(response.url), contact: metadata["연락처"] || "", email: metadata["이메일"] || "" };
  await writeCache(key, result, 600);
  return result;
}

export async function refreshNotices() { await removeCache("notices:"); return listNotices(new URL("https://local/notices")); }
export async function noticeSummary(id: string) { return summarizeNotice(await noticeDetail(id)); }
