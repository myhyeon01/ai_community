import { supabase } from "./supabase";

const TABLE = "ai_recommended_schedules";

async function userId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) return "";
  return data.user.id;
}

export async function loadRecommendedSchedule(planDate) {
  const id = await userId();
  if (!id || !planDate) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select("plan_date,items,source,message,context,schedule_version,updated_at")
    .eq("user_id", id)
    .eq("plan_date", planDate)
    .maybeSingle();
  if (error) {
    console.warn("[aiScheduleStore] 추천 일정을 불러오지 못했습니다.", error);
    return null;
  }
  return data || null;
}

export async function saveRecommendedSchedule({
  planDate,
  items,
  source = "rules",
  message = "",
  context = {},
  scheduleVersion = 3,
}) {
  const id = await userId();
  if (!id || !planDate || !Array.isArray(items)) return false;
  const { error } = await supabase.from(TABLE).upsert({
    user_id: id,
    plan_date: planDate,
    items,
    source,
    message,
    context,
    schedule_version: scheduleVersion,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,plan_date" });
  if (error) {
    console.warn("[aiScheduleStore] 추천 일정을 저장하지 못했습니다.", error);
    return false;
  }
  return true;
}
