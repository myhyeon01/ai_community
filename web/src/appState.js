import { supabase } from "./supabase";

const TABLE = "user_app_state";

export const readLocalState = (key, fallback = null) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const hasLocalState = (key) => {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
};

export const writeLocalState = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const removeLocalState = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Local persistence is optional; callers still update in-memory state.
  }
};

const currentUserId = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) return "";
  return data.user.id;
};

export const loadUserState = async (key, fallback = null) => {
  const localValue = readLocalState(key, fallback);
  const userId = await currentUserId();
  if (!userId) return localValue;

  const { data, error } = await supabase
    .from(TABLE)
    .select("state_value")
    .eq("user_id", userId)
    .eq("state_key", key)
    .maybeSingle();

  if (error) {
    console.warn("[appState] 사용자 앱 상태를 불러오지 못했습니다.", { key, error });
    return localValue;
  }
  if (data) {
    const value = data.state_value ?? fallback;
    writeLocalState(key, value);
    return value;
  }
  if (hasLocalState(key)) await saveUserState(key, localValue);
  return localValue;
};

export const saveUserState = async (key, value) => {
  writeLocalState(key, value);
  const userId = await currentUserId();
  if (!userId) return false;

  const { error } = await supabase.from(TABLE).upsert(
    {
      user_id: userId,
      state_key: key,
      state_value: value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,state_key" },
  );
  if (error) {
    console.warn("[appState] 사용자 앱 상태를 저장하지 못했습니다.", { key, error });
    return false;
  }
  return true;
};

export const removeUserState = async (key) => {
  removeLocalState(key);
  const userId = await currentUserId();
  if (!userId) return false;

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("state_key", key);
  if (error) {
    console.warn("[appState] 사용자 앱 상태를 삭제하지 못했습니다.", { key, error });
    return false;
  }
  return true;
};

export const saveUserStateLater = (key, value) => {
  writeLocalState(key, value);
  saveUserState(key, value);
  return true;
};
