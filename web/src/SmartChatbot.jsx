import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronRight, Send, Sparkles, X } from "lucide-react";
import { api } from "./api";
import { loadUserState, readLocalState, saveUserState, saveUserStateLater } from "./appState";
import { saveRecommendedSchedule } from "./aiScheduleStore";
import "./smart-chatbot.css";

const HISTORY_KEY = "kmu-assistant-history";
const greeting = {
  role: "assistant",
  content: "안녕하세요! 앱 사용 방법을 안내하고, 현재 추천 일정도 함께 조정해드릴게요.",
};

function readStore(key, fallback) {
  return readLocalState(key, fallback);
}

function toMinutes(value) {
  if (Number.isFinite(value)) return Number(value);
  const [hour, minute] = String(value || "").split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : NaN;
}

function toTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function assistantContext(activePage, profile, pageGuide) {
  const plan = readStore("kmu-ai-schedule", []);
  const preferences = readStore("kmu-ai-preferences", {});
  const fixed = (Array.isArray(plan) ? plan : []).filter((item) =>
    ["class", "personal", "commute"].includes(item.type));
  return {
    current_page: activePage,
    student: {
      department: profile?.department || "",
      grade: profile?.grade || "",
    },
    app_guide: pageGuide,
    preferences,
    fixed_blocks: fixed.map((item) => ({
      start: toTime(Number(item.start)),
      end: toTime(Number(item.end)),
      title: item.title,
      type: item.type,
    })),
    tasks: readStore("kmu-ai-tasks", []),
    study_targets: readStore("kmu-study-plan", []),
    draft_plan: (Array.isArray(plan) ? plan : []).filter((item) =>
      !["class", "personal", "commute"].includes(item.type)).map((item) => ({
        start: toTime(Number(item.start)),
        end: toTime(Number(item.end)),
        title: item.title,
        subtitle: item.subtitle,
        type: item.type,
      })),
  };
}

function updatedCommuteBlocks(classes, preferences, planDate) {
  if (!classes.length) return [];
  const ordered = [...classes].sort((a, b) => a.start - b.start);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const startLimit = toMinutes(preferences.availableStart || "07:00");
  const toCampus = Math.max(0, Number(preferences.toCampusMinutes) || 0);
  const fromCampus = Math.max(0, Number(preferences.fromCampusMinutes) || 0);
  const result = [];
  if (toCampus > 0 && first.start - toCampus < first.start) result.push({
    start: Math.max(startLimit, first.start - toCampus), end: first.start,
    title: "등교 이동", subtitle: `${preferences.homeLocation || "집"} → 계명대학교 · ${toCampus}분`, type: "commute", planDate,
  });
  if (fromCampus > 0 && last.end < 1440) result.push({
    start: last.end, end: Math.min(1440, last.end + fromCampus),
    title: "하교 이동", subtitle: `계명대학교 → ${preferences.homeLocation || "집"} · ${fromCampus}분`, type: "commute", planDate,
  });
  return result.filter((item) => item.end > item.start);
}

function applyScheduleResponse(response) {
  const updates = response.preference_updates || {};
  const storedSchedule = readStore("kmu-ai-schedule", []);
  const current = Array.isArray(storedSchedule) ? storedSchedule : [];
  const planDate = current.find((item) => item.planDate)?.planDate || new Date().toISOString().slice(0, 10);
  const currentForDate = current.filter((item) => !item.planDate || item.planDate === planDate);
  const otherDates = current.filter((item) => item.planDate && item.planDate !== planDate);
  let nextPreferences = readStore("kmu-ai-preferences", {});
  if (Object.keys(updates).length) {
    nextPreferences = { ...nextPreferences, ...updates };
    saveUserStateLater("kmu-ai-preferences", nextPreferences);
    window.dispatchEvent(new CustomEvent("kmu-ai-preferences-updated", { detail: nextPreferences }));
  }
  const classes = currentForDate.filter((item) => item.type === "class");
  const personal = currentForDate.filter((item) => item.type === "personal");
  const commute = Object.keys(updates).length
    ? updatedCommuteBlocks(classes, nextPreferences, planDate)
    : currentForDate.filter((item) => item.type === "commute");
  const fixed = [...classes, ...personal, ...commute];
  const responseItems = Array.isArray(response.items) ? response.items : [];
  const flexible = responseItems.length ? responseItems.map((item) => ({
    ...item,
    start: toMinutes(item.start),
    end: toMinutes(item.end),
    planDate,
    scheduleVersion: 3,
  })).filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    : currentForDate.filter((item) => !["class", "personal", "commute"].includes(item.type));
  if (!responseItems.length && !Object.keys(updates).length) return;
  const nextForDate = [...fixed, ...flexible].sort((a, b) => a.start - b.start);
  const next = [...otherDates, ...nextForDate];
  saveUserStateLater("kmu-ai-schedule", next);
  saveRecommendedSchedule({
    planDate,
    items: nextForDate,
    source: "chatbot",
    message: response.reply || "챗봇이 추천 일정을 조정했습니다.",
    context: { preference_updates: updates },
    scheduleVersion: 3,
  });
  window.dispatchEvent(new CustomEvent("kmu-ai-schedule-updated", { detail: next }));
}

