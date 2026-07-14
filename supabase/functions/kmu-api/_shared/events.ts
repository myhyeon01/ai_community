import type { User } from "npm:@supabase/supabase-js@2.110.2";
import { admin } from "./client.ts";
import { absoluteUrl, cheerio, cleanText, fetchHtml, shaKey } from "./scrape.ts";

const KMU_URL = Deno.env.get("KMU_NOTICE_URL") || "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=143&";
const KMU_EXTERNAL_URL = Deno.env.get("KMU_EXTERNAL_NOTICE_URL") || "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=141&";
const KMU_RECRUIT_URL = Deno.env.get("KMU_RECRUIT_NOTICE_URL") || "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=147&";
const KMU_CAREER_URL = Deno.env.get("KMU_CAREER_NOTICE_URL") || "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=3445&";
const STORY_URL = Deno.env.get("STORY_EVENT_LIST_URL") || "https://story.kmu.ac.kr/user/Ep/EpMng010L.do?CURRENT_MENU_CODE=MENU0052&TOP_MENU_CODE=MENU0004";

const EVENT_KEYWORDS = /축제|특강|초청강연|비교과|공모전|세미나|교육|강좌|워크숍|프로그램|모집|대외활동|홍보단|서포터즈|공모|전시|특별전|캠프|청년|채용|인턴|봉사|상담|학술|포럼|설명회|박람회|체험|교환학생|지원사업|참가|참여|동아리|공연|콘서트|대회|연수/;

function classify(text: string) {
  if (text.includes("축제")) return "축제";
  if (text.includes("공모전") || text.includes("공모")) return "공모전";
  if (/취업|채용|인턴/.test(text)) return "채용";
  if (/특강|세미나|강연/.test(text)) return "특강";
  if (/교육|강좌|워크숍/.test(text)) return "교육";
  if (text.includes("봉사")) return "봉사";
  return text.includes("비교과") ? "비교과" : "행사";
}

function tags(text: string) {
  const map: Record<string, string> = { "AI": "ai", "인공지능": "ai", "개발": "major", "소프트웨어": "major", "데이터": "major", "취업": "career", "채용": "career", "인턴": "career", "공모": "contest", "창업": "startup", "축제": "culture", "문화": "culture", "봉사": "volunteer", "글로벌": "global", "교육": "education" };
  return [...new Set(Object.entries(map).filter(([word]) => text.includes(word)).map(([, tag]) => tag))].join(",");
}

const INTEREST_KEYWORDS: Record<string, string[]> = {
  major: ["major", "전공", "개발", "소프트웨어", "데이터", "컴퓨터", "프로그래밍", "it"],
  education: ["education", "교육", "강좌", "특강", "학습"],
  career: ["career", "취업", "채용", "인턴", "진로", "직무"],
  contest: ["contest", "공모전", "공모", "대회"],
  culture: ["culture", "문화", "축제", "공연", "전시"],
  ai: ["ai", "인공지능", "머신러닝", "딥러닝"],
  startup: ["startup", "창업", "스타트업"],
  volunteer: ["volunteer", "봉사"],
  global: ["global", "글로벌", "해외", "교환학생", "외국어"],
};

function matchedInterests(text: string, interests: string[]) {
  const normalizedText = text.toLocaleLowerCase("ko");
  return interests.filter((interest) => {
    const normalized = cleanText(interest).toLocaleLowerCase("ko");
    if (!normalized) return false;
    return (INTEREST_KEYWORDS[normalized] || [normalized]).some((keyword) =>
      normalizedText.includes(keyword.toLocaleLowerCase("ko"))
    );
  });
}

