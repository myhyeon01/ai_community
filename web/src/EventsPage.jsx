import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  ExternalLink,
  Heart,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  TimerReset,
} from "lucide-react";
import { api } from "./api";
import { loadUserState, readLocalState } from "./appState";
import "./events.css";

const EVENT_PAGE_SIZE = 9;

const progressFilters = [
  ["", "전체 행사"],
  ["upcoming", "진행 전"],
  ["ongoing", "진행 중"],
];

let kmuSyncPromise = null;
let lastKmuSyncAt = 0;

async function syncKmuEventsOnce(force = false) {
  if (!force && Date.now() - lastKmuSyncAt < 10 * 60 * 1000) return [];
  if (!kmuSyncPromise) {
    kmuSyncPromise = Promise.allSettled([
      api("/events/sync/kmu?pages=5&limit=200", { method: "POST" }),
      api("/events/sync/story?pages=3&limit=200", { method: "POST" }),
    ])
      .then((results) => {
        if (results.every((result) => result.status === "rejected")) {
          throw results[0].reason;
        }
        lastKmuSyncAt = Date.now();
        return results;
      })
      .finally(() => {
        kmuSyncPromise = null;
      });
  }
  return kmuSyncPromise;
}

const actionCards = [
  {
    id: "explore",
    title: "행사 탐색",
    Icon: Search,
    description: "검색과 필터로 교내 행사를 찾습니다.",
  },
  {
    id: "recommend",
    title: "맞춤 추천",
    Icon: Star,
    description: "학과와 관심 분야에 맞는 행사를 봅니다.",
  },
  {
    id: "favorites",
    title: "관심 행사",
    Icon: Heart,
    description: "저장한 행사를 모아 확인합니다.",
  },
  {
    id: "deadlines",
    title: "신청 마감",
    Icon: TimerReset,
    description: "30일 이내에 신청이 마감되는 행사를 확인합니다.",
  },
];

const categories = [
  "특강",
  "교육",
  "축제",
  "비교과",
  "채용",
  "공모전",
  "봉사",
  "동아리",
];

const interestOptions = [
  ["major", "전공"],
  ["education", "교육"],
  ["career", "취업"],
  ["contest", "공모전"],
  ["culture", "문화"],
  ["ai", "AI"],
  ["startup", "창업"],
  ["volunteer", "봉사"],
  ["global", "글로벌"],
];

const sortOptions = [
  ["upcoming", "시작일순"],
  ["deadline", "마감 임박"],
  ["latest", "최신 등록"],
];

const sourceTypeOptions = [
  ["", "전체"],
  ["school", "학교 행사"],
  ["external", "교외 행사"],
];

const interestAliases = {
  "인공지능": "ai",
  "AI": "ai",
  "ai": "ai",
  "백엔드": "major",
  "프론트엔드": "major",
  "개발": "major",
  "소프트웨어": "major",
  "전공": "major",
  "취업": "career",
  "진로": "career",
  "공모전": "contest",
  "문화": "culture",
  "창업": "startup",
  "봉사": "volunteer",
  "글로벌": "global",
  "교육": "education",
};

const interestKeywords = {
  major: ["major", "전공", "개발", "소프트웨어", "데이터", "컴퓨터", "프로그래밍", "it"],
  education: ["education", "교육", "강좌", "특강", "학습"],
  career: ["career", "취업", "채용", "인턴", "진로", "직무"],
  contest: ["contest", "공모전", "공모", "대회"],
  culture: ["culture", "문화", "축제", "공연", "전시"],
  ai: ["ai", "인공지능", "머신러닝", "딥러닝"],
  startup: ["startup", "창업", "스타트업"],
  volunteer: ["volunteer", "봉사"],
  global: ["global", "글로벌", "해외", "교환학생", "외국어"],
};

