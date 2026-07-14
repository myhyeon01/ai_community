import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  RefreshCw,
  X,
} from "lucide-react";
import {
  CATEGORY_META,
  buildCalendarRows,
  calendarEvents,
  dateKey,
  eventsByDate,
  getEventStyle,
  summaryFor,
  yearsFor,
} from "./academicCalendar";
import "./academicCalendar.css";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const SOURCE_URL = "https://www.kmu.ac.kr/page.jsp?mnu_uid=3373";

function rangeLabel(event) {
  return event.startDate === event.endDate
    ? event.startDate
    : `${event.startDate} ~ ${event.endDate}`;
}
function timeLabel(event) {
  return [event.startTime, event.endTime].filter(Boolean).join(" - ");
}

export default function AcademicCalendarView({
  schedules,
  changes,
  loading,
  error,
  fetchedAt,
  refresh,
}) {
  const events = useMemo(
    () => calendarEvents(schedules, changes),
    [schedules, changes],
  );
  const years = useMemo(() => yearsFor(events), [events]);
  const initialYear = years.includes(new Date().getFullYear())
    ? new Date().getFullYear()
    : years[0] || new Date().getFullYear();
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(
    year === new Date().getFullYear() ? new Date().getMonth() : 0,
  );
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const detailRef = useRef(null);
  const yearEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          Number(event.startDate.slice(0, 4)) === year ||
          Number(event.endDate.slice(0, 4)) === year,
      ),
    [events, year],
  );
  const dateEvents = useMemo(() => eventsByDate(yearEvents), [yearEvents]);
  const calendarRows = useMemo(
    () => buildCalendarRows(year, month, yearEvents),
    [year, month, yearEvents],
  );
  const summaries = useMemo(() => summaryFor(yearEvents), [yearEvents]);
  const eventRange = useMemo(() => {
    const starts = yearEvents.map((event) => event.startDate).sort();
    const ends = yearEvents.map((event) => event.endDate).sort();
    return starts.length ? `${starts[0]} ~ ${ends.at(-1)}` : null;
  }, [yearEvents]);
  const selectedDateEvents = selectedDate
    ? dateEvents.get(selectedDate) || []
    : [];
  const connectedChanges =
    selectedEvent?.source === "official"
      ? changes.filter(
          (row) =>
            (selectedEvent.original_date &&
              row.originalDate === selectedEvent.original_date) ||
            (selectedEvent.changed_date &&
              row.changedDate === selectedEvent.changed_date) ||
            row.id === selectedEvent.id,
        )
      : [];

  useEffect(() => {
    if (years.length && !years.includes(year)) setYear(years[0]);
  }, [years, year]);
  useEffect(() => {
    if (
      selectedEvent &&
      !yearEvents.some(
        (event) => event.calendarKey === selectedEvent.calendarKey,
      )
    ) {
      setSelectedEvent(null);
      setSelectedDate(null);
    }
  }, [yearEvents, selectedEvent]);
  useEffect(() => {
    if (!selectedDate || !window.matchMedia("(max-width: 900px)").matches)
      return;
    const frame = window.requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [selectedDate, selectedEvent]);

  function moveMonth(direction) {
    const next = new Date(year, month + direction, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  }
  function chooseDate(key) {
    const rows = dateEvents.get(key) || [];
    setSelectedDate(key);
    setSelectedEvent(rows[0] || null);
  }
  function chooseEvent(event, key) {
    setSelectedDate(key);
    setSelectedEvent(event);
  }

  return (
    <div className="ac-page">
      <section className="ac-hero">
        <span>
          <GraduationCap />
        </span>
        <div>
          <p>KMU SMART SCHEDULER</p>
          <h1>계명대학교 학사일정</h1>
          <small>
            학교 공식 일정을 달력으로 확인하고 보강일을 시간표에 반영합니다.
          </small>
          <div className={`ac-connection ${error ? "failed" : ""}`}>
            {error
              ? "API 연결 실패"
              : "공식 일정 캐시 · 백엔드 실행 시 자동 동기화"}
            {fetchedAt && !error
              ? ` · ${new Date(fetchedAt).toLocaleString("ko-KR")}`
              : ""}
          </div>
        </div>
        <button disabled={loading} onClick={() => refresh(true)}>
          <RefreshCw />
          {loading ? "동기화 중" : "새로고침"}
        </button>
      </section>
      {error && (
        <section className="ac-error">
          <div>
            <b>학사일정을 불러오지 못했습니다.</b>
            <span>{error}</span>
          </div>
          <button onClick={() => refresh(true)}>재시도</button>
        </section>
      )}
      <section className="ac-summaries">
        {summaries.map((item) => (
          <article key={item.category} className={`cat-${item.category}`}>
            <header>
              <span>{item.label}</span>
              <b>{item.count}건</b>
            </header>
            <h2>{item.representative?.title || "등록된 일정 없음"}</h2>
            <p>{item.representative ? rangeLabel(item.representative) : "-"}</p>
          </article>
        ))}
      </section>
      <section className="ac-workspace">
        <article className="ac-calendar-card">
          <header className="ac-calendar-toolbar">
            <div>
              <button aria-label="이전 달" onClick={() => moveMonth(-1)}>
                <ChevronLeft />
              </button>
              <h2>
                {year}년 {month + 1}월
              </h2>
              <button aria-label="다음 달" onClick={() => moveMonth(1)}>
                <ChevronRight />
              </button>
            </div>
            <label>
              <span>학년도</span>
              <select
                aria-label="학년도 선택"
                value={year}
                onChange={(event) => {
                  setYear(Number(event.target.value));
                  setMonth(0);
                  setSelectedDate(null);
                  setSelectedEvent(null);
                }}
              >
                {years.map((value) => (
                  <option key={value} value={value}>
                    {value}학년도
                  </option>
                ))}
              </select>
            </label>
          </header>
          <p className="ac-range">
            {eventRange ? `${eventRange} 등록 일정` : "등록된 데이터 범위 없음"}
          </p>
          {loading && !events.length ? (
            <div className="ac-loading">공식 학사일정을 불러오는 중입니다.</div>
          ) : !yearEvents.length ? (
            <div className="ac-loading">표시할 일정이 없습니다.</div>
          ) : (
            <div className="ac-grid">
              <div className="ac-weekdays">
                {WEEKDAYS.map((day, index) => (
                  <b
                    className={index === 0 ? "sun" : index === 6 ? "sat" : ""}
                    key={day}
                  >
                    {day}
                  </b>
                ))}
              </div>
              <div className="ac-weeks">
                {calendarRows.map((calendarRow) => (
                  <div className="ac-week" key={calendarRow.weekStart}>
                    <div className="ac-week-days">
                      {calendarRow.days.map((date) => {
                        const key = dateKey(date);
                        const rows = dateEvents.get(key) || [];
                        const outside = date.getMonth() !== month;
                        const today = key === dateKey(new Date());
                        return (
                          <div
                            className={`ac-day ${outside ? "outside" : ""} ${today ? "today" : ""} ${selectedDate === key ? "selected" : ""}`}
                            key={key}
                          >
                            <button
                              type="button"
                              className={`ac-date-number ${date.getDay() === 0 ? "sun" : date.getDay() === 6 ? "sat" : ""}`}
                              onClick={() => chooseDate(key)}
                              aria-label={`${key}, 일정 ${rows.length}건`}
                              aria-selected={selectedDate === key}
                            >
                              {date.getDate()}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="ac-week-events">
                      {calendarRow.visibleSegments.map((segment) => {
                        const style = getEventStyle(segment.event.category);
                        const selected =
                          selectedEvent?.calendarKey ===
                          segment.event.calendarKey;
                        return (
                          <button
                            type="button"
                            aria-selected={selected}
                            className={`ac-event-bar ${style.className} ${segment.continuesBefore ? "continues-before" : ""} ${segment.continuesAfter ? "continues-after" : ""} ${selected ? "active" : ""}`}
                            data-event-key={segment.event.calendarKey}
                            key={`${segment.event.calendarKey}-${segment.startDate}`}
                            title={`${segment.event.title} (${rangeLabel(segment.event)})`}
                            style={{
                              gridColumn: `${segment.startDay + 1} / span ${segment.span}`,
                              gridRow: segment.lane + 1,
                            }}
                            onClick={() =>
                              chooseEvent(segment.event, segment.startDate)
                            }
                          >
                            <span>{segment.event.title}</span>
                          </button>
                        );
                      })}
                      {[...calendarRow.hiddenByDate.entries()].map(
                        ([key, hidden]) => {
                          const day = calendarRow.days.findIndex(
                            (date) => dateKey(date) === key,
                          );
                          return (
                            <button
                              type="button"
                              className="ac-more"
                              key={key}
                              style={{ gridColumn: day + 1, gridRow: 4 }}
                              aria-label={`${key} 숨겨진 일정 ${hidden.length}개 모두 보기`}
                              onClick={() => chooseDate(key)}
                            >
                              +{hidden.length}개 더보기
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </article>
        <aside ref={detailRef} className="ac-detail" aria-live="polite">
          <header>
            <div>
              {selectedEvent && (
                <span className={`ac-category cat-${selectedEvent.category}`}>
                  {CATEGORY_META[selectedEvent.category]?.label}
                </span>
              )}
              <h2>일정 상세</h2>
            </div>
            {(selectedDate || selectedEvent) && (
              <button
                aria-label="일정 상세 닫기"
                onClick={() => {
                  setSelectedDate(null);
                  setSelectedEvent(null);
                }}
              >
                <X />
              </button>
            )}
          </header>
          {!selectedDate ? (
            <div className="ac-detail-empty">
              일정을 선택하면 상세 정보가 표시됩니다.
            </div>
          ) : (
            <>
              <section className="ac-date-list">
                <b>{selectedDate}</b>
                {!selectedDateEvents.length ? (
                  <p>등록된 일정이 없습니다.</p>
                ) : (
                  selectedDateEvents.map((event) => (
                    <button
                      aria-selected={
                        selectedEvent?.calendarKey === event.calendarKey
                      }
                      className={
                        selectedEvent?.calendarKey === event.calendarKey
                          ? "active"
                          : ""
                      }
                      key={event.calendarKey}
                      onClick={() => setSelectedEvent(event)}
                    >
                      {event.title}
                    </button>
                  ))
                )}
              </section>
              {selectedEvent && (
                <section className="ac-detail-body">
                  <h3>{selectedEvent.title}</h3>
                  <dl>
                    {selectedEvent.startDate === selectedEvent.endDate ? (
                      <div>
                        <dt>날짜</dt>
                        <dd>{selectedEvent.startDate}</dd>
                      </div>
                    ) : (
                      <>
                        <div>
                          <dt>시작일</dt>
                          <dd>{selectedEvent.startDate}</dd>
                        </div>
                        <div>
                          <dt>종료일</dt>
                          <dd>{selectedEvent.endDate}</dd>
                        </div>
                      </>
                    )}
                    <div>
                      <dt>카테고리</dt>
                      <dd>{CATEGORY_META[selectedEvent.category]?.label}</dd>
                    </div>
                    {selectedEvent.description && (
                      <div>
                        <dt>설명</dt>
                        <dd>{selectedEvent.description}</dd>
                      </div>
                    )}
                    {selectedEvent.source === "official" && (
                      <div>
                        <dt>출처</dt>
                        <dd>
                          <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                            계명대학교 공식 학사일정
                          </a>
                        </dd>
                      </div>
                    )}
                    {selectedEvent.event_type && (
                      <div>
                        <dt>원본 구분</dt>
                        <dd>{selectedEvent.event_type}</dd>
                      </div>
                    )}
                    {selectedEvent.date && (
                      <div>
                        <dt>원본 일정</dt>
                        <dd>
                          {selectedEvent.date} · {selectedEvent.title}
                        </dd>
                      </div>
                    )}
                    {selectedEvent.schedule_type && (
                      <div>
                        <dt>휴강·보강</dt>
                        <dd>{selectedEvent.schedule_type}</dd>
                      </div>
                    )}
                    {selectedEvent.original_date && (
                      <div>
                        <dt>원래 날짜</dt>
                        <dd>{selectedEvent.original_date}</dd>
                      </div>
                    )}
                    {selectedEvent.schedule_type && (
                      <div>
                        <dt>변경된 날짜</dt>
                        <dd>
                          {selectedEvent.changed_date || "보강 일정 미정"}
                        </dd>
                      </div>
                    )}
                    {selectedEvent.courseName && (
                      <div>
                        <dt>연결 강의</dt>
                        <dd>{selectedEvent.courseName}</dd>
                      </div>
                    )}
                    {timeLabel(selectedEvent) && (
                      <div>
                        <dt>수업 시간</dt>
                        <dd>{timeLabel(selectedEvent)}</dd>
                      </div>
                    )}
                    {selectedEvent.classroom && (
                      <div>
                        <dt>강의실</dt>
                        <dd>{selectedEvent.classroom}</dd>
                      </div>
                    )}
                  </dl>
                  {connectedChanges.map((row) => (
                    <div className="ac-linked" key={row.id}>
                      <b>{row.courseName}</b>
                      <span>
                        {row.originalDate} →{" "}
                        {row.changedDate || "보강 일정 미정"}
                      </span>
                      {(timeLabel(row) || row.classroom) && (
                        <small>
                          {[timeLabel(row), row.classroom]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      )}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </aside>
      </section>
    </div>
  );
}