function eventDates(text: string, fallback = new Date()) {
  const match = text.match(/(?:(20\d{2}|\d{2})\s*(?:년|[.\/-]))?\s*(\d{1,2})\s*(?:월|[.\/-])\s*(\d{1,2})\s*일?/);
  const rawYear = match?.[1];
  const year = rawYear ? (rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)) : fallback.getFullYear();
  const month = Number(match?.[2] || fallback.getMonth() + 1), day = Number(match?.[3] || fallback.getDate());
  const start = new Date(Date.UTC(year, month - 1, day, 9));
  const tail = match ? text.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 100) : "";
  const second = tail.match(/(?:(20\d{2}|\d{2})\s*(?:년|[.\/-]))?\s*(\d{1,2})\s*(?:월|[.\/-])\s*(\d{1,2})\s*일?/);
  const dayOnly = tail.match(/[~～-]\s*(\d{1,2})\s*일/);
  let end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  if (second) {
    const secondYear = second[1] ? (second[1].length === 2 ? 2000 + Number(second[1]) : Number(second[1])) : year;
    end = new Date(Date.UTC(secondYear, Number(second[2]) - 1, Number(second[3]), 18));
  }
  else if (dayOnly) end = new Date(Date.UTC(year, month - 1, Number(dayOnly[1]), 18));
  if (end <= start) end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return { starts_at: start.toISOString(), ends_at: end.toISOString(), found: Boolean(match) };
}

function detailValue(text: string, labels: string[]) {
  const pattern = new RegExp(`(?:${labels.join("|")})\\s*[:：]?\\s*([^\\n]{2,150})`);
  return cleanText(text.match(pattern)?.[1] || "").split(/(?:신청|기간|일시|대상|문의)\s*[:：]?/)[0].slice(0, 150);
}

function sanitizeEventText(value: string) {
  return value
    .split(/\n|\r/)
    .map(cleanText)
    .filter(Boolean)
    .filter((line) => !/\{\s*["']?(?:message|path)["']?\s*:|location\.href|hasToken=|parm_bod_uid=|<!\[CDATA\[|function\s+\w+\s*\(|<\/?(?:script|style)|javascript:/i.test(line))
    .filter((line) => !/(?:\?\s*){4,}|�{2,}/.test(line))
    .join("\n");
}

function deadlineFromText(text: string): string | null {
  const lines = text.split(/\n|\r/).filter((line) => /신청|접수|모집/.test(line));
  const source = lines.join(" ") || text.slice(0, 2500);
  const matches = [...source.matchAll(/(?:(20\d{2}|\d{2})\s*(?:년|[.\/-]))?\s*(\d{1,2})\s*(?:월|[.\/-])\s*(\d{1,2})\s*일?/g)];
  const match = matches.at(-1);
  if (!match) return null;
  const now = new Date(), year = match[1] ? (match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1])) : now.getFullYear();
  const value = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]), 23, 59, 59));
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

