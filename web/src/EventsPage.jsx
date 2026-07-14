import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  ExternalLink,
  Heart,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  TimerReset,
  X,
} from "lucide-react";
import { api } from "./api";
import "./events.css";

let kmuSyncPromise = null;
let lastKmuSyncAt = 0;

async function syncKmuEventsOnce(force = false) {
  if (!force && Date.now() - lastKmuSyncAt < 10 * 60 * 1000) return [];
  if (!kmuSyncPromise) {
    kmuSyncPromise = Promise.allSettled([
      api("/events/sync/kmu?pages=5&limit=120", { method: "POST" }),
      api("/events/sync/story?pages=1&limit=120", { method: "POST" }),
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
    description: "마감이 가까운 행사를 확인합니다.",
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

function savedInterests() {
  try {
    const stored = JSON.parse(localStorage.getItem("kmu-interests"));
    if (!Array.isArray(stored)) return [];
    return [...new Set(stored.flatMap((item) => {
      const value = String(item || "").trim();
      if (!value) return [];
      return [interestAliases[value] || interestAliases[value.toLowerCase()] || value.toLowerCase()];
    }))];
  } catch {
    return [];
  }
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

function deadlineState(event) {
  const now = Date.now();
  const end = new Date(event.ends_at);
  if (!Number.isNaN(end.getTime()) && end.getTime() < now)
    return { label: "마감", closed: true, urgent: false };
  if (!event.apply_deadline)
    return { label: "상시 신청", closed: false, urgent: false };
  const deadline = new Date(event.apply_deadline);
  if (Number.isNaN(deadline.getTime()))
    return { label: "마감일 미정", closed: false, urgent: false };
  const diff = Math.ceil(
    (deadline.setHours(23, 59, 59, 999) - now) / 86400000,
  );
  if (diff < 0) return { label: "마감", closed: true, urgent: false };
  if (diff === 0) return { label: "오늘 마감", closed: false, urgent: true };
  if (diff <= 3) return { label: `D-${diff}`, closed: false, urgent: true };
  return { label: `D-${diff}`, closed: false, urgent: false };
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
  const isNoticeLink = isKmuNoticeUrl(event.apply_url);
  const applyDisabled = !event.apply_url || (deadline.closed && !isNoticeLink);
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
      {details.length > 4 && (
        <button
          className="detail-toggle"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "접기" : "자세히 보기"}
        </button>
      )}
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

export default function EventsPage({ profile }) {
  const [active, setActive] = useState("explore");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [sort, setSort] = useState("upcoming");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [interests, setInterests] = useState(savedInterests);
  const [events, setEvents] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [deadlines, setDeadlines] = useState([]);
  const [loading, setLoading] = useState({
    events: true,
    recommendations: true,
    favorites: true,
    deadlines: true,
  });
  const [error, setError] = useState("");
  const [favoriteBusy, setFavoriteBusy] = useState("");

  const activeCard = actionCards.find((card) => card.id === active);
  const deadlineItems = useMemo(
    () =>
      [...deadlines]
        .filter((event) => !deadlineState(event).closed)
        .sort(
          (a, b) => dateValue(a.apply_deadline) - dateValue(b.apply_deadline),
        ),
    [deadlines],
  );

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
          interest: interests,
          start_date: startDate,
          end_date: endDate,
          sort,
          page: 1,
          limit: 24,
        });
      let items = toItems(await api(path));
      if (!items.length) {
        await syncKmuEventsOnce();
        items = toItems(await api(path));
      }
      setEvents(items);
    } catch (e) {
      setEvents([]);
      setError(`행사 탐색을 불러오지 못했습니다. ${e.message}`);
    } finally {
      setLoad("events", false);
    }
  }, [category, endDate, interests, query, setLoad, sort, sourceType, startDate]);

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
        });
      let items = toItems(await api(path));
      if (!items.length) {
        await syncKmuEventsOnce(true);
        items = toItems(await api(path));
      }
      setRecommendations(items);
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
      const path = withQuery("/events", { sort: "deadline", limit: 12 });
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
    loadEvents();
  }, [loadEvents]);

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

  function clearFilters() {
    setQuery("");
    setCategory("");
    setSourceType("");
    setSort("upcoming");
    setStartDate("");
    setEndDate("");
    setInterests([]);
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
                loadEvents();
              }}
            >
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
              <button
                className="clear-filters"
                onClick={clearFilters}
                type="button"
              >
                <X />
                초기화
              </button>
              <InterestChips selected={interests} onToggle={toggleInterest} />
            </form>
            <EventList
              emptyText="검색어 또는 필터를 조정해 다시 확인해 주세요."
              emptyTitle="조건에 맞는 행사가 없습니다."
              favoriteBusy={favoriteBusy}
              items={events}
              loading={loading.events}
              onFavorite={toggleFavorite}
            />
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
              items={recommendations}
              loading={loading.recommendations}
              onFavorite={toggleFavorite}
              showReason
            />
          </>
        )}

        {active === "favorites" && (
          <EventList
            emptyText="행사 카드의 하트 버튼으로 관심 행사를 저장할 수 있습니다."
            emptyTitle="저장한 관심 행사가 없습니다."
            favoriteBusy={favoriteBusy}
            items={favorites}
            loading={loading.favorites}
            onFavorite={toggleFavorite}
          />
        )}

        {active === "deadlines" && (
          <EventList
            emptyText="마감 예정 행사가 생기면 이곳에 표시됩니다."
            emptyTitle="신청 마감 예정 행사가 없습니다."
            favoriteBusy={favoriteBusy}
            items={deadlineItems}
            loading={loading.deadlines}
            onFavorite={toggleFavorite}
          />
        )}
      </section>
    </div>
  );
}
