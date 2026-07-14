export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function errorResponse(error: unknown, status = 500): Response {
  const detail = error instanceof Error ? error.message : String(error || "알 수 없는 오류");
  return json({ detail }, status);
}

export function routePath(url: URL): string {
  const marker = "/kmu-api";
  const index = url.pathname.indexOf(marker);
  const value = index >= 0 ? url.pathname.slice(index + marker.length) : url.pathname;
  return value.replace(/\/$/, "") || "/";
}

export function intParam(url: URL, key: string, fallback: number, min: number, max: number): number {
  const parsed = Number(url.searchParams.get(key));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