async function hydrateKmuEvent(row: any) {
  try {
    const response = await fetchHtml(row.url);
    const $ = cheerio.load(response.html);
    const view = $(".bbs_view,.bbs_con,#content,.content").first();
    const content = (view.length ? view : $("body")).clone();
    content.find("script,style,noscript,template").remove();
    const text = sanitizeEventText(content.text());
    const dateSnippet = text.split(/\n|\r/).filter((line) => /행사|운영|교육|활동|일시|기간/.test(line)).slice(0, 8).join(" ") || text;
    const parsedDates = eventDates(dateSnippet, new Date(row.starts_at));
    const deadline = deadlineFromText(text);
    const startsAt = parsedDates.found ? parsedDates.starts_at : row.starts_at;
    let endsAt = parsedDates.found ? parsedDates.ends_at : row.ends_at;
    if (deadline && new Date(deadline).getTime() > new Date(endsAt).getTime()) endsAt = deadline;
    return {
      ...row,
      starts_at: startsAt,
      ends_at: endsAt,
      summary: text.slice(0, 1200) || row.summary,
      apply_deadline: deadline,
      category: classify(`${row.title} ${text}`),
      location: detailValue(text, ["장소", "교육장", "행사장", "강의실"]) || row.location,
      interests: tags(`${row.title} ${text}`),
      url: response.url,
      apply_url: response.url,
    };
  } catch {
    const posted = new Date(row.starts_at);
    return { ...row, ends_at: new Date(posted.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString() };
  }
}

async function upsertEvents(rows: any[]) {
  if (!rows.length) return { created: 0, updated: 0 };
  const { error } = await admin.from("school_events").upsert(rows.map((row) => ({ ...row, updated_at: new Date().toISOString() })), { onConflict: "source_key" });
  if (error) throw error;
  return { created: rows.length, updated: 0 };
}

function pageUrl(base: string, page: number) {
  const url = new URL(base); url.searchParams.set("page", String(page)); url.searchParams.set("pageIndex", String(page)); return url.toString();
}

function kmuPageUrl(base: string, page: number) {
  const url = new URL(base);
  url.searchParams.set("cmd", "1");
  url.searchParams.set("pageNo", String(page));
  return url.toString();
}

function kmuBoardId(url: string) {
  try { return new URL(url).searchParams.get("mnu_uid") || "board"; }
  catch { return "board"; }
}

export async function syncKmu(pages: number, limit: number) {
  const result: any[] = [], seen = new Set<string>();
  const legacyKeys = new Set<string>();
  const sources = [
    { base: KMU_URL, source_type: "school", includeAll: false },
    { base: KMU_EXTERNAL_URL, source_type: "external", includeAll: true },
    { base: KMU_RECRUIT_URL, source_type: "school", includeAll: true },
    { base: KMU_CAREER_URL, source_type: "external", includeAll: true },
  ];
  const perSourceLimit = Math.max(12, Math.ceil(limit / sources.length));
  for (const source of sources) {
    let sourceCount = 0;
    const boardId = kmuBoardId(source.base);
    const pageResponses = await Promise.all(
      Array.from({ length: pages }, (_, index) => fetchHtml(kmuPageUrl(source.base, index + 1))),
    );
    for (const response of pageResponses) {
      if (sourceCount >= perSourceLimit) break;
      const $ = cheerio.load(response.html);
      for (const row of $("table tbody tr").toArray()) {
        const link = $(row).find('a[href*="parm_bod_uid"]').first();
        if (!link.length) continue;
        const title = cleanText(link.attr("title") || link.text());
        if (!source.includeAll && !EVENT_KEYWORDS.test(title)) continue;
        const url = absoluteUrl(response.url, String(link.attr("href") || ""));
        const uid = new URL(url).searchParams.get("parm_bod_uid") || await shaKey(url);
        const sourceKey = `kmu:${boardId}:${uid}`;
        if (seen.has(sourceKey)) continue; seen.add(sourceKey);
        legacyKeys.add(`kmu:${uid}`);
        const cells = $(row).find("td").toArray().map((cell) => cleanText($(cell).text()));
        const dateText = cleanText($(row).find("td.date").first().text()) || cells.find((value) => /\d{2,4}-\d{1,2}-\d{1,2}/.test(value)) || "";
        const posted = eventDates(dateText);
        const postedEnd = new Date(new Date(posted.starts_at).getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
        result.push({ title: title.slice(0, 250), summary: title, starts_at: posted.starts_at, ends_at: postedEnd, apply_deadline: null, category: classify(title), source_type: source.source_type, department: cleanText($(row).find("td.writer").first().text()) || cells.at(-2) || "계명대학교", location: "계명대학교", interests: tags(title), url, apply_url: url, source_key: sourceKey });
        sourceCount += 1;
        if (sourceCount >= perSourceLimit) break;
      }
    }
  }
  const selected = result.slice(0, limit);
  const hydrateCounts = new Map<string, number>();
  const hydrateTargets = selected.filter((row) => {
    const boardId = String(row.source_key).split(":")[1] || "board";
    const count = hydrateCounts.get(boardId) || 0;
    if (count >= 6) return false;
    hydrateCounts.set(boardId, count + 1);
    return true;
  });
  const hydratedMap = new Map<string, any>();
  for (let index = 0; index < hydrateTargets.length; index += 12) {
    const batch = await Promise.all(hydrateTargets.slice(index, index + 12).map(hydrateKmuEvent));
    batch.forEach((row) => hydratedMap.set(row.source_key, row));
  }
  const hydrated = selected.map((row) => hydratedMap.get(row.source_key) || row);
  if (legacyKeys.size) await admin.from("school_events").delete().in("source_key", [...legacyKeys]);
  const persisted = await upsertEvents(hydrated);
  const activeNow = new Date().toISOString();
  const { count: activeCount } = await admin.from("school_events").select("id", { count: "exact", head: true }).or(`ends_at.gte.${activeNow},apply_deadline.gte.${activeNow}`);
  return {
    fetched: hydrated.length,
    ...persisted,
    active: activeCount || 0,
    samples: hydrated.slice(0, 3).map(({ title, starts_at, ends_at, apply_deadline, location }) => ({ title, starts_at, ends_at, apply_deadline, location })),
  };
}

export async function syncStory(pages: number, limit: number) {
  const cookie = Deno.env.get("STORY_SESSION_COOKIE") || "";
  const result: any[] = [], seen = new Set<string>();
  for (let page = 1; page <= pages && result.length < limit; page++) {
    const response = await fetchHtml(pageUrl(STORY_URL, page), { headers: cookie ? { Cookie: cookie } : {} });
    if (new URL(response.url).pathname.endsWith("/main.do")) return { fetched: 0, created: 0, updated: 0, requires_auth: true, message: "Story+ 로그인 쿠키가 필요합니다." };
    const $ = cheerio.load(response.html);
    for (const link of $('a[href],a[onclick]').toArray()) {
      const raw = `${$(link).attr("href") || ""} ${$(link).attr("onclick") || ""}`;
      if (!/EpMng010|EPP|PROGRAM|PRM_/i.test(raw)) continue;
      const path = raw.match(/(?:https?:\/\/[^'" ]+|\/?[^'" ]*(?:EpMng010PD|gate\.do)[^'" ]*)/i)?.[0] || "";
      const url = absoluteUrl(response.url, path || String($(link).attr("href") || ""));
      const container = $(link).closest("tr,li,article,.item,.card");
      const text = sanitizeEventText(container.length ? container.text() : $(link).text());
      const title = cleanText($(link).attr("title") || $(link).text()) || text.slice(0, 120);
      if (title.length < 3) continue;
      const sourceKey = `story:${await shaKey(url + title)}`;
      if (seen.has(sourceKey)) continue; seen.add(sourceKey);
      const dates = eventDates(text);
      result.push({ title: title.slice(0, 250), summary: text.slice(0, 1200), starts_at: dates.starts_at, ends_at: dates.ends_at, apply_deadline: null, category: classify(text), source_type: "school", department: "Story+", location: "계명대학교", interests: tags(text), url, apply_url: url, source_key: sourceKey });
      if (result.length >= limit) break;
    }
  }
  return { fetched: result.length, ...(await upsertEvents(result)), requires_auth: false };
}

function filteredQuery(url: URL, count = false) {
  let query: any = admin.from("school_events").select("*", count ? { count: "exact", head: true } : undefined);
  const q = cleanText(url.searchParams.get("q") || ""), category = url.searchParams.get("category"), source = url.searchParams.get("source_type"), interest = cleanText(url.searchParams.get("interest") || "");
  if (q) query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%,department.ilike.%${q}%`);
  if (category) query = query.eq("category", category);
  if (source) query = query.eq("source_type", source);
  if (interest) query = query.or(interest.split(",").filter(Boolean).map((value) => `interests.ilike.%${value}%`).join(","));
  if (url.searchParams.get("start_date")) query = query.gte("starts_at", `${url.searchParams.get("start_date")}T00:00:00Z`);
  if (url.searchParams.get("end_date")) query = query.lte("starts_at", `${url.searchParams.get("end_date")}T23:59:59Z`);
  if (url.searchParams.get("deadline_from")) query = query.gte("apply_deadline", `${url.searchParams.get("deadline_from")}T00:00:00Z`);
  if (url.searchParams.get("deadline_to")) query = query.lte("apply_deadline", `${url.searchParams.get("deadline_to")}T23:59:59Z`);
  const progress = url.searchParams.get("progress");
  if (progress === "ongoing") {
    const now = new Date().toISOString();
    query = query.lte("starts_at", now).gte("ends_at", now);
  }
  if (progress === "upcoming") query = query.gt("starts_at", new Date().toISOString());
  if (url.searchParams.get("active_only") === "true") {
    const now = new Date().toISOString();
    query = query
      .gte("ends_at", now)
      .or(`starts_at.lte.${now},apply_deadline.is.null,apply_deadline.gte.${now}`);
  }
  return query;
}

async function favorites(user: User) {
  const { data, error } = await admin.from("school_event_favorites").select("event_id").eq("user_id", user.id);
  if (error) throw error;
  return new Set((data || []).map((row: any) => Number(row.event_id)));
}

function decorate(rows: any[], favoriteIds: Set<number>) {
  return rows.map((row) => ({
    ...row,
    summary: sanitizeEventText(String(row.summary || "")) || row.title || "",
    is_favorite: favoriteIds.has(Number(row.id)),
    recommendation_reason: row.recommendation_reason || "",
  }));
}

export async function listEvents(url: URL, user: User) {
  const page = Math.max(1, Number(url.searchParams.get("page") || 1)), limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 24)));
  let query = filteredQuery(url).range((page - 1) * limit, page * limit - 1);
  const sort = url.searchParams.get("sort") || "upcoming";
  query = sort === "deadline" ? query.order("apply_deadline", { ascending: true, nullsFirst: false }) : query.order("starts_at", { ascending: true });
  const [{ data, error }, fav] = await Promise.all([query, favorites(user)]);
  if (error) throw error;
  return decorate(data || [], fav);
}

export async function countEvents(url: URL) { const { count, error } = await filteredQuery(url, true); if (error) throw error; return { total: count || 0 }; }

export async function favoriteEvents(user: User) {
  const { data, error } = await admin.from("school_event_favorites").select("event_id,school_events(*)").eq("user_id", user.id);
  if (error) throw error;
  return (data || []).map((row: any) => ({ ...(row.school_events || {}), is_favorite: true, recommendation_reason: "" }));
}

export async function setFavorite(user: User, eventId: number, enabled: boolean) {
  if (enabled) {
    const { error } = await admin.from("school_event_favorites").upsert({ user_id: user.id, event_id: eventId }); if (error) throw error;
    const { data } = await admin.from("school_events").select("*").eq("id", eventId).single(); return { ...data, is_favorite: true, recommendation_reason: "" };
  }
  const { error } = await admin.from("school_event_favorites").delete().eq("user_id", user.id).eq("event_id", eventId); if (error) throw error;
  return null;
}

export async function recommendations(url: URL, user: User) {
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 12)));
  const interests = cleanText(url.searchParams.get("interests") || "").split(",").filter(Boolean);
  const department = cleanText(url.searchParams.get("department") || "");
  const grade = Number(url.searchParams.get("grade") || 0);
  const now = new Date().toISOString();
  const { data, error } = await admin.from("school_events").select("*").or(`ends_at.gte.${now},apply_deadline.gte.${now}`).order("starts_at").limit(300);
  if (error) throw error;
  const scored = (data || []).map((row: any) => {
    const text = `${row.title} ${row.summary} ${row.interests} ${row.department}`.toLocaleLowerCase("ko");
    const matched = matchedInterests(text, interests);
    const departmentMatched = Boolean(department && text.includes(department.toLocaleLowerCase("ko")));
    const gradeMatched = grade >= 4 && /취업|채용|인턴|career/.test(text);
    let score = matched.length * 5;
    if (departmentMatched) score += 4;
    if (gradeMatched) score += 3;
    const reason = matched.length
      ? `관심 분야(${matched.join(", ")})와 관련된 행사입니다.`
      : departmentMatched
        ? `${department} 관련 행사입니다.`
        : gradeMatched
          ? `${grade}학년에게 적합한 취업·진로 행사입니다.`
          : "참여 가능한 교내 행사입니다.";
    return { ...row, score, matched, departmentMatched, gradeMatched, recommendation_reason: reason };
  })
    .filter((row: any) => interests.length
      ? row.matched.length > 0
      : (department || grade >= 4 ? row.departmentMatched || row.gradeMatched : true))
    .sort((a: any, b: any) => b.score - a.score || String(a.starts_at).localeCompare(String(b.starts_at)))
    .slice(0, limit);
  return decorate(scored, await favorites(user));
}
