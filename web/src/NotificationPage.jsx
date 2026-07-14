import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellRing,
  BookOpenCheck,
  Brain,
  CalendarClock,
  CheckCircle2,
  Clock3,
  GraduationCap,
} from "lucide-react";
import { supabase } from "./supabase";
import { academicFallback2026 } from "./academicData";
import "./notification-page.css";

const defaultSettings = {
  classEnabled: true,
  classLead: 30,
  academicEnabled: true,
  academicLead: 3,
  aiEnabled: true,
  deadlineEnabled: true,
  deadlineDays: 3,
};

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const minuteOf = (time) => {
  const [hour, minute] = String(time || "00:00").slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
};
const atMinute = (date, minute) => {
  const value = new Date(`${date}T00:00:00`);
  value.setMinutes(minute);
  return value.getTime();
};
const formatDate = (date) => {
  const value = new Date(`${date}T00:00:00`);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${value.getMonth() + 1}월 ${value.getDate()}일 ${days[value.getDay()]}요일`;
};

function SettingSwitch({ checked, onChange, label }) {
  return <button type="button" className={`notification-switch ${checked ? "on" : ""}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>;
}

export default function NotificationPage() {
  const [settings, setSettings] = useState(() => ({ ...defaultSettings, ...readJson("kmu-notification-settings", {}) }));
  const [rows, setRows] = useState([]);
  const [activeTimetableId, setActiveTimetableId] = useState(null);
  const [permission, setPermission] = useState(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) {
          if (!cancelled) setRows([]);
          return;
        }
        const savedTimetableId = Number(localStorage.getItem("kmu-active-timetable-id"));
        let collectionQuery = supabase
          .from("timetable_collections")
          .select("id")
          .eq("user_id", authData.user.id);
        if (Number.isFinite(savedTimetableId) && savedTimetableId > 0) {
          collectionQuery = collectionQuery.eq("id", savedTimetableId);
        } else {
          collectionQuery = collectionQuery.order("updated_at", { ascending: false }).limit(1);
        }
        const { data: collections, error: collectionError } = await collectionQuery;
        if (collectionError) throw collectionError;
        const currentTimetableId = collections?.[0]?.id || null;
        if (!currentTimetableId) {
          if (!cancelled) {
            setActiveTimetableId(null);
            setRows([]);
          }
          return;
        }
        const { data: timetableRows, error: timetableError } = await supabase
          .from("timetables")
          .select("*")
          .eq("user_id", authData.user.id)
          .eq("timetable_id", currentTimetableId)
          .order("weekday")
          .order("start_time");
        if (timetableError) throw timetableError;
        if (!cancelled) {
          setActiveTimetableId(currentTimetableId);
          setRows(timetableRows || []);
        }
      } catch (error) {
        console.error("알림 시간표 로드 실패", error);
        if (!cancelled) setRows([]);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    localStorage.setItem("kmu-notification-settings", JSON.stringify(next));
  };

  const notifications = useMemo(() => {
    const now = new Date();
    const today = dateKey(now);
    const todayWeekday = (now.getDay() + 6) % 7;
    const items = [];

    if (settings.classEnabled) {
      rows.filter((row) => Number(row.weekday) === todayWeekday).forEach((row) => {
        const start = atMinute(today, minuteOf(row.start_time));
        items.push({
          id: `class-${row.id || row.subject}-${row.start_time}`,
          type: "class",
          title: `${row.subject || "수업"} 시작 ${settings.classLead}분 전`,
          detail: `${String(row.start_time).slice(0, 5)} · ${row.classroom || "강의실 미정"}`,
          when: "오늘",
          sortAt: start,
          notifyAt: start - settings.classLead * 60000,
        });
      });
    }

    if (settings.academicEnabled) {
      academicFallback2026.filter((event) => event.end_date >= today).slice(0, 12).forEach((event) => {
        const urgent = event.event_type === "makeup" || /휴강|휴업|대체수업/.test(event.title);
        const sortAt = new Date(`${event.start_date}T09:00:00`).getTime();
        items.push({
          id: `academic-${event.id}`,
          type: urgent ? "academic-urgent" : "academic",
          title: event.title,
          detail: urgent ? "시간표 변경 가능성이 있는 중요 학사일정입니다." : "계명대학교 학사일정",
          when: formatDate(event.start_date),
          sortAt,
          notifyAt: sortAt - settings.academicLead * 86400000,
          urgent,
        });
      });
    }

    if (settings.aiEnabled) {
      const aiSchedule = readJson("kmu-ai-schedule", []);
      if (Array.isArray(aiSchedule)) aiSchedule.filter((item) => item.planDate === today && item.type === "task").forEach((item, index) => {
        const start = atMinute(today, Number(item.start));
        items.push({ id: `ai-${item.taskId || index}-${today}`, type: "ai", title: item.title, detail: "AI 추천 일정 시작 15분 전", when: "오늘", sortAt: start, notifyAt: start - 900000 });
      });
      const studyPlan = readJson("kmu-study-plan", []);
      if (Array.isArray(studyPlan)) studyPlan.filter((item) => !item.done && item.date >= today).slice(0, 8).forEach((item) => {
        const sortAt = new Date(`${item.date}T20:00:00`).getTime();
        items.push({ id: `study-${item.id}`, type: "study", title: `${item.subject} 학습 완료 목표`, detail: item.section, when: `${formatDate(item.date)}까지`, sortAt, notifyAt: sortAt - 86400000 });
      });
    }

    if (settings.deadlineEnabled) {
      const personalSchedules = readJson("kmu-personal-schedules", []);
      if (Array.isArray(personalSchedules)) personalSchedules
        .filter((item) => !item.completed && item.schedule_date >= today)
        .slice(0, 12)
        .forEach((item) => {
          const sortAt = atMinute(item.schedule_date, minuteOf(item.start_time));
          const reminder = Number(item.reminder_minutes || 0);
          items.push({
            id: `personal-${item.id}`,
            type: "personal",
            title: item.title,
            detail: `${item.category || "개인 일정"}${item.location ? ` · ${item.location}` : ""}`,
            when: formatDate(item.schedule_date),
            sortAt,
            notifyAt: reminder > 0 ? sortAt - reminder * 60000 : Number.POSITIVE_INFINITY,
          });
        });
      const tasks = readJson("kmu-ai-tasks", []);
      if (Array.isArray(tasks)) tasks.filter((task) => !task.done && task.deadline >= today).forEach((task) => {
        const sortAt = new Date(`${task.deadline}T23:59:00`).getTime();
        const daysLeft = Math.ceil((sortAt - now.getTime()) / 86400000);
        if (daysLeft <= settings.deadlineDays) items.push({ id: `deadline-${task.id}`, type: "deadline", title: `${task.title} 마감 임박`, detail: `우선순위 ${task.priority || "보통"}`, when: daysLeft <= 0 ? "오늘 마감" : `D-${daysLeft}`, sortAt, notifyAt: sortAt - settings.deadlineDays * 86400000 });
      });
    }

    return items.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.sortAt - b.sortAt).slice(0, 18);
  }, [rows, settings, activeTimetableId]);

  useEffect(() => {
    if (permission !== "granted" || typeof Notification === "undefined") return undefined;
    const check = () => {
      const sent = readJson("kmu-sent-notifications", []);
      const now = Date.now();
      const due = notifications.filter((item) => item.notifyAt <= now && item.sortAt >= now - 3600000 && !sent.includes(item.id)).slice(0, 3);
      due.forEach((item) => new Notification(item.title, { body: `${item.when} · ${item.detail}` }));
      if (due.length) localStorage.setItem("kmu-sent-notifications", JSON.stringify([...sent, ...due.map((item) => item.id)].slice(-100)));
    };
    check();
    const timer = window.setInterval(check, 60000);
    return () => window.clearInterval(timer);
  }, [notifications, permission]);

  async function requestPermission() {
    if (typeof Notification === "undefined") {
      setNotice("이 브라우저는 시스템 알림을 지원하지 않습니다.");
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    setNotice(result === "granted" ? "브라우저 알림이 활성화되었습니다." : "브라우저 설정에서 알림 권한을 허용해주세요.");
  }

  const settingCards = [
    { key: "classEnabled", icon: Clock3, title: "수업 알림", text: "수업 시작 전에 강의실과 시작 시간을 알려드립니다.", control: <select value={settings.classLead} onChange={(e) => update("classLead", Number(e.target.value))} disabled={!settings.classEnabled}><option value="10">10분 전</option><option value="15">15분 전</option><option value="30">30분 전</option><option value="60">1시간 전</option></select> },
    { key: "academicEnabled", icon: GraduationCap, title: "학사일정 알림", text: "보강·휴강·대체수업은 중요 알림으로 강조합니다.", control: <select value={settings.academicLead} onChange={(e) => update("academicLead", Number(e.target.value))} disabled={!settings.academicEnabled}><option value="1">1일 전</option><option value="3">3일 전</option><option value="7">7일 전</option></select>, important: true },
    { key: "aiEnabled", icon: Brain, title: "AI 일정·공부 계획", text: "추천 일정 시작과 과목별 학습 완료 목표를 알려드립니다." },
    { key: "deadlineEnabled", icon: CalendarClock, title: "마감 임박 일정", text: "AI 일정에 등록한 할 일의 마감이 가까워지면 알려드립니다.", control: <select value={settings.deadlineDays} onChange={(e) => update("deadlineDays", Number(e.target.value))} disabled={!settings.deadlineEnabled}><option value="1">1일 이내</option><option value="3">3일 이내</option><option value="7">7일 이내</option></select> },
  ];

  const iconFor = (type) => ({ class: Clock3, academic: GraduationCap, "academic-urgent": AlertTriangle, ai: Brain, study: BookOpenCheck, deadline: CalendarClock, personal: CalendarClock }[type] || Bell);

  return <div className="notification-page">
    <section className="notification-hero"><span><BellRing /></span><div><p>KMU SMART NOTIFICATION</p><h1>알림 설정</h1><small>수업과 학사일정, AI 계획의 중요한 순간만 놓치지 않도록 알려드립니다.</small></div><button type="button" onClick={requestPermission}>{permission === "granted" ? <CheckCircle2 /> : <Bell />} {permission === "granted" ? "브라우저 알림 사용 중" : "브라우저 알림 켜기"}</button></section>
    {notice && <p className="notification-notice" role="status">{notice}</p>}
    <section className="notification-settings">{settingCards.map(({ key, icon: Icon, title, text, control, important }) => <article className={important ? "important" : ""} key={key}><header><span><Icon /></span><SettingSwitch checked={settings[key]} onChange={(value) => update(key, value)} label={`${title} ${settings[key] ? "끄기" : "켜기"}`} /></header><h2>{title}{important && <i>중요 알림</i>}</h2><p>{text}</p>{control && <label>알림 기준{control}</label>}</article>)}</section>
    <section className="notification-feed"><header><div><h2>예정된 알림</h2><p>현재 선택된 시간표와 저장된 AI 계획을 기준으로 표시합니다.</p></div><span>{notifications.length}개</span></header><div>{notifications.length ? notifications.map((item) => { const Icon = iconFor(item.type); return <article className={item.urgent ? "urgent" : item.type} key={item.id}><span><Icon /></span><div><b>{item.title}</b><p>{item.detail}</p></div><time>{item.when}</time>{item.urgent && <i>필독</i>}</article>; }) : <div className="notification-empty"><Bell /><b>예정된 알림이 없습니다.</b><span>선택한 시간표나 AI 계획을 추가하면 여기에 표시됩니다.</span></div>}</div></section>
  </div>;
}
