import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Brain,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  GraduationCap,
  Home,
  Import,
  LogOut,
  Map,
  Search,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { supabase } from "./supabase";
import AcademicPage from "./AcademicPage";
import NotificationPage from "./NotificationPage";
import PersonalSchedulePage from "./PersonalSchedulePage";
import EventsPage from "./EventsPage";
import TodayPage from "./TodayPage";
import NoticesPage from "./NoticesPage";
import { AccountPage, ExtrasPage, SearchPage } from "./UtilityPages";
import {
  AISchedulePage,
  EventRecommendPage,
  FreeTimePage,
  StudyPlannerPage,
} from "./AIHub";
import "./portal.css";

const pages = [
  [
    "home",
    "홈",
    Home,
    "오늘 시간표와 주요 일정을 한눈에 확인합니다.",
    ["오늘의 실제 시간표", "다음 수업", "주요 일정", "빠른 메뉴"],
  ],
  [
    "account",
    "계정",
    UserRound,
    "내 정보와 관심 분야를 관리합니다.",
    ["회원정보", "학과·학년", "관심 분야", "비밀번호 재설정"],
  ],
  [
    "search",
    "검색",
    Search,
    "과목과 일정, 공지, 행사를 통합 검색합니다.",
    ["통합 검색", "날짜 필터", "카테고리", "마감 임박"],
  ],
  [
    "notifications",
    "알림",
    Bell,
    "수업과 일정 알림을 설정합니다.",
    ["수업 알림", "학사일정", "AI 계획", "마감 임박"],
  ],
  [
    "timetable",
    "시간표",
    CalendarDays,
    "시간표 등록과 주간 시간표를 관리합니다.",
    ["OCR 등록", "수동 등록", "파일 가져오기", "시간표 관리"],
  ],
  [
    "today",
    "오늘 수업",
    Clock3,
    "보강 및 대체 요일을 반영한 실제 수업입니다.",
    ["적용 요일", "다음 수업", "남은 시간", "변경 안내"],
  ],
  [
    "academic",
    "학사일정",
    GraduationCap,
    "계명대학교의 주요 학사일정을 확인합니다.",
    ["개강·종강", "보강주", "시험기간", "수강신청"],
  ],
  [
    "notices",
    "학교 공지",
    BookOpen,
    "학사·장학·취업 공지를 모아봅니다.",
    ["공지 검색", "카테고리", "즐겨찾기", "AI 요약"],
  ],
  [
    "events",
    "학교 행사",
    Sparkles,
    "축제와 특강, 비교과 행사를 확인합니다.",
    ["행사 탐색", "맞춤 추천", "관심 행사", "신청 마감"],
  ],
  [
    "personal",
    "개인 일정",
    ClipboardCheck,
    "약속과 운동, 아르바이트 일정을 관리합니다.",
    ["일정 등록", "반복 일정", "우선순위", "완료 관리"],
  ],
  [
    "ai-plan",
    "AI 일정 추천",
    Brain,
    "수업과 마감일을 고려한 하루 계획을 추천합니다.",
    ["오늘 추천", "우선순위", "충돌 감지", "일정 재배치"],
  ],
  [
    "study",
    "AI 공부 계획",
    Brain,
    "시험일까지 맞춤형 학습 계획을 만듭니다.",
    ["일일 목표", "주간 목표", "과목별 배분", "자동 재조정"],
  ],
  [
    "free-time",
    "공강 추천",
    Clock3,
    "공강 길이에 알맞은 활동을 추천합니다.",
    ["공강 탐색", "과제·복습", "식사·휴식", "교내 활동"],
  ],
  [
    "recommend",
    "행사 추천",
    Sparkles,
    "학과와 관심 분야에 맞는 행사를 추천합니다.",
    ["전공 행사", "취업 행사", "공모전", "추천 이유"],
  ],
  [
    "extras",
    "강의실 찾기",
    Map,
    "강의실 코드와 캠퍼스 위치를 확인합니다.",
    ["강의실 검색", "건물 안내", "성서캠퍼스", "대명캠퍼스"],
  ],
];

function EmptyPage({ page, onNavigate }) {
  const [, title, Icon, description, items] = page;
  return (
    <div className="feature-page">
      <section className="feature-hero">
        <span>
          <Icon />
        </span>
        <div>
          <p>KMU SMART SCHEDULER</p>
          <h1>{title}</h1>
          <small>{description}</small>
        </div>
      </section>
      <section className="feature-grid">
        {items.map((item, index) => (
          <article key={item}>
            <div>
              <Icon />
              <b>{item}</b>
            </div>
            <p>이 기능은 다음 구현 단계에서 연결됩니다.</p>
            <button disabled>
              준비 중 <ChevronRight />
            </button>
            <i>{String(index + 1).padStart(2, "0")}</i>
          </article>
        ))}
      </section>
      <section className="coming-card">
        <Sparkles />
        <div>
          <b>{title} 페이지 준비 완료</b>
          <p>
            페이지 구조와 이동 경로를 먼저 구성했습니다. 데이터와 기능은 이후
            단계에서 연결합니다.
          </p>
        </div>
        <button onClick={() => onNavigate("home")}>홈으로 이동</button>
      </section>
    </div>
  );
}

