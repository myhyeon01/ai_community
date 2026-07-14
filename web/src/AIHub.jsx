import React, { useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  Brain,
  Check,
  Clock3,
  Coffee,
  MapPin,
  Plus,
  Route,
  Sparkles,
  Trash2,
} from "lucide-react";
import { supabase } from "./supabase";
import { loadUserState, readLocalState, saveUserStateLater, writeLocalState } from "./appState";
import { loadRecommendedSchedule, saveRecommendedSchedule } from "./aiScheduleStore";
import { academicFallback2026 } from "./academicData";
import { api } from "./api";
import "./ai-hub.css";

const dayNames = ["월", "화", "수", "목", "금", "토", "일"];
const AI_SCHEDULE_VERSION = 3;
const toMinutes = (time) => {
  const [hour, minute] = String(time).slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
};
const toTime = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const cleanScheduleSubtitle = (subtitle) => String(subtitle || "")
  .replace(/\s*·?\s*전환 시간 15분 반영/g, "")
  .trim();
const studyDeadlineLabel = (date) => {
  const value = new Date(`${date}T00:00:00`);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  if (Number.isNaN(value.getTime())) return `${date}까지`;
  return `${value.getFullYear()}년 ${value.getMonth() + 1}월 ${value.getDate()}일 ${weekdays[value.getDay()]}요일까지`;
};
const dateKey = (date) => {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};
const weekday = (date) => (new Date(`${date}T00:00:00`).getDay() + 6) % 7;
const readStore = (key, fallback = []) => {
  return readLocalState(key, fallback) || fallback;
};
const writeStore = (key, value) => {
  return saveUserStateLater(key, value);
};
const createId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function occursOnDate(item, targetDate) {
  const startDate = String(item.schedule_date || "").slice(0, 10);
  if (!startDate || startDate > targetDate || item.completed) return false;
  const repeat = item.repeat_type || "none";
  if (repeat === "none") return startDate === targetDate;
  const start = new Date(`${startDate}T00:00:00`);
  const target = new Date(`${targetDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(target.getTime())) return false;
  if (repeat === "daily") return true;
  if (repeat === "weekly") return start.getDay() === target.getDay();
  if (repeat === "monthly") return start.getDate() === target.getDate();
  return startDate === targetDate;
}

function personalSchedulesForDate(items, targetDate) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => occursOnDate(item, targetDate))
    .map((item) => ({
      start: toMinutes(item.start_time),
      end: toMinutes(item.end_time),
      title: item.title || "개인 일정",
      subtitle: [item.category, item.location].filter(Boolean).join(" · ") || "개인 일정",
      type: "personal",
      personalScheduleId: item.id,
    }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start);
}

function studyTargetsForDate(items, targetDate) {
  const target = new Date(`${targetDate}T00:00:00`);
  const weekLater = new Date(target);
  weekLater.setDate(weekLater.getDate() + 7);
  const lastDate = dateKey(weekLater);
  const unfinished = (Array.isArray(items) ? items : [])
    .filter((item) => !item.done && item.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const imminent = unfinished.filter((item) => item.date <= lastDate);
  return (imminent.length ? imminent : unfinished.slice(0, 1)).slice(0, 3);
}

function useSchedulerData() {
  const [rows, setRows] = useState([]);
  const [profile, setProfile] = useState(null);
  const [personalSchedules, setPersonalSchedules] = useState(() => {
    const stored = readStore("kmu-personal-schedules");
    return Array.isArray(stored) ? stored : [];
  });
  useEffect(() => {
    Promise.all([
      supabase.from("timetables").select("*").order("weekday").order("start_time"),
      supabase.from("profiles").select("*").single(),
      supabase.from("personal_schedules").select("*").order("schedule_date").order("start_time"),
    ]).then(([courses, user, schedules]) => {
      setRows(courses.data || []);
      setProfile(user.data || null);
      if (!schedules.error && Array.isArray(schedules.data)) {
        writeLocalState("kmu-personal-schedules", schedules.data);
        setPersonalSchedules(schedules.data);
      }
    });
  }, []);
  return { rows, profile, personalSchedules };
}

function appliedDay(date) {
  const event = academicFallback2026.find(
    (item) => item.start_date <= date && item.end_date >= date && item.event_type === "makeup",
  );
  return event?.applied_weekday ?? weekday(date);
}
function classesFor(rows, date) {
  return rows
    .filter((row) => row.weekday === appliedDay(date))
    .map((row) => ({
      start: toMinutes(row.start_time), end: toMinutes(row.end_time),
      title: row.subject, subtitle: row.classroom || "강의실 미정", type: "class",
    }))
    .sort((a, b) => a.start - b.start);
}
function freeSlots(blocks, start = 540, end = 1320) {
  const merged = [...blocks].sort((a, b) => a.start - b.start);
  const slots = [];
  let cursor = start;
  for (const block of merged) {
    if (block.start > cursor) slots.push({ start: cursor, end: block.start });
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < end) slots.push({ start: cursor, end });
  return slots;
}

function chooseLunchSlot(blocks) {
  const lunchStart = 720; // 12:00
  const lunchEnd = 840; // 14:00
  const targetStart = 750; // 가능하면 12:30 시작
  const preferredDuration = 60;
  const minimumDuration = 40;
  return freeSlots(blocks, lunchStart, lunchEnd)
    .filter((slot) => slot.end - slot.start >= minimumDuration)
    .map((slot) => {
      const duration = Math.min(preferredDuration, slot.end - slot.start);
      const latestStart = slot.end - duration;
      const start = Math.min(Math.max(targetStart, slot.start), latestStart);
      return { start, end: start + duration };
    })
    .sort((a, b) => Math.abs(a.start - targetStart) - Math.abs(b.start - targetStart))[0] || null;
}

function withTransitionBuffer(blocks, minutes = 15) {
  return blocks.map((block) => ({
    ...block,
    start: Math.max(0, block.start - minutes),
    end: Math.min(1440, block.end + minutes),
  }));
}

const defaultAiPreferences = {
  homeLocation: "집",
  toCampusMinutes: 60,
  fromCampusMinutes: 60,
  availableStart: "07:00",
  availableEnd: "22:00",
};

function commuteBlocks(fixedBlocks, preferences) {
  if (!fixedBlocks.length) return [];
  const ordered = [...fixedBlocks].sort((a, b) => a.start - b.start);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const toCampus = Math.max(0, Number(preferences.toCampusMinutes) || 0);
  const fromCampus = Math.max(0, Number(preferences.fromCampusMinutes) || 0);
  const dayStart = toMinutes(preferences.availableStart || "07:00");
  const blocks = [];
  if (toCampus > 0) {
    blocks.push({
      start: Math.max(dayStart, first.start - toCampus),
      end: first.start,
      title: "등교 이동",
      subtitle: `${preferences.homeLocation || "집"} → 계명대학교 · ${toCampus}분`,
      type: "commute",
    });
  }
  if (fromCampus > 0) {
    blocks.push({
      start: last.end,
      // 활동 가능 종료 시각은 할 일 배치 범위일 뿐, 필수 하교 이동을
      // 없애는 기준이 아니다. 야간 수업 뒤에도 자정까지 하교를 표시한다.
      end: Math.min(1440, last.end + fromCampus),
      title: "하교 이동",
      subtitle: `계명대학교 → ${preferences.homeLocation || "집"} · ${fromCampus}분`,
      type: "commute",
    });
  }
  return blocks.filter((item) => item.end > item.start);
}

function aiItemsToPlan(items, date) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    start: toMinutes(item.start),
    end: toMinutes(item.end),
    planDate: date,
    scheduleVersion: AI_SCHEDULE_VERSION,
  })).filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
}

const fixedScheduleTypes = new Set(["class", "personal", "commute"]);
const flexibleScheduleTypes = new Set(["task", "study", "rest"]);

function normalizedScheduleTitle(value) {
  return String(value || "").toLocaleLowerCase("ko").replace(/\s+/g, "").replace(/[^0-9a-z가-힣]/gi, "");
}

function schedulesOverlap(left, right) {
  return left.start < right.end && left.end > right.start;
}

function repeatsFixedSchedule(item, fixedItems) {
  const title = normalizedScheduleTitle(item.title);
  const description = `${item.title || ""} ${item.subtitle || ""}`;
  if (!title) return true;
  return fixedItems.some((fixed) => {
    const fixedTitle = normalizedScheduleTitle(fixed.title);
    if (!fixedTitle) return false;
    if (title === fixedTitle) return true;
    return (title.includes(fixedTitle) || fixedTitle.includes(title))
      && /수업|강의|개인\s*일정|이동|등교|하교/.test(description);
  });
}

function mergeFixedConflicts(items) {
  const groups = [];
  items.sort((a, b) => a.start - b.start || a.end - b.end).forEach((item) => {
    const current = groups.at(-1);
    if (current && current.start < item.end && current.end > item.start) {
      current.start = Math.min(current.start, item.start);
      current.end = Math.max(current.end, item.end);
      current.items.push(item);
      return;
    }
    groups.push({ start: item.start, end: item.end, items: [item] });
  });
  return groups.map((group) => {
    if (group.items.length === 1) return group.items[0];
    return {
      start: group.start,
      end: group.end,
      title: "일정 충돌 확인",
      subtitle: group.items.map((item) => `${item.title} ${toTime(item.start)}~${toTime(item.end)}`).join(" · "),
      type: "conflict",
      planDate: group.items[0].planDate,
      scheduleVersion: AI_SCHEDULE_VERSION,
    };
  });
}

function cleanPlanForDisplay(items) {
  const fixed = items.filter((item) => fixedScheduleTypes.has(item.type))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
  const accepted = [];
  const occupied = [...fixed];
  const titles = new Set();
  items.filter((item) => flexibleScheduleTypes.has(item.type))
    .sort((a, b) => a.start - b.start)
    .forEach((item) => {
      if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.end <= item.start) return;
      const title = normalizedScheduleTitle(item.title);
      if (!title || titles.has(title) || repeatsFixedSchedule(item, fixed)) return;
      if (withTransitionBuffer(occupied).some((block) => schedulesOverlap(item, block))) return;
      titles.add(title);
      accepted.push(item);
      occupied.push(item);
    });
  return [...mergeFixedConflicts(fixed), ...accepted].sort((a, b) => a.start - b.start || a.end - b.end);
}

function planSignature(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `${item.type}|${normalizedScheduleTitle(item.title)}|${item.start}|${item.end}`)
    .sort()
    .join("\n");
}

function sanitizeAiPlan(aiItems, protectedItems, preferences, date) {
  const dayStart = toMinutes(preferences.availableStart || "07:00");
  const dayEnd = toMinutes(preferences.availableEnd || "22:00");
  const fixed = protectedItems.map((item) => ({ ...item, planDate: date }));
  const occupied = [...fixed];
  const accepted = [];
  const titles = new Set();

  aiItems.filter((item) => flexibleScheduleTypes.has(item.type))
    .sort((a, b) => a.start - b.start)
    .forEach((item) => {
      const title = normalizedScheduleTitle(item.title);
      if (!title || titles.has(title) || repeatsFixedSchedule(item, fixed)) return;
      const duration = Math.max(15, Math.min(180, item.end - item.start));
      if (!Number.isFinite(duration)) return;
      let candidate = { ...item, end: item.start + duration, planDate: date, scheduleVersion: AI_SCHEDULE_VERSION };
      const buffered = withTransitionBuffer(occupied);
      const fits = candidate.start >= dayStart && candidate.end <= dayEnd
        && !buffered.some((block) => schedulesOverlap(candidate, block));
      if (!fits) {
        const slots = freeSlots(buffered, dayStart, dayEnd)
          .filter((slot) => slot.end - slot.start >= duration);
        const slot = slots.find((value) => value.start >= Math.max(dayStart, candidate.start)) || slots[0];
        if (!slot) return;
        candidate = { ...candidate, start: slot.start, end: slot.start + duration };
      }
      titles.add(title);
      accepted.push(candidate);
      occupied.push(candidate);
    });

  return [...fixed, ...accepted].sort((a, b) => a.start - b.start || a.end - b.end);
}

function scheduleContext({ date, classes, personal, commute, studyTargets, tasks, preferences, draftPlan }) {
  const fixedBlocks = [...classes, ...personal, ...commute].map((item) => ({
    start: toTime(item.start), end: toTime(item.end), title: item.title, type: item.type,
  }));
  return {
    date,
    weekday: dayNames[appliedDay(date)],
    preferences,
    fixed_blocks: fixedBlocks,
    study_targets: studyTargets.map((item) => ({ subject: item.subject, section: item.section, deadline: item.date })),
    tasks: tasks.filter((item) => !item.done).map((item) => ({ title: item.title, duration_minutes: Number(item.duration), priority: item.priority, deadline: item.deadline })),
    draft_plan: draftPlan.filter((item) => !["class", "personal", "commute"].includes(item.type)).map((item) => ({
      start: toTime(item.start), end: toTime(item.end), title: item.title, subtitle: item.subtitle, type: item.type,
    })),
  };
}

export function AISchedulePage() {
  const { rows, personalSchedules } = useSchedulerData();
  const today = dateKey(new Date());
  const [date, setDate] = useState(today);
  const [tasks, setTasks] = useState(() => {
    const stored = readStore("kmu-ai-tasks");
    return Array.isArray(stored) ? stored : [];
  });
  const [storedSchedule] = useState(() => {
    const stored = readStore("kmu-ai-schedule");
    return Array.isArray(stored) ? stored : [];
  });
  const scheduleNeedsRefresh = storedSchedule.some(
    (item) => item.type === "task" && item.scheduleVersion !== AI_SCHEDULE_VERSION,
  );
  const [plan, setPlan] = useState(() => scheduleNeedsRefresh ? [] : storedSchedule);
  const [form, setForm] = useState({ title: "", duration: 60, priority: "보통", deadline: today });
  const [preferences, setPreferences] = useState(() => ({
    ...defaultAiPreferences,
    ...readStore("kmu-ai-preferences", {}),
  }));
  const [aiBusy, setAiBusy] = useState(false);
  const [stateReady, setStateReady] = useState(false);
  const [message, setMessage] = useState(() => scheduleNeedsRefresh
    ? "이전 방식으로 만든 일정은 전환 시간이 실제 시각에 반영되지 않아 초기화했습니다. AI 일정 만들기를 다시 눌러주세요."
    : "");
  useEffect(() => {
    let active = true;
    Promise.all([
      loadUserState("kmu-ai-tasks", []),
      loadUserState("kmu-ai-schedule", []),
      loadUserState("kmu-ai-preferences", {}),
      loadUserState("kmu-study-plan", []),
    ]).then(([nextTasks, nextSchedule, nextPreferences]) => {
      if (!active) return;
      if (Array.isArray(nextTasks)) setTasks(nextTasks);
      if (Array.isArray(nextSchedule)) {
        const stale = nextSchedule.some((item) => item.type === "task" && item.scheduleVersion !== AI_SCHEDULE_VERSION);
        setPlan(stale ? [] : nextSchedule);
        if (stale) writeStore("kmu-ai-schedule", []);
      }
      if (nextPreferences && typeof nextPreferences === "object" && !Array.isArray(nextPreferences)) {
        setPreferences((current) => ({ ...current, ...nextPreferences }));
      }
      setStateReady(true);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!stateReady) return undefined;
    let active = true;
    loadRecommendedSchedule(date).then((savedSchedule) => {
      if (!active || !Array.isArray(savedSchedule?.items)) return;
      const cloudItems = savedSchedule.items.map((item) => ({ ...item, planDate: item.planDate || date }));
      setPlan((current) => {
        const next = [
          ...current.filter((item) => item.planDate && item.planDate !== date),
          ...cloudItems,
        ].sort((a, b) => String(a.planDate || "").localeCompare(String(b.planDate || "")) || a.start - b.start);
        writeStore("kmu-ai-schedule", next);
        return next;
      });
    });
    return () => { active = false; };
  }, [date, stateReady]);
  const classes = useMemo(() => classesFor(rows, date), [rows, date]);
  const personalForDate = useMemo(
    () => personalSchedulesForDate(personalSchedules, date),
    [personalSchedules, date],
  );
  const commuteForDate = useMemo(
    // 등하교는 개인 일정이 아니라 그날 시간표의 첫/마지막 수업을 기준으로 한다.
    // 따라서 하교 이동은 마지막 수업 종료 시각에 바로 시작한다.
    () => commuteBlocks(classes, preferences),
    [classes, preferences],
  );
  const studyTargets = useMemo(
    () => studyTargetsForDate(readStore("kmu-study-plan"), date),
    [date, plan],
  );
  const visiblePlan = useMemo(
    () => cleanPlanForDisplay([
      ...classes.map((item) => ({ ...item, planDate: date })),
      ...personalForDate.map((item) => ({ ...item, planDate: date })),
      ...commuteForDate.map((item) => ({ ...item, planDate: date })),
      ...plan.filter((item) => (!item.planDate || item.planDate === date) && !fixedScheduleTypes.has(item.type)),
    ]),
    [classes, commuteForDate, date, personalForDate, plan],
  );
  useEffect(() => {
    if (!stateReady) return;
    const currentForDate = plan.filter((item) => !item.planDate || item.planDate === date);
    if (planSignature(currentForDate) === planSignature(visiblePlan)) return;
    const next = [
      ...plan.filter((item) => item.planDate && item.planDate !== date),
      ...visiblePlan.map((item) => ({ ...item, planDate: date })),
    ];
    setPlan(next);
    writeStore("kmu-ai-schedule", next);
    saveRecommendedSchedule({
      planDate: date,
      items: visiblePlan.map((item) => ({ ...item, planDate: date })),
      source: "normalized",
      message: "중복 일정과 시간 충돌을 정리했습니다.",
      scheduleVersion: AI_SCHEDULE_VERSION,
    });
  }, [date, plan, stateReady, visiblePlan]);
  useEffect(() => {
    if (scheduleNeedsRefresh) writeStore("kmu-ai-schedule", []);
  }, [scheduleNeedsRefresh]);
  useEffect(() => {
    writeStore("kmu-ai-preferences", preferences);
  }, [preferences]);
  useEffect(() => {
    const updatePlan = (event) => setPlan(Array.isArray(event.detail) ? event.detail : []);
    const updatePreferences = (event) => setPreferences((current) => ({ ...current, ...(event.detail || {}) }));
    window.addEventListener("kmu-ai-schedule-updated", updatePlan);
    window.addEventListener("kmu-ai-preferences-updated", updatePreferences);
    return () => {
      window.removeEventListener("kmu-ai-schedule-updated", updatePlan);
      window.removeEventListener("kmu-ai-preferences-updated", updatePreferences);
    };
  }, []);
  const saveTasks = (next) => {
    setTasks(next);
    return writeStore("kmu-ai-tasks", next);
  };
  function addTask(e) {
    e.preventDefault();
    const title = form.title.trim();
    const duration = Number(form.duration);
    if (!title) {
      setMessage("할 일 이름을 입력해주세요.");
      return;
    }
    if (!Number.isFinite(duration) || duration < 15) {
      setMessage("예상 소요 시간은 15분 이상으로 입력해주세요.");
      return;
    }
    const saved = saveTasks([...tasks, { ...form, title, id: createId(), duration, done: false }]);
    setForm({ ...form, title: "" });
    setMessage(saved ? `‘${title}’을(를) 할 일에 추가했습니다.` : "할 일은 추가했지만 브라우저에 저장하지 못했습니다.");
  }
  async function generate() {
    const order = { 높음: 0, 보통: 1, 낮음: 2 };
    const taskQueue = tasks.filter((task) => !task.done).sort((a, b) =>
      String(a.deadline || date).localeCompare(String(b.deadline || date)) || (order[a.priority] ?? 1) - (order[b.priority] ?? 1));
    const currentStudyTargets = studyTargetsForDate(readStore("kmu-study-plan"), date);
    const studyQueue = currentStudyTargets.map((item) => ({
      id: item.id,
      title: `${item.subject || "시험"} 공부`,
      duration: Math.max(30, Math.min(90, Number(item.end) - Number(item.start) || 60)),
      priority: item.date <= date ? "높음" : "보통",
      deadline: item.date,
      source: "study",
      section: item.section,
    }));
    const queue = [...studyQueue, ...taskQueue].sort((a, b) =>
      String(a.deadline || date).localeCompare(String(b.deadline || date)) || (order[a.priority] ?? 1) - (order[b.priority] ?? 1));
    const fixedItems = [...classes, ...personalForDate, ...commuteForDate];
    const occupied = [...fixedItems];
    const result = fixedItems.map((item) => ({ ...item, planDate: date }));
    const lunchSlot = chooseLunchSlot(occupied);
    if (lunchSlot) {
      const lunch = {
        ...lunchSlot,
        title: "점심 및 휴식",
        subtitle: "12:00~14:00 사이에 우선 확보한 식사 시간",
        type: "rest",
        planDate: date,
      };
      result.push(lunch);
      occupied.push(lunch);
    }
    let scheduledCount = 0;
    for (const task of queue) {
      const duration = Math.max(15, Number(task.duration) || 60);
      const slot = freeSlots(
        withTransitionBuffer(occupied),
        toMinutes(preferences.availableStart || "07:00"),
        toMinutes(preferences.availableEnd || "22:00"),
      ).find((item) => item.end - item.start >= duration);
      if (!slot) continue;
      const isStudy = task.source === "study";
      const item = {
        start: slot.start,
        end: slot.start + duration,
        title: task.title || "할 일",
        subtitle: isStudy
          ? `${task.section || "시험 범위 학습"} · ${task.deadline || date}까지 완료`
          : `${task.priority || "보통"} 우선순위 · ${task.deadline || date} 마감`,
        type: isStudy ? "study" : "task",
        taskId: isStudy ? undefined : task.id,
        studyPlanId: isStudy ? task.id : undefined,
        planDate: date,
        scheduleVersion: AI_SCHEDULE_VERSION,
      };
      result.push(item); occupied.push(item);
      scheduledCount += 1;
    }
    const next = result.sort((a, b) => a.start - b.start);
    setPlan(next);
    let saved = writeStore("kmu-ai-schedule", next);
    const lunchNote = lunchSlot ? "" : " 12:00~14:00에 40분 이상 빈 시간이 없어 점심은 자동 배치하지 못했습니다.";
    const fixedNote = personalForDate.length ? ` 개인 일정 ${personalForDate.length}건을 고정 시간으로 반영했습니다.` : "";
    const studyNote = studyQueue.length ? ` 공부 목표 ${studyQueue.length}건을 함께 검토했습니다.` : "";
    const fallbackMessage = !queue.length
      ? `완료되지 않은 할 일이나 가까운 공부 목표가 없어 수업·개인 일정·이동·휴식만 반영했습니다.${fixedNote}${lunchNote}`
      : !scheduledCount
        ? `입력한 소요 시간을 넣을 빈 시간이 없습니다. 시간이나 날짜를 조정해주세요.${lunchNote}`
        : `${queue.length}개 중 ${scheduledCount}개의 할 일과 공부 목표를 추천 일정에 배치했습니다.${fixedNote}${studyNote}${lunchNote}${saved ? "" : " (브라우저 저장 실패)"}`;
    const context = scheduleContext({
      date, classes, personal: personalForDate, commute: commuteForDate,
      studyTargets: currentStudyTargets, tasks, preferences, draftPlan: next,
    });
    const cloudSaved = await saveRecommendedSchedule({
      planDate: date,
      items: next,
      source: "rules",
      message: fallbackMessage,
      context,
      scheduleVersion: AI_SCHEDULE_VERSION,
    });
    const syncNote = cloudSaved ? "" : " 다른 기기 동기화에는 실패했습니다.";
    setMessage(`${fallbackMessage}${syncNote} AI가 세부 조건을 검토하고 있습니다.`);
    setAiBusy(true);
    try {
      const response = await api("/ai/schedule/refine", {
        method: "POST",
        body: JSON.stringify({ context }),
      });
      const aiItems = aiItemsToPlan(response.items, date);
      if (response.available && aiItems.length) {
        const protectedItems = [
          ...fixedItems,
          ...next.filter((item) => item.type === "rest" && /점심|식사/.test(item.title || "")),
        ];
        const fallbackFlexible = next.filter((item) => item.type === "task" || item.type === "study");
        const refined = sanitizeAiPlan(
          [...aiItems, ...fallbackFlexible],
          protectedItems,
          preferences,
          date,
        );
        setPlan(refined);
        saved = writeStore("kmu-ai-schedule", refined);
        const refinedCloudSaved = await saveRecommendedSchedule({
          planDate: date,
          items: refined,
          source: "openai",
          message: response.message || "",
          context,
          scheduleVersion: AI_SCHEDULE_VERSION,
        });
        setMessage(`${response.message}${saved ? "" : " 브라우저 저장에는 실패했습니다."}${refinedCloudSaved ? "" : " 다른 기기 동기화에는 실패했습니다."}`);
      } else {
        setMessage(`${fallbackMessage}${syncNote} ${response.message || "규칙 기반 추천을 사용했습니다."}`);
      }
    } catch {
      setMessage(`${fallbackMessage}${syncNote} AI 서버에 연결하지 못해 규칙 기반 추천을 유지했습니다.`);
    } finally {
      setAiBusy(false);
    }
  }

  return <AIFrame title="AI 일정 추천" description="수업과 마감일을 분석해 오늘 가능한 시간에 할 일을 자동 배치합니다." icon={Brain}>
    <div className="ai-two-column">
      <section className="ai-panel"><header><div><h2>추천 조건</h2><p>소요 시간과 마감일을 고려하고 일정 사이에 15분의 전환 시간을 확보합니다.</p></div><input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="일정 추천 날짜" /></header>
        <form className="task-form" onSubmit={addTask}>
          <label className="task-title-field"><span>할 일</span><input placeholder="예: 운영체제 과제" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label><span>예상 소요 시간 <small>(분)</small></span><input type="number" min="15" step="15" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} /><small className="field-help">15분 단위로 입력</small></label>
          <label><span>일정 우선순위 <small>(높을수록 먼저 배치)</small></span><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="높음">높음 · 먼저 배치</option><option value="보통">보통 · 일반 순서</option><option value="낮음">낮음 · 여유 시간</option></select></label>
          <label className="task-deadline-field"><span>마감일</span><input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></label>
          <button type="submit"><Plus />할 일 추가</button>
        </form>
        <section className="commute-settings">
          <header><Route /><div><b>등하교 및 활동 가능 시간</b><small>첫 일정 전 등교와 마지막 일정 후 하교 시간을 자동 확보합니다.</small></div></header>
          <div>
            <label><span>출발 장소</span><input value={preferences.homeLocation} onChange={(e) => setPreferences({ ...preferences, homeLocation: e.target.value })} placeholder="예: 집, 동대구역" /></label>
            <label><span>등교 <small>(분)</small></span><input type="number" min="0" step="5" value={preferences.toCampusMinutes} onChange={(e) => setPreferences({ ...preferences, toCampusMinutes: e.target.value })} /></label>
            <label><span>하교 <small>(분)</small></span><input type="number" min="0" step="5" value={preferences.fromCampusMinutes} onChange={(e) => setPreferences({ ...preferences, fromCampusMinutes: e.target.value })} /></label>
            <label><span>하루 시작</span><input type="time" value={preferences.availableStart} onChange={(e) => setPreferences({ ...preferences, availableStart: e.target.value })} /></label>
            <label><span>하루 종료</span><input type="time" value={preferences.availableEnd} onChange={(e) => setPreferences({ ...preferences, availableEnd: e.target.value })} /></label>
          </div>
        </section>
        {message && <p className="ai-form-message" role="status">{message}</p>}
        <div className="task-list">{tasks.map((task) => <article key={task.id} className={task.done ? "done" : ""}><button onClick={() => saveTasks(tasks.map((item) => item.id === task.id ? { ...item, done: !item.done } : item))}><Check /></button><div><b>{task.title}</b><small>예상 {task.duration}분 · {task.deadline} 마감 · 우선순위 {task.priority}</small></div><button onClick={() => saveTasks(tasks.filter((item) => item.id !== task.id))}><Trash2 /></button></article>)}</div>
        <button type="button" className="ai-primary" onClick={generate} disabled={aiBusy}><Sparkles />{aiBusy ? "AI가 일정 검토 중..." : "AI 일정 만들기"}</button>
      </section>
      <section className="ai-panel ai-result"><header><div><h2>{date} 추천 일정</h2><p>{dayNames[appliedDay(date)]}요일 · 수업 {classes.length}개 · 개인 일정 {personalForDate.length}개 · 이동 {commuteForDate.length}개 · 가까운 공부 목표 {studyTargets.length}개</p></div></header>
        {visiblePlan.length ? <div className="timeline">{visiblePlan.map((item, index) => <article className={item.type} key={`${item.start}-${index}`}><time>{toTime(item.start)}<span>{toTime(item.end)}</span></time><i></i><div><b>{item.title}</b><small>{cleanScheduleSubtitle(item.subtitle)}</small></div></article>)}</div> : <Empty text="할 일·개인 일정·공부 계획을 확인한 뒤 AI 일정 만들기를 눌러주세요." />}
      </section>
    </div>
  </AIFrame>;
}

export function StudyPlannerPage() {
  const { rows } = useSchedulerData();
  const subjects = [...new Set(rows.map((row) => row.subject).filter(Boolean))];
  const [form, setForm] = useState({ subject: subjects[0] || "", examDate: "2026-12-14", dailyMinutes: 90, chapters: "1장 운영체제 개요 > 프로세스와 스레드\n2장 CPU 스케줄링 > FCFS, SJF, RR\n3장 동기화 > 세마포어와 모니터" });
  const [plan, setPlan] = useState(() => {
    const stored = readStore("kmu-study-plan");
    return Array.isArray(stored) ? stored : [];
  });
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    loadUserState("kmu-study-plan", []).then((value) => {
      if (active && Array.isArray(value)) setPlan(value);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (!form.subject && subjects[0]) setForm((value) => ({ ...value, subject: subjects[0] })); }, [subjects.join("|")]);
  function generate(e) {
    e.preventDefault();
    const sections = form.chapters.split(/\n+/).map((item) => item.trim()).filter(Boolean);
    const subject = form.subject.trim();
    const dailyMinutes = Number(form.dailyMinutes);
    if (!subject) {
      setMessage("과목명을 입력해주세요.");
      return;
    }
    if (!sections.length) {
      setMessage("시험 범위를 한 줄에 하나씩 입력해주세요.");
      return;
    }
    if (!Number.isFinite(dailyMinutes) || dailyMinutes < 30) {
      setMessage("하루 목표 시간은 30분 이상으로 입력해주세요.");
      return;
    }
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const exam = new Date(`${form.examDate}T00:00:00`);
    if (Number.isNaN(exam.getTime()) || exam < start) {
      setMessage("시험일은 오늘 이후 날짜로 설정해주세요.");
      return;
    }
    const days = Math.max(1, Math.ceil((exam - start) / 86400000));
    const storedSchedule = readStore("kmu-ai-schedule");
    const aiSchedule = Array.isArray(storedSchedule) ? storedSchedule : [];
    const otherSubjectPlans = plan.filter((item) => item.subject !== subject);
    const occupiedByDate = new Map();
    const usedMinutesByDate = new Map();
    const result = [];
    let skipped = 0;

    for (const [index, section] of sections.entries()) {
      const offset = Math.min(days - 1, Math.floor((index * days) / sections.length));
      const date = new Date(start); date.setDate(start.getDate() + offset);
      const key = dateKey(date);
      if (!occupiedByDate.has(key)) {
        const saved = aiSchedule.filter((item) => item.planDate === key && Number.isFinite(item.start) && Number.isFinite(item.end));
        const otherStudyBlocks = otherSubjectPlans.filter((item) => item.date === key);
        occupiedByDate.set(key, [...classesFor(rows, key), ...saved, ...otherStudyBlocks]);
      }
      const used = usedMinutesByDate.get(key) || 0;
      const remaining = dailyMinutes - used;
      if (remaining < 30) {
        skipped += 1;
        continue;
      }
      const duration = Math.min(60, remaining);
      const slots = freeSlots(withTransitionBuffer(occupiedByDate.get(key)), 540, 1320)
        .filter((slot) => slot.end - slot.start >= duration);
      const eveningSlot = slots.find((slot) => slot.start >= 1020);
      const slot = eveningSlot || slots[slots.length - 1];
      if (!slot) {
        skipped += 1;
        continue;
      }
      const item = {
        id: createId(), date: key, start: slot.start, end: slot.start + duration,
        subject, section, place: slot.start >= 1020 ? "동산도서관 열람실" : "공학관 라운지",
        review: index === sections.length - 1, done: false,
      };
      result.push(item);
      occupiedByDate.get(key).push(item);
      usedMinutesByDate.set(key, used + duration);
    }

    if (!result.length) {
      setMessage("시간표와 기존 과목 계획 사이에서 공부 시간을 찾지 못했습니다. 하루 목표 시간이나 시험일을 조정해주세요.");
      return;
    }
    const merged = [...otherSubjectPlans, ...result]
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    setPlan(merged);
    const saved = writeStore("kmu-study-plan", merged);
    const subjectCount = new Set(merged.map((item) => item.subject)).size;
    setMessage(`${subject} 계획 ${result.length}개를 추가했습니다. 현재 총 ${subjectCount}과목을 관리 중입니다.${skipped ? ` ${skipped}개 범위는 시간이 부족해 제외되었습니다.` : ""}${saved ? "" : " 브라우저 저장에는 실패했습니다."}`);
  }
  function toggle(id) { const next = plan.map((item) => item.id === id ? { ...item, done: !item.done } : item); setPlan(next); writeStore("kmu-study-plan", next); }
  function removeSubject(subject) {
    const next = plan.filter((item) => item.subject !== subject);
    setPlan(next);
    writeStore("kmu-study-plan", next);
    setMessage(`${subject} 공부 계획을 삭제했습니다.`);
  }
  const plannedSubjects = [...new Set(plan.map((item) => item.subject).filter(Boolean))];
  return <AIFrame title="AI 공부 계획" description="시험 범위의 대단원과 소단원을 수업·추천 일정에 맞춰 날짜별로 배분합니다." icon={BookOpenCheck}>
    <div className="ai-two-column study-layout"><section className="ai-panel"><header><div><h2>시험 및 범위 입력</h2><p>과목을 바꿔가며 계획을 추가하면 여러 과목이 함께 저장됩니다.</p></div></header><form className="study-form" onSubmit={generate}><label>과목명<input list="subjects" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /><datalist id="subjects">{subjects.map((subject) => <option key={subject}>{subject}</option>)}</datalist></label><div><label>시험일<input type="date" value={form.examDate} onChange={(e) => setForm({ ...form, examDate: e.target.value })} /></label><label>하루 목표 시간 (분)<input type="number" min="30" step="15" value={form.dailyMinutes} onChange={(e) => setForm({ ...form, dailyMinutes: e.target.value })} /></label></div><label>시험 범위<textarea rows="9" value={form.chapters} onChange={(e) => setForm({ ...form, chapters: e.target.value })} /></label><button type="submit" className="ai-primary"><Sparkles />이 과목 공부 계획 추가</button></form>{message && <p className="ai-form-message" role="status">{message}</p>}{plannedSubjects.length > 0 && <div className="planned-subjects"><b>등록된 과목 계획</b><div>{plannedSubjects.map((subject) => <span key={subject}>{subject}<button type="button" onClick={() => removeSubject(subject)} aria-label={`${subject} 계획 삭제`}><Trash2 /></button></span>)}</div></div>}</section>
      <section className="ai-panel"><header><div><h2>과목별 학습 완료 목표</h2><p>시험일까지 학습 범위를 단계별 완료 목표로 나누었습니다.</p></div></header>{plan.length ? <div className="study-plan-list">{plan.map((item) => <article key={item.id} className={item.done ? "done" : ""}><button type="button" onClick={() => toggle(item.id)} aria-label={`${item.section} 완료 처리`}><Check /></button><div className="study-deadline"><span>완료 목표</span><b>{studyDeadlineLabel(item.date)}</b></div><div><b>{item.subject}</b><p>{item.section}</p><span className="study-place"><MapPin />권장 장소 · {item.place || "동산도서관 열람실"}</span>{item.review && <small>최종 복습 범위</small>}</div></article>)}</div> : <Empty text="시험 범위를 입력하면 언제까지 어디를 공부할지 완료 목표를 만들어드립니다." />}</section></div>
  </AIFrame>;
}

const campusActivities = [
  { min: 20, max: 45, title: "바우어관 산책과 휴식", place: "바우어관 앞 광장", tag: "휴식" },
  { min: 30, max: 70, title: "오늘 수업 핵심 내용 복습", place: "동산도서관 열람실", tag: "복습" },
  { min: 40, max: 90, title: "과제 한 단락 끝내기", place: "동산도서관 그룹스터디룸", tag: "과제" },
  { min: 45, max: 100, title: "학생식당에서 여유 있게 식사", place: "바우어관 학생식당", tag: "식사" },
  { min: 60, max: 130, title: "시험 범위 집중 학습", place: "동산도서관 또는 공학관 라운지", tag: "공부" },
  { min: 70, max: 180, title: "교내 체육시설에서 가벼운 운동", place: "체육관·운동장", tag: "운동" },
  { min: 90, max: 300, title: "전시 관람과 캠퍼스 산책", place: "행소박물관", tag: "문화" },
];
export function FreeTimePage() {
  const { rows } = useSchedulerData(); const [date, setDate] = useState(dateKey(new Date()));
  const classes = useMemo(() => classesFor(rows, date), [rows, date]);
  const gaps = freeSlots(classes, 540, 1320).filter((slot) => slot.end - slot.start >= 20);
  return <AIFrame title="공강 추천" description="실제 수업 사이 공강을 찾아 학교 안에서 할 수 있는 활동을 추천합니다." icon={Clock3}>
    <section className="ai-panel"><header><div><h2>{dayNames[appliedDay(date)]}요일 공강</h2><p>09:00~22:00 시간표와 교내 이용 장소를 기준으로 추천합니다.</p></div><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></header>
      <div className="gap-grid">{gaps.length ? gaps.map((gap, index) => { const duration = gap.end - gap.start; const options = campusActivities.filter((item) => duration >= item.min).sort((a, b) => Math.abs(duration - a.max) - Math.abs(duration - b.max)).slice(0, 3); return <article className="gap-card" key={index}><div className="gap-time"><Clock3 /><b>{toTime(gap.start)}~{toTime(gap.end)}</b><span>{Math.floor(duration / 60) ? `${Math.floor(duration / 60)}시간 ` : ""}{duration % 60 ? `${duration % 60}분` : ""}</span></div>{options.map((item) => <div className="activity" key={item.title}><span>{item.tag}</span><div><b>{item.title}</b><small><MapPin />{item.place}</small></div></div>)}</article>; }) : <Empty text="이 날짜에는 추천 가능한 공강이 없습니다." />}</div>
    </section>
  </AIFrame>;
}

export const schoolEvents = [
  { id: 1, category: "축제", title: "계명대학교 대동제", date: "2026-09-23", place: "성서캠퍼스 노천강당 일대", tags: ["전체", "문화"], description: "공연, 학생 부스와 푸드트럭이 함께하는 교내 대표 축제" },
  { id: 2, category: "SW", title: "AI·소프트웨어 개발 특강", date: "2026-09-10", place: "공학관 1101호", tags: ["컴퓨터공학", "AI", "개발"], description: "현직 개발자의 생성형 AI 서비스 개발 사례 특강" },
  { id: 3, category: "취업", title: "하반기 교내 취업박람회", date: "2026-09-17", place: "바우어관", tags: ["전체", "취업"], description: "기업 상담, 현장 면접과 이력서 컨설팅 제공" },
  { id: 4, category: "공모전", title: "KMU 캡스톤디자인 아이디어 공모전", date: "2026-10-08", place: "산학협력관", tags: ["공학", "컴퓨터공학", "창업"], description: "전공 문제를 해결하는 팀 프로젝트 아이디어 공모" },
  { id: 5, category: "비교과", title: "학습전략 워크숍", date: "2026-08-31", place: "동산도서관", tags: ["전체", "학습"], description: "시간관리와 시험 대비 학습전략을 실습하는 비교과 프로그램" },
  { id: 6, category: "특강", title: "글로벌 리더십 초청 특강", date: "2026-11-05", place: "의양관 운제실", tags: ["전체", "진로"], description: "글로벌 산업 변화와 대학생 진로 설계 강연" },
];
function AIFrame({ title, description, icon: Icon, children }) {
  return <div className="ai-feature-page"><section className="ai-hero"><span><Icon /></span><div><p>KMU SMART AI</p><h1>{title}</h1><small>{description}</small></div></section>{children}</div>;
}
function Empty({ text }) { return <div className="ai-empty"><Sparkles /><b>{text}</b></div>; }
