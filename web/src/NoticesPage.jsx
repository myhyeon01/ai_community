import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  ExternalLink,
  FileText,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "./api";
import { loadUserState, readLocalState, saveUserState } from "./appState";
import "./notices.css";

const CATEGORIES = ["전체", "학사", "장학", "취업", "행사", "기타"];
const FAVORITES_KEY = "kmu-notice-favorites";

function readFavorites() {
  const value = readLocalState(FAVORITES_KEY, []);
  return new Set(Array.isArray(value) ? value.map(String) : []);
}

function formatFetchedAt(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR");
}

function NoticeBadges({ notice }) {
  return (
    <span className="notice-badges">
      <span className={`notice-category category-${notice.category}`}>{notice.category}</span>
      {notice.isImportant && <strong>중요</strong>}
      {notice.isNew && <em>NEW</em>}
    </span>
  );
}

export default function NoticesPage() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("전체");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, hasMore: false, fetchedAt: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [favorites, setFavorites] = useState(readFavorites);
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const detailCache = useRef(new Map());
  const panelRef = useRef(null);

  const loadNotices = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), limit: "20", category });
    if (query) params.set("query", query);
    const requestPath = `/notices?${params}`;
    try {
      const result = await api(requestPath, { signal });
      setData(result);
    } catch (requestError) {
      if (requestError?.name === "AbortError") return;
      console.error("[학교 공지] 요청 실패", { url: requestPath, error: requestError });
      setError(requestError instanceof Error ? requestError.message : "학교 공지를 불러오지 못했습니다.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [category, page, query]);

  useEffect(() => {
    const controller = new AbortController();
    loadNotices(controller.signal);
    return () => controller.abort();
  }, [loadNotices]);

  useEffect(() => {
    let active = true;
    loadUserState(FAVORITES_KEY, []).then((value) => {
      if (!active) return;
      setFavorites(new Set(Array.isArray(value) ? value.map(String) : []));
      setFavoritesReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (favoritesReady) saveUserState(FAVORITES_KEY, [...favorites]);
  }, [favorites, favoritesReady]);

  const visibleItems = useMemo(
    () => favoritesOnly ? data.items.filter((item) => favorites.has(String(item.id))) : data.items,
    [data.items, favorites, favoritesOnly],
  );

  function submitSearch(event) {
    event?.preventDefault();
    setPage(1);
    setQuery(draft.trim());
  }

  function resetFilters() {
    setDraft("");
    setQuery("");
    setCategory("전체");
    setFavoritesOnly(false);
    setPage(1);
  }

  function toggleFavorite(id) {
    const key = String(id);
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function selectNotice(notice) {
    const id = String(notice.id);
    setSelectedId(id);
    setSummary(null);
    setDetailError("");
    if (detailCache.current.has(id)) {
      setDetail(detailCache.current.get(id));
      return;
    }
    setDetail(null);
    setDetailLoading(true);
    try {
      const result = await api(`/notices/${id}`);
      detailCache.current.set(id, result);
      setDetail(result);
      requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    } catch (requestError) {
      console.error("[학교 공지 상세] 요청 실패", { url: `/notices/${id}`, error: requestError });
      setDetailError(requestError instanceof Error ? requestError.message : "공지 상세를 불러오지 못했습니다.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      await api("/notices/refresh", { method: "POST" });
      detailCache.current.clear();
      await loadNotices();
    } catch (requestError) {
      console.error("[학교 공지 새로고침] 실패", requestError);
      setError(requestError instanceof Error ? requestError.message : "새로고침에 실패했습니다.");
      setLoading(false);
    }
  }

  async function summarize() {
    if (!selectedId || summaryLoading) return;
    setSummaryLoading(true);
    try {
      setSummary(await api(`/notices/${selectedId}/summary`, { method: "POST" }));
    } catch (requestError) {
      console.error("[학교 공지 AI 요약] 실패", requestError);
      setSummary({ available: false, message: requestError instanceof Error ? requestError.message : "AI 요약에 실패했습니다." });
    } finally {
      setSummaryLoading(false);
    }
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setDetailError("");
    setSummary(null);
  }

  return (
    <div className="notices-page">
      <section className="notices-hero">
        <span><FileText /></span>
        <div>
          <p>KMU SMART SCHEDULER</p>
          <h1>계명대학교 학교 공지</h1>
          <small>학교 공식 일반공지를 검색하고 중요한 소식을 즐겨찾기에 보관합니다.</small>
          <i className={error ? "offline" : "online"}>{error ? "API 연결 실패" : "계명대학교 일반공지 연결"} · 마지막 갱신 {formatFetchedAt(data.fetchedAt)}</i>
        </div>
        <button onClick={refresh} disabled={loading}><RefreshCw className={loading ? "spin" : ""} /> 새로고침</button>
      </section>

      {error && <div className="notices-error" role="alert"><span>{error}</span><button onClick={() => loadNotices()}>다시 시도</button></div>}

      <section className="notices-controls" aria-label="공지 검색 및 필터">
        <form onSubmit={submitSearch}>
          <Search />
          <input aria-label="공지 검색어" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="제목, 본문, 부서 검색" />
          <button type="submit">검색</button>
        </form>
        <select aria-label="공지 카테고리" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
          {CATEGORIES.map((value) => <option key={value}>{value}</option>)}
        </select>
        <button className={favoritesOnly ? "active" : ""} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((value) => !value)}><Bookmark /> 즐겨찾기만</button>
        <button onClick={resetFilters}>초기화</button>
      </section>

      <div className="notices-layout">
        <section className="notices-list-card">
          <header><div><h2>일반공지</h2><span>{favoritesOnly ? `${visibleItems.length}건 표시` : `총 ${data.total}건`}</span></div><small>최신순 · 계명대학교 실시간 데이터</small></header>
          {loading ? (
            <div className="notices-state"><LoaderCircle className="spin" /> 공지를 불러오는 중입니다.</div>
          ) : visibleItems.length ? (
            <div className="notices-list">
              {visibleItems.map((notice) => {
                const favorite = favorites.has(String(notice.id));
                return (
                  <article key={notice.id} className={selectedId === String(notice.id) ? "selected" : ""}>
                    <button className="notice-main" onClick={() => selectNotice(notice)} aria-selected={selectedId === String(notice.id)}>
                      <NoticeBadges notice={notice} />
                      <b>{notice.title}</b>
                      <span>{notice.department || "부서 미표기"} · {notice.date || "날짜 미표기"}</span>
                    </button>
                    <button className="favorite-button" onClick={() => toggleFavorite(notice.id)} aria-label={`${notice.title} 즐겨찾기`} aria-pressed={favorite}><Bookmark fill={favorite ? "currentColor" : "none"} /></button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="notices-state">검색 조건에 맞는 공지가 없습니다.</div>
          )}
          {!favoritesOnly && !loading && data.total > 0 && (
            <footer><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>이전</button><b>{page} 페이지</b><button disabled={!data.hasMore} onClick={() => setPage((value) => value + 1)}>다음</button></footer>
          )}
        </section>

        <aside className={`notice-detail ${selectedId ? "open" : ""}`} ref={panelRef} tabIndex="-1" aria-label="공지 상세">
          {!selectedId ? (
            <div className="detail-placeholder"><FileText /><b>공지 상세</b><p>공지를 선택하면 상세 정보가 표시됩니다.</p></div>
          ) : (
            <>
              <header>
                {detail ? <NoticeBadges notice={detail} /> : <span />}
                <button onClick={closeDetail} aria-label="공지 상세 패널 닫기"><X /></button>
              </header>
              {detailLoading ? <div className="notices-state"><LoaderCircle className="spin" /> 상세 내용을 불러오는 중입니다.</div> : detailError ? <div className="notices-error" role="alert">{detailError}</div> : detail && (
                <div className="detail-content">
                  <h2>{detail.title}</h2>
                  <dl>
                    {detail.date && <><dt>작성일</dt><dd>{detail.date}</dd></>}
                    {detail.department && <><dt>작성부서</dt><dd>{detail.department}</dd></>}
                    {detail.contact && <><dt>문의처</dt><dd>{detail.contact}</dd></>}
                    {detail.email && <><dt>이메일</dt><dd>{detail.email}</dd></>}
                  </dl>
                  <section><h3>본문</h3>{detail.content ? <p className="notice-body">{detail.content}</p> : <p className="muted">본문 텍스트가 없습니다. 이미지 공지는 원문에서 확인해주세요.</p>}</section>
                  <section><h3>첨부파일</h3>{detail.attachments?.length ? <ul>{detail.attachments.map((file) => <li key={file.url}><a href={file.url} target="_blank" rel="noreferrer"><FileText />{file.name}</a></li>)}</ul> : <p className="muted">첨부파일이 없습니다.</p>}</section>
                  <div className="detail-actions">
                    <a href={detail.url} target="_blank" rel="noreferrer">원문 보기 <ExternalLink /></a>
                    <button aria-pressed={favorites.has(String(detail.id))} onClick={() => toggleFavorite(detail.id)}><Bookmark fill={favorites.has(String(detail.id)) ? "currentColor" : "none"} /> 즐겨찾기</button>
                    <button onClick={summarize} disabled={summaryLoading}><Sparkles /> {summaryLoading ? "요약 중" : "AI 요약"}</button>
                  </div>
                  {summary && <section className="summary-card" aria-live="polite">{summary.available === false ? <p>{summary.message}</p> : <><h3>AI 요약</h3><dl>{[["핵심내용", summary.summary?.core ?? summary.core], ["대상", summary.summary?.target ?? summary.target], ["신청기간", summary.summary?.period ?? summary.period], ["해야 할 일", summary.summary?.action ?? summary.action], ["문의처", summary.summary?.contact ?? summary.contact]].filter(([, value]) => value).map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl></>}</section>}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