function HomePage({ onNavigate }) {
  return (
    <div className="feature-page">
      <section className="portal-welcome">
        <div>
          <p>2026년 7월 13일 월요일</p>
          <h1>오늘도 알찬 하루 보내세요 👋</h1>
          <span>필요한 기능으로 빠르게 이동할 수 있어요.</span>
        </div>
        <CalendarDays />
      </section>
      <h2 className="section-title">서비스 바로가기</h2>
      <section className="home-grid">
        {pages.slice(1).map(([id, title, Icon, description]) => (
          <button key={id} onClick={() => onNavigate(id)}>
            <span>
              <Icon />
            </span>
            <div>
              <b>{title}</b>
              <small>{description}</small>
            </div>
            <ChevronRight />
          </button>
        ))}
      </section>
    </div>
  );
}

export default function Portal({ session, timetable }) {
  const [active, setActive] = useState("home"),
    [profile, setProfile] = useState(null);
  const page = useMemo(
    () => pages.find((p) => p[0] === active) || pages[0],
    [active],
  );
  useEffect(() => {
    document.body.classList.toggle(
      "theme-dark",
      localStorage.getItem("kmu-dark-mode") === "true",
    );
    supabase
      .from("profiles")
      .select("*")
      .single()
      .then(({ data }) => setProfile(data));
    const pop = (e) => setActive(e.state?.page || "home");
    window.addEventListener("popstate", pop);
    window.history.replaceState({ page: "home" }, "", "#home");
    return () => window.removeEventListener("popstate", pop);
  }, []);
  function navigate(id) {
    if (id === active) return;
    window.history.pushState({ page: id }, "", `#${id}`);
    setActive(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function back() {
    if (window.history.state?.page && active !== "home") window.history.back();
    else navigate("home");
  }
  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <div className="portal-logo">
          <CalendarDays />
          <div>
            KMU<b>Smart Scheduler</b>
          </div>
        </div>
        <nav>
          {pages.map(([id, label, Icon]) => (
            <button
              key={id}
              className={active === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="portal-user">
          <span>{profile?.name?.slice(0, 1) || "K"}</span>
          <div>
            <b>{profile?.name || "계명인"}</b>
            <small>{profile?.department || "학과 정보 없음"}</small>
          </div>
          <button title="로그아웃" onClick={() => supabase.auth.signOut()}>
            <LogOut />
          </button>
        </div>
      </aside>
      <main className="portal-main">
        <header className="portal-top">
          <div className="portal-history">
            <button onClick={back} disabled={active === "home"}>
              <ArrowLeft />
              뒤로
            </button>
            <button onClick={() => navigate("home")}>
              <Home />홈
            </button>
          </div>
          <div>
            <b>{page[1]}</b>
            <span>
              {profile?.name || session.user.user_metadata?.name || "학생"}님
            </span>
          </div>
        </header>
        <div className="mobile-page-nav">
          {pages.map(([id, label, Icon]) => (
            <button
              key={id}
              className={active === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className={`portal-content ${active === "academic" ? "portal-content-wide" : ""}`}>
          {active === "home" ? (
            <HomePage onNavigate={navigate} />
          ) : active === "timetable" ? (
            timetable
          ) : active === "today" ? (
            <TodayPage />
          ) : active === "academic" ? (
            <AcademicPage />
          ) : active === "notices" ? (
            <NoticesPage />
          ) : active === "events" ? (
            <EventsPage profile={profile} />
          ) : active === "ai-plan" ? (
            <AISchedulePage />
          ) : active === "study" ? (
            <StudyPlannerPage />
          ) : active === "free-time" ? (
            <FreeTimePage />
          ) : active === "recommend" ? (
            <EventRecommendPage />
          ) : active === "notifications" ? (
            <NotificationPage />
          ) : active === "personal" ? (
            <PersonalSchedulePage session={session} />
          ) : active === "search" ? (
            <SearchPage onNavigate={navigate} />
          ) : active === "account" ? (
            <AccountPage session={session} profile={profile} onProfileUpdate={setProfile} onNavigate={navigate} />
          ) : active === "extras" ? (
            <ExtrasPage />
          ) : (
            <EmptyPage page={page} onNavigate={navigate} />
          )}
        </div>
      </main>
    </div>
  );
}
