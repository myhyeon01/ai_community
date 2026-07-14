import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.110.2";

const url = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";

if (!url || !serviceKey) throw new Error("Supabase Edge Function 기본 환경변수가 없습니다.");

export const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function requireUser(req: Request): Promise<User> {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("로그인이 필요합니다."), { status: 401 });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw Object.assign(new Error("로그인 세션이 만료되었습니다."), { status: 401 });
  return data.user;
}

export async function readCache<T>(key: string): Promise<T | null> {
  const { data } = await admin.from("kmu_edge_cache").select("payload,expires_at").eq("cache_key", key).maybeSingle();
  if (!data || new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data.payload as T;
}

export async function writeCache(key: string, payload: unknown, ttlSeconds: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const { error } = await admin.from("kmu_edge_cache").upsert({
    cache_key: key,
    payload,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function removeCache(prefix: string): Promise<void> {
  await admin.from("kmu_edge_cache").delete().like("cache_key", `${prefix}%`);
}
