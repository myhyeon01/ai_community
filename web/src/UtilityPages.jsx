import React, { useEffect, useMemo, useState } from "react";
import {
  Bell,
  ExternalLink,
  KeyRound,
  LogOut,
  MapPin,
  Moon,
  Search,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { supabase } from "./supabase";
import { academicFallback2026 } from "./academicData";
import { schoolEvents } from "./AIHub";
import { resolveRoomLocation } from "./room-location";
import "./utility-pages.css";

const readJson = (key, fallback = []) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const dayNames = ["월", "화", "수", "목", "금", "토", "일"];

function PageHero({ icon: Icon, eyebrow, title, description }) {
  return <section className="utility-hero"><span><Icon /></span><div><p>{eyebrow}</p><h1>{title}</h1><small>{description}</small></div></section>;
}

export function SearchPage({ onNavigate }) {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("전체");
  useEffect(() => { supabase.from("timetables").select("*").then(({ data }) => setRows(data || [])); }, []);

  const results = useMemo(() => {
    const tasks = readJson("kmu-ai-tasks", []);
    const study = readJson("kmu-study-plan", []);
    const data = [
      ...rows.map((item) => ({ id: `course-${item.id}`, category: "과목", title: item.subject, detail: `${dayNames[item.weekday] || ""}요일 ${String(item.start_time).slice(0, 5)}~${String(item.end_time).slice(0, 5)} · ${item.classroom || "강의실 미정"}`, date: "주간 시간표", page: "timetable" })),
      ...academicFallback2026.map((item) => ({ id: `academic-${item.id}`, category: "학사일정", title: item.title, detail: item.start_date === item.end_date ? item.start_date : `${item.start_date} ~ ${item.end_date}`, date: item.start_date, page: "academic", urgent: /보강|휴강|휴업/.test(item.title) })),
      ...schoolEvents.map((item) => ({ id: `event-${item.id}`, category: "학교행사", title: item.title, detail: `${item.date} · ${item.place}`, date: item.date, page: "events" })),
      ...(Array.isArray(tasks) ? tasks.map((item) => ({ id: `task-${item.id}`, category: "AI 일정", title: item.title, detail: `${item.deadline}까지 · 우선순위 ${item.priority}`, date: item.deadline, page: "ai-plan" })) : []),
      ...(Array.isArray(study) ? study.map((item) => ({ id: `study-${item.id}`, category: "공부계획", title: item.subject, detail: `${item.date}까지 · ${item.section}`, date: item.date, page: "study" })) : []),
    ];
    const keyword = query.trim().toLowerCase();
    return data.filter((item) => (category === "전체" || item.category === category) && (!keyword || `${item.title} ${item.detail}`.toLowerCase().includes(keyword))).slice(0, 80);
  }, [rows, query, category]);

  return <div className="utility-page"><PageHero icon={Search} eyebrow="KMU UNIFIED SEARCH" title="통합 검색" description="과목, 학사일정, 학교 행사와 AI 계획을 한 번에 찾습니다." />
    <section className="search-tools"><label><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="과목명, 일정, 장소 또는 학습 범위를 검색하세요" /></label><div>{["전체", "과목", "학사일정", "학교행사", "AI 일정", "공부계획"].map((item) => <button type="button" className={category === item ? "active" : ""} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div></section>
    <section className="search-results"><header><h2>검색 결과</h2><span>{results.length}개</span></header>{results.length ? <div>{results.map((item) => <button type="button" onClick={() => onNavigate(item.page)} className={item.urgent ? "urgent" : ""} key={item.id}><i>{item.category}</i><div><b>{item.title}</b><p>{item.detail}</p></div><ExternalLink /></button>)}</div> : <div className="utility-empty"><Search /><b>검색 결과가 없습니다.</b><span>다른 검색어나 카테고리를 선택해보세요.</span></div>}</section>
  </div>;
}

export function AccountPage({ session, profile, onProfileUpdate, onNavigate }) {
  const [form, setForm] = useState({ name: "", student_id: "", department: "", grade: 1 });
  const [password, setPassword] = useState({ next: "", confirm: "" });
  const [interests, setInterests] = useState(() => readJson("kmu-interests", []));
  const [interestInput, setInterestInput] = useState("");
  const [message, setMessage] = useState("");
  const [dark, setDark] = useState(() => localStorage.getItem("kmu-dark-mode") === "true");
  useEffect(() => { if (profile) setForm({ name: profile.name || "", student_id: profile.student_id || "", department: profile.department || "", grade: profile.grade || 1 }); }, [profile]);
  useEffect(() => { document.body.classList.toggle("theme-dark", dark); localStorage.setItem("kmu-dark-mode", String(dark)); }, [dark]);

  async function saveProfile(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.department.trim()) { setMessage("이름과 학과를 입력해주세요."); return; }
    const payload = { name: form.name.trim(), department: form.department.trim(), grade: Number(form.grade) };
    const { data, error } = await supabase.from("profiles").update(payload).eq("id", session.user.id).select().single();
    if (error) setMessage(`정보 저장 실패: ${error.message}`);
    else { onProfileUpdate(data); setMessage("회원정보를 저장했습니다."); }
  }
  async function changePassword(e) {
    e.preventDefault();
    if (password.next.length < 6) { setMessage("새 비밀번호는 6자 이상이어야 합니다."); return; }
    if (password.next !== password.confirm) { setMessage("비밀번호 확인이 일치하지 않습니다."); return; }
    const { error } = await supabase.auth.updateUser({ password: password.next });
    setMessage(error ? `비밀번호 변경 실패: ${error.message}` : "비밀번호를 변경했습니다.");
    if (!error) setPassword({ next: "", confirm: "" });
  }
  function addInterest(e) {
    e.preventDefault();
    const value = interestInput.trim(); if (!value || interests.includes(value)) return;
    const next = [...interests, value]; setInterests(next); localStorage.setItem("kmu-interests", JSON.stringify(next)); setInterestInput("");
  }
  function clearAiData() {
    if (!window.confirm("AI 일정과 공부 계획 데이터를 모두 삭제할까요?")) return;
    ["kmu-ai-tasks", "kmu-ai-schedule", "kmu-study-plan"].forEach((key) => localStorage.removeItem(key));
    setMessage("AI 일정과 공부 계획 데이터를 삭제했습니다.");
  }

  return <div className="utility-page"><PageHero icon={UserRound} eyebrow="KMU ACCOUNT" title="계정 및 앱 설정" description="회원정보와 관심 분야, 비밀번호, 알림과 앱 데이터를 한 곳에서 관리합니다." />
    {message && <p className="utility-message" role="status">{message}</p>}
    <div className="account-grid"><section className="utility-panel"><header><UserRound /><div><h2>회원정보</h2><p>Supabase 프로필에 바로 저장됩니다.</p></div></header><form className="account-form" onSubmit={saveProfile}><label>학번<input value={form.student_id} readOnly /></label><label>이름<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>학과<input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></label><label>학년<select value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}>{[1,2,3,4,5,6].map((grade) => <option key={grade} value={grade}>{grade}학년</option>)}</select></label><button>회원정보 저장</button></form></section>
      <section className="utility-panel"><header><KeyRound /><div><h2>비밀번호 변경</h2><p>다음 로그인부터 새 비밀번호가 적용됩니다.</p></div></header><form className="password-form" onSubmit={changePassword}><label>새 비밀번호<input type="password" value={password.next} onChange={(e) => setPassword({ ...password, next: e.target.value })} /></label><label>비밀번호 확인<input type="password" value={password.confirm} onChange={(e) => setPassword({ ...password, confirm: e.target.value })} /></label><button>비밀번호 변경</button></form></section>
      <section className="utility-panel"><header><Sparkles /><div><h2>관심 분야</h2><p>행사와 AI 추천 개인화에 사용됩니다.</p></div></header><form className="interest-form" onSubmit={addInterest}><input value={interestInput} onChange={(e) => setInterestInput(e.target.value)} placeholder="예: AI, 백엔드, 취업" /><button>추가</button></form><div className="interest-list">{interests.map((item) => <span key={item}>{item}<button type="button" onClick={() => { const next = interests.filter((value) => value !== item); setInterests(next); localStorage.setItem("kmu-interests", JSON.stringify(next)); }}><Trash2 /></button></span>)}</div></section>
      <section className="utility-panel"><header><Moon /><div><h2>앱 설정 및 데이터</h2><p>화면과 알림, 저장된 데이터를 관리합니다.</p></div></header><div className="account-actions"><button type="button" onClick={() => setDark(!dark)}><Moon />다크 모드 <b>{dark ? "켜짐" : "꺼짐"}</b></button><button type="button" onClick={() => onNavigate("notifications")}><Bell />알림 설정 열기</button><button type="button" onClick={clearAiData}><Trash2 />AI 계획 데이터 초기화</button><button type="button" onClick={() => supabase.auth.signOut()}><LogOut />로그아웃</button></div></section></div>
  </div>;
}

export function ExtrasPage() {
  const [rows, setRows] = useState([]);
  const [room, setRoom] = useState("");
  useEffect(() => { supabase.from("timetables").select("*").order("weekday").order("start_time").then(({ data }) => setRows(data || [])); }, []);
  const classrooms = [...new Set(rows.map((row) => row.classroom).filter(Boolean))];
  const building = resolveRoomLocation(room);
  return <div className="utility-page"><PageHero icon={MapPin} eyebrow="KMU CAMPUS GUIDE" title="강의실 찾기" description="강의실 코드를 검색하고 계명대학교 캠퍼스 위치를 지도에서 확인합니다." />
    <section className="room-finder utility-panel"><header><MapPin /><div><h2>강의실·건물 검색</h2><p>예: 공1402처럼 강의실 코드를 입력하면 건물을 안내합니다.</p></div></header><div><label><input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="예: 공1402" /><b>{building.displayName}</b></label><a href={`https://map.naver.com/p/search/${encodeURIComponent(building.searchQuery)}`} target="_blank" rel="noreferrer"><MapPin />지도에서 보기</a></div>{classrooms.length > 0 && <div className="room-suggestions"><b>내 시간표 강의실</b><div>{classrooms.map((classroom) => <button type="button" key={classroom} onClick={() => setRoom(classroom)}>{classroom}</button>)}</div></div>}</section>
    <section className="campus-links"><a href="https://map.naver.com/p/search/%EA%B3%84%EB%AA%85%EB%8C%80%ED%95%99%EA%B5%90%20%EC%84%B1%EC%84%9C%EC%BA%A0%ED%8D%BC%EC%8A%A4" target="_blank" rel="noreferrer"><MapPin /><div><b>성서캠퍼스</b><span>대구광역시 달서구 달구벌대로 1095</span></div><ExternalLink /></a><a href="https://map.naver.com/p/search/%EA%B3%84%EB%AA%85%EB%8C%80%ED%95%99%EA%B5%90%20%EB%8C%80%EB%AA%85%EC%BA%A0%ED%8D%BC%EC%8A%A4" target="_blank" rel="noreferrer"><MapPin /><div><b>대명캠퍼스</b><span>대구광역시 남구 명덕로 104</span></div><ExternalLink /></a></section>
  </div>;
}
