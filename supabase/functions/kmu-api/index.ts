import { academicCalendar, academicYears } from "./_shared/academic.ts";
import { chatSchedule, refineSchedule } from "./_shared/ai.ts";
import { requireUser } from "./_shared/client.ts";
import { countEvents, favoriteEvents, listEvents, recommendations, setFavorite, syncKmu, syncStory } from "./_shared/events.ts";
import { corsHeaders, errorResponse, intParam, json, routePath } from "./_shared/http.ts";
import { listNotices, noticeDetail, noticeSummary, refreshNotices } from "./_shared/notices.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url), path = routePath(url).replace(/^\/api\/v1/, "") || "/";
  try {
    if (req.method === "GET" && path === "/health") return json({ ok: true, runtime: "supabase-edge", time: new Date().toISOString() });
    if (req.method === "GET" && path === "/academic-calendar/years") return json(await academicYears());
    if (req.method === "GET" && path === "/academic-calendar") return json(await academicCalendar(intParam(url, "year", new Date().getFullYear(), 2010, new Date().getFullYear() + 2), url.searchParams.get("refresh") === "true"));
    if (req.method === "GET" && path === "/notices") return json(await listNotices(url));
    const noticeMatch = path.match(/^\/notices\/(\d+)$/);
    if (req.method === "GET" && noticeMatch) return json(await noticeDetail(noticeMatch[1]));
    if (req.method === "POST" && path === "/internal/sync") {
      const expected = Deno.env.get("CRAWLER_SYNC_SECRET") || "";
      if (!expected || req.headers.get("x-sync-secret") !== expected) return json({ detail: "동기화 권한이 없습니다." }, 401);
      const [kmu, story] = await Promise.allSettled([syncKmu(5, 200), syncStory(3, 200)]);
      return json({
        kmu: kmu.status === "fulfilled" ? kmu.value : { error: String(kmu.reason) },
        story: story.status === "fulfilled" ? story.value : { error: String(story.reason) },
        synced_at: new Date().toISOString(),
      });
    }
    if (req.method === "POST" && path === "/internal/ai-smoke") {
      const expected = Deno.env.get("CRAWLER_SYNC_SECRET") || "";
      if (!expected || req.headers.get("x-sync-secret") !== expected) return json({ detail: "점검 권한이 없습니다." }, 401);
      return json(await refineSchedule({ date: "2026-07-14", classes: [], personal: [], tasks: [{ title: "자료구조 복습", duration: 30, priority: "보통" }], preferences: { availableStart: "09:00", availableEnd: "18:00" } }));
    }

    const user = await requireUser(req);
    if (req.method === "POST" && path === "/notices/refresh") return json(await refreshNotices());
    const summaryMatch = path.match(/^\/notices\/(\d+)\/summary$/);
    if (req.method === "POST" && summaryMatch) return json(await noticeSummary(summaryMatch[1]));
    if (req.method === "POST" && path === "/events/sync/kmu") return json(await syncKmu(intParam(url, "pages", 5, 1, 10), intParam(url, "limit", 120, 1, 200)));
    if (req.method === "POST" && path === "/events/sync/story") return json(await syncStory(intParam(url, "pages", 1, 1, 5), intParam(url, "limit", 120, 1, 200)));
    if (req.method === "GET" && path === "/events/count") return json(await countEvents(url));
    if (req.method === "GET" && path === "/events/recommendations") return json(await recommendations(url, user));
    if (req.method === "GET" && path === "/events/favorites") return json(await favoriteEvents(user));
    if (req.method === "GET" && path === "/events") return json(await listEvents(url, user));
    const favoriteMatch = path.match(/^\/events\/(\d+)\/favorite$/);
    if (favoriteMatch && (req.method === "POST" || req.method === "DELETE")) {
      const result = await setFavorite(user, Number(favoriteMatch[1]), req.method === "POST");
      return req.method === "DELETE" ? new Response(null, { status: 204, headers: corsHeaders }) : json(result);
    }
    if (req.method === "POST" && path === "/ai/schedule/refine") { const body = await req.json(); return json(await refineSchedule(body?.context || {})); }
    if (req.method === "POST" && path === "/ai/schedule/chat") { const body = await req.json(); return json(await chatSchedule(String(body?.message || ""), body?.context || {}, Array.isArray(body?.history) ? body.history : [])); }
    return json({ detail: `지원하지 않는 경로입니다: ${req.method} ${path}` }, 404);
  } catch (error: any) {
    return errorResponse(error, Number(error?.status || (/로그인/.test(error?.message || "") ? 401 : 500)));
  }
});