function savedInterests() {
  const stored = readLocalState("kmu-interests", []);
  if (!Array.isArray(stored)) return [];
  return [...new Set(stored.flatMap((item) => {
    const value = String(item || "").trim();
    if (!value) return [];
    return [interestAliases[value] || interestAliases[value.toLowerCase()] || value.toLowerCase()];
  }))];
}

function toItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.events)) return data.events;
  return [];
}

function withQuery(path, params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, Array.isArray(value) ? value.join(",") : String(value));
  });
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

function tagList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string")
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  return [];
}

function dateValue(value) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function dateKeyAfter(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function eventMatchesInterests(event, selected) {
  if (!selected.length) return true;
  const text = `${event.title || ""} ${event.summary || ""} ${event.interests || ""} ${event.department || ""}`.toLocaleLowerCase("ko");
  return selected.some((interest) => {
    const normalized = String(interest || "").trim().toLocaleLowerCase("ko");
    if (!normalized) return false;
    const words = interestKeywords[normalized] || [normalized];
    return words.some((word) => text.includes(String(word).toLocaleLowerCase("ko")));
  });
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRange(event) {
  const start = formatDateTime(event.starts_at);
  const end = formatDateTime(event.ends_at);
  if (start && end) return `${start} - ${end}`;
  return start || end || "일정 미정";
}

function sourceTypeLabel(value) {
  return value === "external" ? "교외 행사" : "";
}

function sourceInfo(event) {
  const url = event.url || event.apply_url || "";
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = "";
  }
  if (hostname === "story.kmu.ac.kr") return { label: "Story+ 비교과", url };
  if (hostname.endsWith("kmu.ac.kr")) {
    return { label: event.source_type === "external" ? "계명대학교 교외행사 공지" : "계명대학교 공식 홈페이지", url };
  }
  return { label: hostname || "행사 원문", url };
}

function isKmuNoticeUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.includes("kmu.ac.kr") && url.searchParams.has("parm_bod_uid");
  } catch {
    return String(value || "").includes("kmu.ac.kr") && String(value || "").includes("parm_bod_uid");
  }
}

function eventProgress(event) {
  const now = Date.now();
  const start = new Date(event.starts_at).getTime();
  const end = new Date(event.ends_at).getTime();
  return {
    ongoing: Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end,
    ended: Number.isFinite(end) && end < now,
  };
}

function deadlineState(event) {
  const now = Date.now();
  const progress = eventProgress(event);
  if (progress.ended)
    return { label: "종료", closed: true, applicationClosed: true, urgent: false };
  if (progress.ongoing)
    return { label: "신청 마감", closed: false, applicationClosed: true, urgent: false };
  if (!event.apply_deadline)
    return { label: "상시 신청", closed: false, applicationClosed: false, urgent: false };
  const deadline = new Date(event.apply_deadline);
  if (Number.isNaN(deadline.getTime()))
    return { label: "마감일 미정", closed: false, applicationClosed: false, urgent: false };
  const diff = Math.ceil(
    (deadline.setHours(23, 59, 59, 999) - now) / 86400000,
  );
  if (diff < 0) return { label: "신청 마감", closed: true, applicationClosed: true, urgent: false };
  if (diff === 0) return { label: "오늘 마감", closed: false, applicationClosed: false, urgent: true };
  if (diff <= 3) return { label: `D-${diff}`, closed: false, applicationClosed: false, urgent: true };
  return { label: `D-${diff}`, closed: false, applicationClosed: false, urgent: false };
}

function isDeadlineWithinMonth(event) {
  const deadline = deadlineState(event);
  if (!event.apply_deadline || deadline.closed || deadline.applicationClosed) return false;
  const deadlineKey = String(event.apply_deadline).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(deadlineKey)
    && deadlineKey >= localDateKey()
    && deadlineKey <= dateKeyAfter(30);
}

