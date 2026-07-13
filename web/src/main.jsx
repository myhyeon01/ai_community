import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  LogOut,
  Plus,
  Trash2,
} from "lucide-react";
import { supabase } from "./supabase";
import { recognizeTimetable } from "./ocr";
import Portal from "./Portal";
import "./styles.css";
import "./ocr.css";
import "./week.css";
import "./cleanup.css";
import "./groups.css";
import "./timetable-actions.css";
const days = ["월", "화", "수", "목", "금", "토", "일"],
  authEmail = (id) => `${id.trim()}@kmu.local`,
  empty = () => ({
    subject: "",
    professor: "",
    classroom: "",
    weekday: 0,
    start_time: "09:00",
    end_time: "10:15",
  });
const isUsefulCourse = (row) => {
  const subject = String(row?.subject || "")
    .replace(/\s+/g, "")
    .trim();
  return (
    subject.length >= 2 &&
    !/^(수업|강의|미정|과목|[A-Za-z가-힣])$/.test(subject)
  );
};
const toMinutes = (time) => {
  const [h, m] = String(time || "00:00")
    .slice(0, 5)
    .split(":")
    .map(Number);
  return h * 60 + m;
};
const rangesOverlap = (a, b) =>
  a.weekday === b.weekday &&
  toMinutes(a.start_time) < toMinutes(b.end_time) &&
  toMinutes(a.end_time) > toMinutes(b.start_time);