export default function SmartChatbot({ activePage, profile, pageGuide, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState(() => {
    const stored = readStore(HISTORY_KEY, []);
    return Array.isArray(stored) && stored.length ? stored : [greeting];
  });
  const [historyReady, setHistoryReady] = useState(false);
  const listRef = useRef(null);
  const pageTitles = useMemo(() => Object.fromEntries(pageGuide.map((page) => [page.id, page.title])), [pageGuide]);

  useEffect(() => {
    let active = true;
    Promise.all([
      loadUserState(HISTORY_KEY, []),
      loadUserState("kmu-ai-schedule", []),
      loadUserState("kmu-ai-preferences", {}),
      loadUserState("kmu-ai-tasks", []),
      loadUserState("kmu-study-plan", []),
    ]).then(([value]) => {
      if (!active) return;
      if (Array.isArray(value) && value.length) setMessages(value);
      setHistoryReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (historyReady) saveUserState(HISTORY_KEY, messages.slice(-30));
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, [messages, busy, historyReady]);

  useEffect(() => {
    const close = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  async function send(textValue) {
    const text = String(textValue || input).trim();
    if (!text || busy) return;
    const userMessage = { role: "user", content: text };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setBusy(true);
    try {
      const context = assistantContext(activePage, profile, pageGuide);
      const response = await api("/ai/schedule/chat", {
        method: "POST",
        body: JSON.stringify({
          message: text,
          context,
          history: messages.slice(-8).map(({ role, content }) => ({ role, content })),
        }),
      });
      applyScheduleResponse(response);
      setMessages((current) => [...current, {
        role: "assistant",
        content: response.reply,
        navigateTo: response.navigate_to || "",
      }]);
    } catch {
      setMessages((current) => [...current, {
        role: "assistant",
        content: "AI 서버에 연결하지 못했습니다. 백엔드 실행 상태와 API 키 설정을 확인해주세요.",
      }]);
    } finally {
      setBusy(false);
    }
  }

  function moveTo(pageId) {
    if (!pageTitles[pageId]) return;
    onNavigate(pageId);
    setOpen(false);
  }

  return (
    <div className={`smart-chatbot ${open ? "open" : ""}`}>
      {open && <section className="smart-chat-panel" role="dialog" aria-label="KMU AI 도우미" aria-modal="false">
        <header>
          <span><Bot /></span>
          <div><b>KMU AI 도우미</b><small>사용 가이드 · 일정 코치</small></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="챗봇 닫기"><X /></button>
        </header>
        <div className="smart-chat-suggestions">
          {["시간표 등록 방법", "개인 일정은 어디서 추가해?", "오늘 일정을 조정해줘"].map((text) =>
            <button type="button" key={text} onClick={() => send(text)}>{text}</button>)}
        </div>
        <div className="smart-chat-messages" ref={listRef} aria-live="polite">
          {messages.map((message, index) => <article className={message.role} key={`${message.role}-${index}`}>
            <p>{message.content}</p>
            {message.navigateTo && pageTitles[message.navigateTo] && <button type="button" onClick={() => moveTo(message.navigateTo)}>{pageTitles[message.navigateTo]}로 이동 <ChevronRight /></button>}
          </article>)}
          {busy && <article className="assistant waiting"><Sparkles /><p>답변을 준비하고 있어요...</p></article>}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); send(); }}>
          <textarea rows="2" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }} placeholder="사용 방법이나 일정에 대해 물어보세요" />
          <button type="submit" disabled={busy || !input.trim()} aria-label="메시지 전송"><Send /></button>
        </form>
      </section>}
      <button className="smart-chat-launcher" type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? "챗봇 닫기" : "AI 도우미 열기"} aria-expanded={open}>
        {open ? <X /> : <Bot />}
        {!open && <span>AI 도우미</span>}
      </button>
    </div>
  );
}