function summaryLines(value) {
  const text = String(value || "")
    .replace(/[☞☜]+/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([①-⑳])/g, "\n$1")
    .replace(/\s+(\d+\))/g, "\n$1")
    .replace(/\s+([가나다라마바사아자차카타파하]\s*\.)/g, "\n$1")
    .replace(/\s+(※)/g, "\n$1")
    .trim();
  const seen = new Set();
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "신청 바로가기")
    .filter((line) => !/\{\s*["']?(?:message|path)["']?\s*:|location\.href|hasToken=|parm_bod_uid=|<!\[CDATA\[|function\s+\w+\s*\(|<\/?(?:script|style)|javascript:/i.test(line))
    .filter((line) => !/(?:\?\s*){4,}|�{2,}/.test(line))
    .filter((line) => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

function LoadingList() {
  return (
    <div className="event-list">
      {[0, 1, 2].map((item) => (
        <article className="event-skeleton" key={item}>
          <i />
          <b />
          <span />
          <span />
        </article>
      ))}
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="events-empty">
      <Sparkles />
      <b>{title}</b>
      <p>{text}</p>
    </div>
  );
}

function EventCard({ event, onFavorite, favoriteBusy, showReason }) {
  const [expanded, setExpanded] = useState(false);
  const tags = tagList(event.interests).slice(0, 4);
  const deadline = deadlineState(event);
  const progress = eventProgress(event);
  const isNoticeLink = isKmuNoticeUrl(event.apply_url);
  const applyDisabled = !event.apply_url || (deadline.applicationClosed && !isNoticeLink);
  const actionLabel = isNoticeLink ? "게시글 보기" : "신청하기";
  const details = summaryLines(event.summary);
  const visibleDetails = expanded ? details.slice(0, 14) : details.slice(0, 4);
  const sourceType = event.source_type === "external" ? "external" : "school";
  const source = sourceInfo(event);

  function openApply() {
    if (applyDisabled) return;
    const next = window.open(event.apply_url, "_blank", "noopener,noreferrer");
    if (next) next.opener = null;
  }

  return (
    <article className={deadline.closed ? "event-card closed" : "event-card"}>
      <header>
        <div>
          <div className="event-badges">
            <span className="event-category">
              {event.category || "학교 행사"}
            </span>
            {sourceType === "external" && (
              <span className="event-source external">
                {sourceTypeLabel(sourceType)}
              </span>
            )}
            {progress.ongoing && (
              <span className="event-status ongoing">진행 중</span>
            )}
          </div>
          <h3>{event.title || "제목 없는 행사"}</h3>
        </div>
        <button
          className={event.is_favorite ? "favorite active" : "favorite"}
          disabled={favoriteBusy === event.id || !event.id}
          onClick={() => onFavorite(event)}
          type="button"
          title={event.is_favorite ? "관심 행사 해제" : "관심 행사 저장"}
        >
          <Heart fill={event.is_favorite ? "currentColor" : "none"} />
        </button>
      </header>
      <div className={expanded ? "event-summary expanded" : "event-summary"}>
        {visibleDetails.length ? (
          <ul>
            {visibleDetails.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p>행사 설명이 준비되지 않았습니다.</p>
        )}
      </div>
      <div className="event-detail-action">
        {details.length > 4 && (
          <button
            className="detail-toggle"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? "접기" : "자세히 보기"}
          </button>
        )}
      </div>
      <div className="event-meta">
        <span>
          <CalendarDays />
          {formatRange(event)}
        </span>
        <span>
          <MapPin />
          {event.location || "장소 미정"}
        </span>
        <span className={deadline.urgent ? "urgent" : ""}>
          <Clock3 />
          {deadline.label}
        </span>
      </div>
      {!!tags.length && (
        <div className="event-tags">
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
      {showReason && event.recommendation_reason && (
        <div className="recommend-reason">
          <Sparkles />
          {event.recommendation_reason}
        </div>
      )}
      <footer>
        <div className="event-origin">
          <small>{event.department || "전체 대상"}</small>
          {source.url && <a href={source.url} target="_blank" rel="noreferrer" title={`${source.label}에서 원문 보기`}><ExternalLink />출처 · {source.label}</a>}
        </div>
        {event.apply_url && event.apply_url !== source.url && <button
            className="apply-link"
            disabled={applyDisabled}
            onClick={openApply}
            type="button"
          >
            {actionLabel} <ExternalLink />
          </button>}
      </footer>
    </article>
  );
}

function EventList({
  items,
  loading,
  emptyTitle,
  emptyText,
  onFavorite,
  favoriteBusy,
  showReason,
}) {
  if (loading) return <LoadingList />;
  if (!items.length) return <EmptyState title={emptyTitle} text={emptyText} />;
  return (
    <div className="event-list">
      {items.map((event) => (
        <EventCard
          event={event}
          favoriteBusy={favoriteBusy}
          key={event.id || event.title}
          onFavorite={onFavorite}
          showReason={showReason}
        />
      ))}
    </div>
  );
}

function InterestChips({ selected, onToggle }) {
  return (
    <div className="interest-chips">
      {interestOptions.map(([id, label]) => (
        <button
          className={selected.includes(id) ? "active" : ""}
          key={id}
          onClick={() => onToggle(id)}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function EventPagination({ page, totalItems, loading, onPageChange, label }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / EVENT_PAGE_SIZE));
  if (totalPages <= 1) return null;
  const visibleCount = Math.min(6, totalPages);
  const start = Math.min(
    Math.max(1, page - Math.floor(visibleCount / 2)),
    Math.max(1, totalPages - visibleCount + 1),
  );
  const pages = Array.from({ length: visibleCount }, (_, index) => start + index);
  return (
    <nav aria-label={`${label} 페이지`} className="event-pagination">
      <button aria-label="첫 페이지" disabled={page === 1 || loading} onClick={() => onPageChange(1)} type="button"><ChevronsLeft /></button>
      <button aria-label="이전 페이지" disabled={page === 1 || loading} onClick={() => onPageChange(Math.max(1, page - 1))} type="button"><ChevronLeft /></button>
      {pages.map((value) => (
        <button aria-current={value === page ? "page" : undefined} className={value === page ? "active" : ""} key={value} onClick={() => onPageChange(value)} type="button">{value}</button>
      ))}
      <button aria-label="다음 페이지" disabled={page === totalPages || loading} onClick={() => onPageChange(Math.min(totalPages, page + 1))} type="button"><ChevronRight /></button>
      <button aria-label="마지막 페이지" disabled={page === totalPages || loading} onClick={() => onPageChange(totalPages)} type="button"><ChevronsRight /></button>
    </nav>
  );
}

function pageSlice(items, page) {
  return items.slice((page - 1) * EVENT_PAGE_SIZE, page * EVENT_PAGE_SIZE);
}

export default function EventsPage({ profile }) {
  const [active, setActive] = useState("explore");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [sort, setSort] = useState("upcoming");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [progressFilter, setProgressFilter] = useState("");
  const [interests, setInterests] = useState(savedInterests);
  const [events, setEvents] = useState([]);
  const [eventPage, setEventPage] = useState(1);
  const [totalEvents, setTotalEvents] = useState(0);
  const [recommendations, setRecommendations] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [deadlines, setDeadlines] = useState([]);
  const [recommendPage, setRecommendPage] = useState(1);
  const [favoritePage, setFavoritePage] = useState(1);
  const [deadlinePage, setDeadlinePage] = useState(1);
  const [loading, setLoading] = useState({
    events: true,
    recommendations: true,
    favorites: true,
    deadlines: true,
  });
  const [error, setError] = useState("");
  const [favoriteBusy, setFavoriteBusy] = useState("");

  const activeCard = actionCards.find((card) => card.id === active);
  const totalEventPages = Math.max(
    1,
    Math.ceil(totalEvents / EVENT_PAGE_SIZE),
  );
  const deadlineItems = useMemo(
    () =>
      [...deadlines]
        .filter(isDeadlineWithinMonth)
        .sort(
          (a, b) => dateValue(a.apply_deadline) - dateValue(b.apply_deadline),
        ),
    [deadlines],
  );
  const visibleRecommendations = useMemo(() => pageSlice(recommendations, recommendPage), [recommendPage, recommendations]);
  const visibleFavorites = useMemo(() => pageSlice(favorites, favoritePage), [favoritePage, favorites]);
  const visibleDeadlines = useMemo(() => pageSlice(deadlineItems, deadlinePage), [deadlineItems, deadlinePage]);

  const setLoad = useCallback((key, value) => {
    setLoading((prev) => ({ ...prev, [key]: value }));
  }, []);

  const loadEvents = useCallback(async () => {
    setLoad("events", true);
    setError("");
    try {
      const path = withQuery("/events", {
          q: query.trim(),
          category,
          source_type: sourceType,
          progress: progressFilter,
          start_date: startDate,
          end_date: endDate,
          sort,
          active_only: true,
          page: eventPage,
          limit: EVENT_PAGE_SIZE,
        });
      const countPath = withQuery("/events/count", {
        q: query.trim(),
        category,
        source_type: sourceType,
        progress: progressFilter,
        start_date: startDate,
        end_date: endDate,
        active_only: true,
      });
      let [items, countData] = await Promise.all([
        api(path).then(toItems),
        api(countPath),
      ]);
      if (!items.length) {
        await syncKmuEventsOnce();
        [items, countData] = await Promise.all([
          api(path).then(toItems),
          api(countPath),
        ]);
      }
      const nextTotal = Number(countData?.total || 0);
      setTotalEvents(nextTotal);
      const nextTotalPages = Math.max(
        1,
        Math.ceil(nextTotal / EVENT_PAGE_SIZE),
      );
      if (eventPage > nextTotalPages) {
        setEventPage(nextTotalPages);
        return;
      }
      setEvents(items.filter((event) => !deadlineState(event).closed));
    } catch (e) {
      setEvents([]);
      setTotalEvents(0);
      setError(`행사 탐색을 불러오지 못했습니다. ${e.message}`);
    } finally {
      setLoad("events", false);
    }
  }, [category, endDate, eventPage, progressFilter, query, setLoad, sort, sourceType, startDate]);

  const loadRecommendations = useCallback(async () => {
    setLoad("recommendations", true);
    setError("");
    try {
      try {
        await syncKmuEventsOnce();
      } catch {
        // 저장된 행사 데이터가 있으면 추천은 계속 제공합니다.
      }
      const path = withQuery("/events/recommendations", {
          interests,
          department: profile?.department || "",
          grade: profile?.grade || "",
          limit: 50,
        });
      const items = toItems(await api(path));
      setRecommendations(
        items
          .filter((event) => !deadlineState(event).closed)
          .filter((event) => eventMatchesInterests(event, interests)),
      );
    } catch (e) {
      setRecommendations([]);
      setError(`맞춤 추천을 불러오지 못했습니다. ${e.message}`);
    } finally {
      setLoad("recommendations", false);
    }
  }, [interests, profile?.department, profile?.grade, setLoad]);

  const loadFavorites = useCallback(async () => {
    setLoad("favorites", true);
    setError("");
    try {
      const data = await api("/events/favorites");
      setFavorites(toItems(data));
    } catch (e) {
      setFavorites([]);
      setError(`관심 행사를 불러오지 못했습니다. ${e.message}`);
    } finally {
      setLoad("favorites", false);
    }
  }, [setLoad]);

  const loadDeadlines = useCallback(async () => {
    setLoad("deadlines", true);
    setError("");
    try {
      const path = withQuery("/events", {
        sort: "deadline",
        deadline_from: localDateKey(),
        deadline_to: dateKeyAfter(30),
        limit: 100,
      });
      let items = toItems(await api(path));
      if (!items.length) {
        await syncKmuEventsOnce();
        items = toItems(await api(path));
      }
      setDeadlines(items);
    } catch (e) {
      setDeadlines([]);
      setError(`신청 마감 행사를 불러오지 못했습니다. ${e.message}`);
    } finally {
      setLoad("deadlines", false);
    }
  }, [setLoad]);

  useEffect(() => {
    let active = true;
    loadUserState("kmu-interests", []).then(() => {
      if (!active) return;
      setInterests(savedInterests());
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    setEventPage(1);
  }, [category, endDate, progressFilter, query, sort, sourceType, startDate]);

  useEffect(() => {
    setRecommendPage(1);
  }, [interests]);

  useEffect(() => {
    setRecommendPage((page) => Math.min(page, Math.max(1, Math.ceil(recommendations.length / EVENT_PAGE_SIZE))));
  }, [recommendations.length]);

  useEffect(() => {
    setFavoritePage((page) => Math.min(page, Math.max(1, Math.ceil(favorites.length / EVENT_PAGE_SIZE))));
  }, [favorites.length]);

  useEffect(() => {
    setDeadlinePage((page) => Math.min(page, Math.max(1, Math.ceil(deadlineItems.length / EVENT_PAGE_SIZE))));
  }, [deadlineItems.length]);

  useEffect(() => {
    loadRecommendations();
  }, [loadRecommendations]);

  useEffect(() => {
    loadFavorites();
    loadDeadlines();
  }, [loadDeadlines, loadFavorites]);

  function toggleInterest(id) {
    setInterests((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  async function toggleFavorite(event) {
    if (!event.id) return;
    const next = !event.is_favorite;
    setFavoriteBusy(event.id);
    setError("");
    try {
      await api(`/events/${event.id}/favorite`, {
        method: next ? "POST" : "DELETE",
      });
      const update = (item) =>
        item.id === event.id ? { ...item, is_favorite: next } : item;
      setEvents((prev) => prev.map(update));
      setRecommendations((prev) => prev.map(update));
      setDeadlines((prev) => prev.map(update));
      await loadFavorites();
    } catch (e) {
      setError(`관심 행사 변경에 실패했습니다. ${e.message}`);
    } finally {
      setFavoriteBusy("");
    }
  }

  async function reloadActive() {
    if (active !== "favorites") {
      try {
        await syncKmuEventsOnce(true);
      } catch {
        // The following load call will surface the user-facing API error.
      }
    }
    if (active === "explore") loadEvents();
    if (active === "recommend") loadRecommendations();
    if (active === "favorites") loadFavorites();
    if (active === "deadlines") loadDeadlines();
  }

  return (
    <div className="feature-page events-page">
      <section className="feature-hero events-hero">
        <span>
          <Sparkles />
        </span>
        <div>
          <p>KMU SMART SCHEDULER</p>
          <h1>학교 행사</h1>
          <small>축제와 특강, 비교과 행사를 확인합니다.</small>
        </div>
      </section>

      <section className="event-action-grid">
        {actionCards.map(({ id, title, Icon, description }, index) => (
          <article className={active === id ? "active" : ""} key={id}>
            <div>
              <Icon />
              <b>{title}</b>
            </div>
            <p>{description}</p>
            <button onClick={() => setActive(id)} type="button">
              열기 <ChevronRight />
            </button>
            <i>{String(index + 1).padStart(2, "0")}</i>
          </article>
        ))}
      </section>

      {error && (
        <div className="events-error">
          <span>{error}</span>
          <button onClick={reloadActive} type="button">
            <RefreshCw />
            다시 시도
          </button>
        </div>
      )}

      <section className="events-workspace">
        <header className="events-workspace-head">
          <div>
            <span>{activeCard?.title}</span>
            <h2>{activeCard?.description}</h2>
          </div>
          <button onClick={reloadActive} type="button">
            <RefreshCw />
            새로고침
          </button>
        </header>

        {active === "explore" && (
          <>
            <form
              className="event-filters"
              onSubmit={(e) => {
                e.preventDefault();
                if (eventPage === 1) loadEvents();
                else setEventPage(1);
              }}
            >
              <div className="event-filter-source-row">
                <div
                  aria-label="행사 출처"
                  className="source-filter"
                  role="group"
                >
                  {sourceTypeOptions.map(([id, label]) => (
                    <button
                      className={sourceType === id ? "active" : ""}
                      key={id || "all-source-types"}
                      onClick={() => setSourceType(id)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="event-search">
                <Search />
                <input
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="행사명, 장소, 키워드 검색"
                  value={query}
                />
              </label>
              <select
                aria-label="카테고리"
                onChange={(e) => setCategory(e.target.value)}
                value={category}
              >
                <option value="">전체 카테고리</option>
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select
                aria-label="정렬"
                onChange={(e) => setSort(e.target.value)}
                value={sort}
              >
                {sortOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                aria-label="시작일"
                onChange={(e) => setStartDate(e.target.value)}
                type="date"
                value={startDate}
              />
              <input
                aria-label="종료일"
                onChange={(e) => setEndDate(e.target.value)}
                type="date"
                value={endDate}
              />
              <div aria-label="행사 진행 상태" className="progress-filter-group" role="group">
                {progressFilters.map(([value, label]) => (
                  <button
                    className={progressFilter === value ? "active" : ""}
                    key={value || "all-progress"}
                    onClick={() => setProgressFilter(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </form>
            <EventList
              emptyText="검색어 또는 필터를 조정해 다시 확인해 주세요."
              emptyTitle="조건에 맞는 행사가 없습니다."
              favoriteBusy={favoriteBusy}
              items={events}
              loading={loading.events}
              onFavorite={toggleFavorite}
            />
            <EventPagination page={eventPage} totalItems={totalEvents} loading={loading.events} onPageChange={setEventPage} label="행사 탐색" />
          </>
        )}

        {active === "recommend" && (
          <>
            <div className="recommend-context">
              <Sparkles />
              <span>
                {profile?.department || "학과 정보 없음"} · {profile?.grade ? `${profile.grade}학년` : "학년 미설정"}과
                계정에 저장한 관심 분야를 함께 반영합니다.
              </span>
            </div>
            <InterestChips selected={interests} onToggle={toggleInterest} />
            <EventList
              emptyText="관심 분야를 선택하거나 추천 데이터가 준비된 뒤 다시 확인해 주세요."
              emptyTitle="추천 행사가 없습니다."
              favoriteBusy={favoriteBusy}
              items={visibleRecommendations}
              loading={loading.recommendations}
              onFavorite={toggleFavorite}
              showReason
            />
            <EventPagination page={recommendPage} totalItems={recommendations.length} loading={loading.recommendations} onPageChange={setRecommendPage} label="맞춤 추천" />
          </>
        )}

        {active === "favorites" && (
          <>
            <EventList
              emptyText="행사 카드의 하트 버튼으로 관심 행사를 저장할 수 있습니다."
              emptyTitle="저장한 관심 행사가 없습니다."
              favoriteBusy={favoriteBusy}
              items={visibleFavorites}
              loading={loading.favorites}
              onFavorite={toggleFavorite}
            />
            <EventPagination page={favoritePage} totalItems={favorites.length} loading={loading.favorites} onPageChange={setFavoritePage} label="관심 행사" />
          </>
        )}

        {active === "deadlines" && (
          <>
            <EventList
              emptyText="오늘부터 30일 이내에 신청이 마감되는 행사가 표시됩니다."
              emptyTitle="한 달 이내 신청 마감 행사가 없습니다."
              favoriteBusy={favoriteBusy}
              items={visibleDeadlines}
              loading={loading.deadlines}
              onFavorite={toggleFavorite}
            />
            <EventPagination page={deadlinePage} totalItems={deadlineItems.length} loading={loading.deadlines} onPageChange={setDeadlinePage} label="신청 마감" />
          </>
        )}
      </section>
    </div>
  );
}