const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const mondayOf = (date) => {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  return monday;
};
const monthDay = (date) => `${date.getMonth() + 1}.${date.getDate()}`;
function Back({ onClick }) {
  return (
    <button type="button" className="back" onClick={onClick}>
      <ArrowLeft />
      뒤로가기
    </button>
  );
}
function Auth() {
  const [signup, setSignup] = useState(false),
    [f, setF] = useState({
      studentId: "",
      password: "",
      name: "",
      department: "",
      grade: 1,
    }),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  const change = (e) => setF({ ...f, [e.target.name]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const email = authEmail(f.studentId),
      r = signup
        ? await supabase.auth.signUp({
            email,
            password: f.password,
            options: {
              data: {
                student_id: f.studentId.trim(),
                name: f.name.trim(),
                department: f.department.trim(),
                grade: +f.grade,
              },
            },
          })
        : await supabase.auth.signInWithPassword({
            email,
            password: f.password,
          });
    if (r.error) setMsg(r.error.message);
    setBusy(false);
  }
  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div className="brand-mark">
          <CalendarDays />
        </div>
        <p>계명대학교 학생을 위한 스마트 일정 관리</p>
        <h1>
          수업부터 공부까지,
          <br />
          <span>하루를 더 스마트하게.</span>
        </h1>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          {signup && <Back onClick={() => setSignup(false)} />}
          <div className="mobile-logo">
            <CalendarDays /> KMU Smart Scheduler
          </div>
          <h2>{signup ? "간편 회원가입" : "학번으로 로그인"}</h2>
          <p>
            {signup
              ? "기본 정보만 입력하면 바로 시작할 수 있어요."
              : "오늘의 수업과 일정을 확인하세요."}
          </p>
          {msg && <div className="error">{msg}</div>}
          <label>
            학번
            <input
              required
              name="studentId"
              value={f.studentId}
              onChange={change}
            />
          </label>
          {signup && (
            <>
              <div className="form-row">
                <label>
                  이름
                  <input
                    required
                    name="name"
                    value={f.name}
                    onChange={change}
                  />
                </label>
                <label>
                  학년
                  <select name="grade" value={f.grade} onChange={change}>
                    {[1, 2, 3, 4, 5, 6].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                학과
                <input
                  required
                  name="department"
                  value={f.department}
                  onChange={change}
                />
              </label>
            </>
          )}
          <label>
            비밀번호
            <input
              required
              minLength="8"
              type="password"
              name="password"
              value={f.password}
              onChange={change}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "처리 중…" : signup ? "회원가입" : "로그인"}
          </button>
          {!signup && (
            <button
              className="text-button"
              type="button"
              onClick={() => setSignup(true)}
            >
              처음이신가요? 회원가입
            </button>
          )}
        </form>
      </section>
    </main>
  );
}
function Editor({ row, i, change, remove }) {
  const set = (k, v) => change(i, { ...row, [k]: v });
  return (
    <div className="ocr-row">
      <header>
        <b>수업 {i + 1}</b>
        <button type="button" onClick={() => remove(i)}>
          <Trash2 />
          삭제
        </button>
      </header>
      <label>
        과목명
        <input
          required
          value={row.subject}
          onChange={(e) => set("subject", e.target.value)}
        />
      </label>
      <div className="form-row">
        <label>
          교수명
          <input
            value={row.professor}
            onChange={(e) => set("professor", e.target.value)}
          />
        </label>
        <label>
          강의실
          <input
            value={row.classroom}
            onChange={(e) => set("classroom", e.target.value)}
          />
        </label>
      </div>
      <div className="form-row triple">
        <label>
          요일
          <select
            value={row.weekday}
            onChange={(e) => set("weekday", +e.target.value)}
          >
            {days.map((d, x) => (
              <option key={d} value={x}>
                {d}요일
              </option>
            ))}
          </select>
        </label>
        <label>
          시작
          <input
            type="time"
            value={row.start_time}
            onChange={(e) => set("start_time", e.target.value)}
          />
        </label>
        <label>
          종료
          <input
            type="time"
            value={row.end_time}
            onChange={(e) => set("end_time", e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
function ColorGroupEditor({ group, index, update, remove }) {
  const first = group.rows[0];
  return (
    <div className="ocr-row color-group">
      <header>
        <div className="color-title">
          <i style={{ background: group.color }} />
          <b>색상 과목 {index + 1}</b>
          <span>{group.rows.length}개 수업</span>
        </div>
        <button type="button" onClick={() => remove(group.color)}>
          <Trash2 />
          그룹 삭제
        </button>
      </header>
      <label>
        과목명
        <input
          required
          value={first.subject}
          placeholder="과목명을 입력하세요"
          onChange={(e) => update(group.color, "subject", e.target.value)}
        />
      </label>
      <div className="form-row">
        <label>
          교수명
          <input
            value={first.professor}
            placeholder="교수명을 입력하세요"
            onChange={(e) => update(group.color, "professor", e.target.value)}
          />
        </label>
        <label>
          강의실
          <input
            value={first.classroom}
            placeholder="강의실을 입력하세요"
            onChange={(e) => update(group.color, "classroom", e.target.value)}
          />
        </label>
      </div>
      <div className="detected-sessions">
        {group.rows.map((row, rowIndex) => (
          <span key={rowIndex}>
            <b>{days[row.weekday]}요일</b>
            {row.start_time}–{row.end_time}
          </span>
        ))}
      </div>
    </div>
  );
}
function Register({ session, back, saved, existingRows = [] }) {
  const [mode, setMode] = useState("manual"),
    [rows, setRows] = useState([empty()]),
    [file, setFile] = useState(),
    [url, setUrl] = useState(""),
    [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function pick(e) {
    const x = e.target.files?.[0];
    if (!x) return;
    setFile(x);
    if (url) URL.revokeObjectURL(url);
    setUrl(URL.createObjectURL(x));
    setRows([]);
  }
  async function scan() {
    setBusy(true);
    setError("");
    try {
      const r = await recognizeTimetable(file, setProgress);
      setRows(r.rows);
      const needsReview = r.rows.filter((row) => !isUsefulCourse(row)).length;
      if (!r.rows.length)
        setError(
          "자동으로 찾은 수업이 없습니다. 직접 추가하거나 더 선명한 캡처를 사용해주세요.",
        );
      else if (needsReview > 0)
        setError(
          `${needsReview}개 블록의 과목명을 확인하고 수정한 뒤 저장해주세요.`,
        );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e) {
    e.preventDefault();
    const invalid = rows.filter((row) => !isUsefulCourse(row));
    if (false && invalid.length)
      return setError(
        "과목명이 없거나 부정확한 항목을 수정한 후 저장해주세요.",
      );
    if (!rows.length) return setError("저장할 수업을 추가해주세요.");
    const usefulRows = rows.filter(isUsefulCourse);
    for (let i = 0; i < usefulRows.length; i += 1) {
      const row = usefulRows[i];
      const existing = existingRows.find(
        (item) => isUsefulCourse(item) && rangesOverlap(row, item),
      );
      if (existing)
        return setError(
          `${existing.start_time.slice(0, 5)}-${existing.end_time.slice(0, 5)} ${existing.subject} 일정과 시간이 겹칩니다.`,
        );
      const duplicate = usefulRows.find(
        (item, index) => index !== i && rangesOverlap(row, item),
      );
      if (duplicate)
        return setError(
          `${duplicate.start_time.slice(0, 5)}-${duplicate.end_time.slice(0, 5)} ${duplicate.subject} 일정과 시간이 겹칩니다.`,
        );
    }
    const { error } = await supabase
      .from("timetables")
      .insert(rows.map((r) => ({ ...r, user_id: session.user.id })));
    error ? setError(error.message) : saved();
  }
  const colorGroups = Object.values(
    rows.reduce((result, row) => {
      const color = row.color || "#64748b";
      if (!result[color]) result[color] = { color, rows: [] };
      result[color].rows.push(row);
      return result;
    }, {}),
  );
  const updateColorGroup = (color, key, value) =>
    setRows(
      rows.map((row) =>
        (row.color || "#64748b") === color ? { ...row, [key]: value } : row,
      ),
    );
  const removeColorGroup = (color) =>
    setRows(rows.filter((row) => (row.color || "#64748b") !== color));
  return (
    <div className="content">
      <section className="card register">
        <Back onClick={back} />
        <span className="eyebrow">TIMETABLE REGISTRATION</span>
        <h1>시간표 등록</h1>
        <p>직접 입력하거나 에브리타임 캡처를 인식할 수 있어요.</p>
        <div className="tabs">
          <button
            className={mode === "manual" ? "active" : ""}
            onClick={() => {
              setMode("manual");
              if (!rows.length) setRows([empty()]);
            }}
          >
            직접 입력
          </button>
          <button
            className={mode === "ocr" ? "active" : ""}
            onClick={() => {
              setMode("ocr");
              setRows([]);
            }}
          >
            <Camera />
            에타 캡처 OCR
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {mode === "ocr" && (
          <div className="upload">
            <label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={pick}
              />
              {url ? (
                <img src={url} />
              ) : (
                <>
                  <ImagePlus />
                  <b>에브리타임 시간표 캡처 선택</b>
                  <small>PNG, JPG, WEBP</small>
                </>
              )}
            </label>
            <button
              className="secondary"
              disabled={!file || busy}
              onClick={scan}
            >
              {busy ? `인식 중 ${progress}%` : "시간표 인식 시작"}
            </button>
            {busy && (
              <div className="bar">
                <i style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
        )}
        <form onSubmit={save}>
          {mode === "ocr"
            ? colorGroups.map((group, i) => (
                <ColorGroupEditor
                  key={group.color}
                  group={group}
                  index={i}
                  update={updateColorGroup}
                  remove={removeColorGroup}
                />
              ))
            : rows.map((r, i) => (
                <Editor
                  key={i}
                  row={r}
                  i={i}
                  change={(x, v) =>
                    setRows(rows.map((a, j) => (j === x ? v : a)))
                  }
                  remove={(x) => setRows(rows.filter((_, j) => j !== x))}
                />
              ))}
          <button
            type="button"
            className="secondary add-row"
            onClick={() => setRows([...rows, empty()])}
          >
            <Plus />
            수업 직접 추가
          </button>
          <footer>
            <button type="button" className="secondary" onClick={back}>
              취소
            </button>
            <button className="primary">{rows.length}개 수업 저장</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
function WeeklyBoard({ rows }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const startHour = 9;
  const endHour = 22;
  const hourHeight = 92;
  const weekStart = addDays(mondayOf(new Date()), weekOffset * 7);
  const weekDates = days.map((_, index) => addDays(weekStart, index));
  const columnWidth = 100 / days.length;
  return (
    <section className="card week-card">
      <div className="card-title">
        <div>
          <span>
            <CalendarDays />
          </span>
          <h2>내 주간 시간표</h2>
        </div>
        <small>
          {String(startHour).padStart(2, "0")}:00–
          {String(endHour).padStart(2, "0")}:00
        </small>
      </div>
      <div className="week-controls">
        <button type="button" onClick={() => setWeekOffset((v) => v - 1)}>
          <ChevronLeft />
          이전 주
        </button>
        <button type="button" onClick={() => setWeekOffset(0)}>
          이번 주
        </button>
        <button type="button" onClick={() => setWeekOffset((v) => v + 1)}>
          다음 주
          <ChevronRight />
        </button>
      </div>
      <div className="week-range">
        {weekStart.getFullYear()}.{monthDay(weekDates[0])} -{" "}
        {weekDates[6].getFullYear()}.{monthDay(weekDates[6])}
      </div>
      <div className="week-scroll">
        <div className="week-board">
          <div className="week-head corner">시간</div>
          {days.map((day, i) => (
            <div className="week-head" style={{ gridColumn: i + 2 }} key={day}>
              {day}요일
            </div>
          ))}
          <div className="week-times">
            {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
              <span key={i} style={{ top: i * hourHeight }}>
                {String(startHour + i).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          <div
            className="week-grid"
            style={{ height: (endHour - startHour) * hourHeight }}
          >
            {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
              <i
                className="hour-line"
                key={`h-${i}`}
                style={{ top: i * hourHeight }}
              />
            ))}
            {days.map((day, i) => (
              <i
                className="day-line"
                key={day}
                style={{ left: `${i * columnWidth}%` }}
              />
            ))}
            {rows
              .filter((row) => row.weekday < days.length && isUsefulCourse(row))
              .map((row) => {
                const top =
                    ((toMinutes(row.start_time) - startHour * 60) / 60) *
                    hourHeight,
                  height = Math.max(
                    30,
                    ((toMinutes(row.end_time) - toMinutes(row.start_time)) /
                      60) *
                      hourHeight,
                  );
                return (
                  <article
                    className="class-block"
                    key={row.id}
                    style={{
                      top,
                      left: `calc(${row.weekday * columnWidth}% + 4px)`,
                      width: `calc(${columnWidth}% - 8px)`,
                      height,
                      background: row.color || "#356AE6",
                    }}
                  >
                    <b>{row.subject}</b>
                    <span>{row.classroom || "강의실 미정"}</span>
                    <small>
                      {row.start_time.slice(0, 5)}–{row.end_time.slice(0, 5)}
                    </small>
                  </article>
                );
              })}
          </div>
        </div>
      </div>
    </section>
  );
}

function Dashboard({ session }) {
  const [profile, setProfile] = useState(),
    [rows, setRows] = useState([]),
    [adding, setAdding] = useState(false),
    [error, setError] = useState("");
  async function load() {
    const [p, t] = await Promise.all([
      supabase.from("profiles").select("*").single(),
      supabase
        .from("timetables")
        .select("*")
        .order("weekday")
        .order("start_time"),
    ]);
    p.error ? setError(p.error.message) : setProfile(p.data);
    t.error ? setError(t.error.message) : setRows(t.data || []);
  }
  useEffect(() => {
    load();
  }, []);
  async function remove(id) {
    await supabase.from("timetables").delete().eq("id", id);
    load();
  }
  async function removeInvalid() {
    const invalidIds = rows
      .filter((row) => !isUsefulCourse(row))
      .map((row) => row.id);
    if (!invalidIds.length) return;
    const { error: deleteError } = await supabase
      .from("timetables")
      .delete()
      .in("id", invalidIds);
    if (deleteError) setError(deleteError.message);
    else load();
  }
  if (adding)
    return (
      <Register
        session={session}
        existingRows={rows}
        back={() => setAdding(false)}
        saved={() => {
          setAdding(false);
          load();
        }}
      />
    );
  return (
    <div className="content">
      <header className="topbar">
        <div>
          <span className="eyebrow">KMU SMART SCHEDULER</span>
          <h1>{profile ? `${profile.name}님의 시간표` : "내 시간표"}</h1>
        </div>
        <div className="top-actions">
          <button className="add" onClick={() => setAdding(true)}>
            <Plus />
            수업 등록
          </button>
          <button
            className="icon-button"
            onClick={() => supabase.auth.signOut()}
          >
            <LogOut />
          </button>
        </div>
      </header>
      {error && <div className="error">{error}</div>}
      {rows.some((row) => !isUsefulCourse(row)) && (
        <div className="cleanup-notice">
          <span>과목명이 없는 잘못된 OCR 데이터가 있습니다.</span>
          <button onClick={removeInvalid}>
            <Trash2 />
            잘못된 항목 정리
          </button>
        </div>
      )}
      <WeeklyBoard rows={rows} />
      <section className="card">
        <div className="card-title">
          <div>
            <span>
              <CalendarDays />
            </span>
            <h2>주간 시간표</h2>
          </div>
          <small>{rows.length}개 수업</small>
        </div>
        <div className="table">
          <table>
            <thead>
              <tr>
                <th>요일</th>
                <th>시간</th>
                <th>과목</th>
                <th>교수</th>
                <th>강의실</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.filter(isUsefulCourse).map((r) => (
                <tr key={r.id}>
                  <td>{days[r.weekday]}요일</td>
                  <td>
                    {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}
                  </td>
                  <td>
                    <b>{r.subject}</b>
                  </td>
                  <td>{r.professor || "-"}</td>
                  <td>{r.classroom || "-"}</td>
                  <td>
                    <button
                      className="icon-button"
                      onClick={() => remove(r.id)}
                    >
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="empty">
              <b>등록된 수업이 없습니다.</b>
              <p>직접 입력하거나 에브리타임 캡처로 등록해보세요.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
function App() {
  const [session, setSession] = useState();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);
  if (session === undefined)
    return (
      <div className="loading-screen">
        <CalendarDays />
        연결 중…
      </div>
    );
  return session ? (
    <Portal session={session} timetable={<Dashboard session={session} />} />
  ) : (
    <Auth />
  );
}
createRoot(document.getElementById("root")).render(<App />);
