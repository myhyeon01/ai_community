import React, { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  MapPin,
  Pencil,
  Plus,
  Repeat2,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "./supabase";
import { readLocalState, writeLocalState } from "./appState";
import "./personal-schedule.css";

const STORAGE_KEY = "kmu-personal-schedules";
const categories = ["약속", "아르바이트", "병원", "운동", "동아리", "스터디", "기타"];
const repeatLabels = { none: "반복 안 함", daily: "매일", weekly: "매주", monthly: "매월" };
const priorityLabels = { high: "높음", normal: "보통", low: "낮음" };

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const emptyForm = () => ({
  title: "",
  category: "약속",
  schedule_date: todayKey(),
  start_time: "09:00",
  end_time: "10:00",
  location: "",
  memo: "",
  priority: "normal",
  repeat_type: "none",
  reminder_minutes: 30,
});
const readCached = () => {
  const value = readLocalState(STORAGE_KEY, []);
  return Array.isArray(value) ? value : [];
};
const cleanTime = (value) => String(value || "").slice(0, 5);
const formatDate = (value) => {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
};

export default function PersonalSchedulePage({ session }) {
  const [items, setItems] = useState(readCached);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("upcoming");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    supabase
      .from("personal_schedules")
      .select("*")
      .order("schedule_date")
      .order("start_time")
      .then(({ data, error }) => {
        if (active && !error && Array.isArray(data))
          setItems(data);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    writeLocalState(STORAGE_KEY, items);
  }, [items]);

  const visibleItems = useMemo(() => {
    const today = todayKey();
    return [...items]
      .filter((item) => {
        if (filter === "completed") return item.completed;
        if (filter === "all") return true;
        return !item.completed && item.schedule_date >= today;
      })
      .sort((a, b) =>
        `${a.schedule_date} ${cleanTime(a.start_time)}`.localeCompare(
          `${b.schedule_date} ${cleanTime(b.start_time)}`,
        ),
      );
  }, [items, filter]);

  const counts = useMemo(
    () => ({
      upcoming: items.filter((item) => !item.completed && item.schedule_date >= todayKey()).length,
      completed: items.filter((item) => item.completed).length,
      all: items.length,
    }),
    [items],
  );

  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  function resetForm() {
    setForm(emptyForm());
    setEditingId(null);
    setMessage("");
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) return setMessage("일정 제목을 입력해주세요.");
    if (!form.schedule_date) return setMessage("일정 날짜를 선택해주세요.");
    if (form.end_time <= form.start_time) return setMessage("종료 시간은 시작 시간보다 늦어야 합니다.");

    setSaving(true);
    setMessage("");
    const payload = {
      ...form,
      title: form.title.trim(),
      location: form.location.trim(),
      memo: form.memo.trim(),
      reminder_minutes: Number(form.reminder_minutes),
      user_id: session.user.id,
    };

    if (editingId) {
      const { data, error } = await supabase
        .from("personal_schedules")
        .update(payload)
        .eq("id", editingId)
        .select()
        .maybeSingle();
      setItems((current) =>
        current.map((item) =>
          item.id === editingId ? { ...item, ...payload, ...(error ? {} : data || {}) } : item,
        ),
      );
      setMessage(error ? "이 기기에 수정 내용을 저장했습니다." : "일정을 수정했습니다.");
    } else {
      const { data, error } = await supabase
        .from("personal_schedules")
        .insert(payload)
        .select()
        .maybeSingle();
      const created = error
        ? { ...payload, id: `local-${Date.now()}`, completed: false, created_at: new Date().toISOString() }
        : data;
      setItems((current) => [...current, created]);
      setMessage(error ? "이 기기에 일정을 저장했습니다." : "개인 일정을 등록했습니다.");
    }
    setSaving(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  function startEdit(item) {
    setEditingId(item.id);
    setForm({
      title: item.title || "",
      category: item.category || "기타",
      schedule_date: item.schedule_date,
      start_time: cleanTime(item.start_time),
      end_time: cleanTime(item.end_time),
      location: item.location || "",
      memo: item.memo || "",
      priority: item.priority || "normal",
      repeat_type: item.repeat_type || "none",
      reminder_minutes: Number(item.reminder_minutes ?? 30),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleComplete(item) {
    const completed = !item.completed;
    setItems((current) => current.map((value) => (value.id === item.id ? { ...value, completed } : value)));
    if (!String(item.id).startsWith("local-"))
      await supabase.from("personal_schedules").update({ completed }).eq("id", item.id);
  }

  async function remove(item) {
    if (!window.confirm(`'${item.title}' 일정을 삭제할까요?`)) return;
    setItems((current) => current.filter((value) => value.id !== item.id));
    if (!String(item.id).startsWith("local-"))
      await supabase.from("personal_schedules").delete().eq("id", item.id);
    if (editingId === item.id) resetForm();
  }

  return (
    <div className="personal-page">
      <section className="personal-hero">
        <span><CalendarClock /></span>
        <div><p>KMU PERSONAL SCHEDULE</p><h1>개인 일정</h1><small>약속, 아르바이트, 운동과 스터디 일정을 한곳에서 관리합니다.</small></div>
        <div className="personal-summary"><b>{counts.upcoming}</b><span>예정된 일정</span></div>
      </section>

      <div className="personal-layout">
        <section className="personal-form-card">
          <header>
            <div><span><Plus /></span><div><h2>{editingId ? "일정 수정" : "새 일정 등록"}</h2><p>시간과 알림 조건을 함께 설정하세요.</p></div></div>
            {editingId && <button type="button" onClick={resetForm}><X /> 취소</button>}
          </header>
          {message && <p className="personal-message" role="status">{message}</p>}
          <form onSubmit={submit} className="personal-form">
            <label className="wide">일정 제목<input value={form.title} onChange={(e) => change("title", e.target.value)} placeholder="예: 팀 프로젝트 회의" /></label>
            <label>종류<select value={form.category} onChange={(e) => change("category", e.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>우선순위<select value={form.priority} onChange={(e) => change("priority", e.target.value)}><option value="high">높음</option><option value="normal">보통</option><option value="low">낮음</option></select></label>
            <label className="wide">날짜<input type="date" value={form.schedule_date} onChange={(e) => change("schedule_date", e.target.value)} /></label>
            <label>시작 시간<input type="time" value={form.start_time} onChange={(e) => change("start_time", e.target.value)} /></label>
            <label>종료 시간<input type="time" value={form.end_time} onChange={(e) => change("end_time", e.target.value)} /></label>
            <label>반복<select value={form.repeat_type} onChange={(e) => change("repeat_type", e.target.value)}><option value="none">반복 안 함</option><option value="daily">매일</option><option value="weekly">매주</option><option value="monthly">매월</option></select></label>
            <label>알림<select value={form.reminder_minutes} onChange={(e) => change("reminder_minutes", e.target.value)}><option value="0">알림 없음</option><option value="10">10분 전</option><option value="30">30분 전</option><option value="60">1시간 전</option><option value="1440">하루 전</option></select></label>
            <label className="wide">장소<input value={form.location} onChange={(e) => change("location", e.target.value)} placeholder="장소 또는 강의실" /></label>
            <label className="wide">메모<textarea value={form.memo} onChange={(e) => change("memo", e.target.value)} placeholder="준비물이나 참고 내용을 입력하세요." rows="3" /></label>
            <button className="personal-submit" disabled={saving}>{editingId ? <Pencil /> : <Plus />}{saving ? "저장 중..." : editingId ? "수정 완료" : "일정 추가"}</button>
          </form>
        </section>

        <section className="personal-list-card">
          <header><div><h2>내 일정</h2><p>완료 여부와 우선순위별로 관리할 수 있습니다.</p></div><div className="personal-filters">{[["upcoming", "예정"], ["completed", "완료"], ["all", "전체"]].map(([key, label]) => <button type="button" className={filter === key ? "active" : ""} onClick={() => setFilter(key)} key={key}>{label} <b>{counts[key]}</b></button>)}</div></header>
          <div className="personal-list">
            {visibleItems.length ? visibleItems.map((item) => (
              <article className={`${item.completed ? "completed" : ""} priority-${item.priority}`} key={item.id}>
                <button className="personal-check" type="button" onClick={() => toggleComplete(item)} aria-label={item.completed ? "미완료로 변경" : "완료 처리"}>{item.completed ? <Check /> : <span />}</button>
                <div className="personal-date"><b>{formatDate(item.schedule_date)}</b><span>{cleanTime(item.start_time)}~{cleanTime(item.end_time)}</span></div>
                <div className="personal-detail"><div><i>{item.category}</i><i className={item.priority}>{priorityLabels[item.priority]}</i></div><h3>{item.title}</h3><p>{item.location && <span><MapPin />{item.location}</span>}{item.repeat_type !== "none" && <span><Repeat2 />{repeatLabels[item.repeat_type]}</span>}{Number(item.reminder_minutes) > 0 && <span><Bell />{Number(item.reminder_minutes) >= 1440 ? "하루 전 알림" : `${item.reminder_minutes}분 전 알림`}</span>}</p>{item.memo && <small>{item.memo}</small>}</div>
                <div className="personal-actions"><button type="button" onClick={() => startEdit(item)} aria-label="수정"><Pencil /></button><button type="button" onClick={() => remove(item)} aria-label="삭제"><Trash2 /></button></div>
              </article>
            )) : <div className="personal-empty"><CheckCircle2 /><b>{filter === "completed" ? "완료한 일정이 없습니다." : "등록된 일정이 없습니다."}</b><span>왼쪽에서 새 개인 일정을 추가해보세요.</span></div>}
          </div>
          {filter === "completed" && counts.completed > 0 && <button className="personal-reset" type="button" onClick={() => setFilter("upcoming")}><RotateCcw /> 예정 일정으로 돌아가기</button>}
        </section>
      </div>
    </div>
  );
}
