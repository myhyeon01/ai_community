import React, { useEffect, useRef, useState } from "react";
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
import { loadUserState, readLocalState, removeUserState, saveUserState } from "./appState";
import { recognizeTimetable } from "./ocr";
import Portal from "./Portal";
import {
  courseCountLabel,
  createTimetableTitle,
  DEFAULT_SEMESTER,
  getCurrentYear,
  getSemesterLabel,
  resolveTimetableTitle,
  SEMESTER_OPTIONS,
  sortTimetables,
  validateSemester,
  validateYear,
} from "./timetables";
import "./styles.css";
import "./ocr.css";
import "./week.css";
import "./cleanup.css";
import "./groups.css";
import "./timetable-actions.css";
const days = ["월", "화", "수", "목", "금"],
  semesterOptions = [
    { value: "1", label: "1학기", starts: "03-02", ends: "06-21" },
    { value: "summer", label: "여름학기", starts: "06-22", ends: "07-19" },
    { value: "2", label: "2학기", starts: "09-01", ends: "12-20" },
    { value: "winter", label: "겨울학기", starts: "12-21", ends: "02-14" },
  ],
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
const makeSemesterId = (year, semester) => `${year}-${semester}`;
const parseSemesterId = (id) => {
  const [year, semester] = String(id || "").split("-");
  return { year: Number(year), semester };
};
const semesterLabel = (semester) =>
  semesterOptions.find((item) => item.value === semester)?.label ||
  `${semester}학기`;
const rowYear = (row, fallbackYear) =>
  Number(row?.year || parseSemesterId(row?.semester_id).year || fallbackYear);
const rowSemester = (row, fallbackSemester) =>
  String(
    row?.semester || parseSemesterId(row?.semester_id).semester || fallbackSemester,
  );
const inSelectedSemester = (row, year, semester) =>
  rowYear(row, 2026) === Number(year) &&
  rowSemester(row, "2") === String(semester);
const dateFromMonthDay = (year, value) => {
  const [month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const semesterPeriod = (year, semester) => {
  const option =
    semesterOptions.find((item) => item.value === semester) ||
    semesterOptions[0];
  const endYear = option.value === "winter" ? year + 1 : year;
  return {
    start: dateFromMonthDay(year, option.starts),
    end: dateFromMonthDay(endYear, option.ends),
  };
};
const weekIntersects = (weekStart, period) => {
  const weekEnd = addDays(weekStart, 6);
  return weekEnd >= period.start && weekStart <= period.end;
};
const weekOffsetFromToday = (targetDate) =>
  Math.round((mondayOf(targetDate) - mondayOf(new Date())) / 604800000);
const defaultWeekOffsetForSemester = (year, semester) => {
  const currentWeek = mondayOf(new Date());
  const period = semesterPeriod(year, semester);
  return weekIntersects(currentWeek, period)
    ? 0
    : weekOffsetFromToday(period.start);
};
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
const summarizeRows = (rows) => {
  const useful = rows.filter(isUsefulCourse);
  const minutes = useful.reduce(
    (sum, row) => sum + toMinutes(row.end_time) - toMinutes(row.start_time),
    0,
  );
  const weekdays = new Set(useful.map((row) => row.weekday)).size;
  const starts = useful.map((row) => row.start_time).sort();
  const ends = useful.map((row) => row.end_time).sort();
  return {
    count: useful.length,
    hours: Math.round((minutes / 60) * 10) / 10,
    weekdays,
    earliest: starts[0]?.slice(0, 5) || "-",
    latest: ends.at(-1)?.slice(0, 5) || "-",
  };
};
const groupSemesterSummary = (rows) => {
  const map = new Map();
  rows.filter(isUsefulCourse).forEach((row) => {
    const year = rowYear(row, 2026);
    const semester = rowSemester(row, "2");
    const key = makeSemesterId(year, semester);
    const prev = map.get(key) || { year, semester, count: 0 };
    map.set(key, { ...prev, count: prev.count + 1 });
  });
  return [...map.values()].sort(
    (a, b) => a.year - b.year || String(a.semester).localeCompare(String(b.semester)),
  );
};
const semesterRank = (semester) => {
  const index = semesterOptions.findIndex((item) => item.value === semester);
  return index === -1 ? semesterOptions.length : index;
};
const sortSemesterTerms = (terms) =>
  [...terms].sort(
    (a, b) => b.year - a.year || semesterRank(b.semester) - semesterRank(a.semester),
  );
const uniqueYears = (terms) => [...new Set(terms.map((item) => item.year))];
const semestersForYear = (terms, year, selectedSemester) => {
  const saved = terms.filter((item) => item.year === Number(year));
  if (saved.some((item) => item.semester === selectedSemester)) return saved;
  const option = semesterOptions.find((item) => item.value === selectedSemester);
  return option
    ? [...saved, { year: Number(year), semester: selectedSemester, count: 0 }]
    : saved;
};
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
            data-row-index={i}
            data-field="subject"
            value={row.subject}
          onChange={(e) => set("subject", e.target.value)}
        />
      </label>
      <div className="form-row">
        <label>
          교수명
          <input
            data-row-index={i}
            data-field="professor"
            value={row.professor}
            onChange={(e) => set("professor", e.target.value)}
          />
        </label>
        <label>
          강의실
          <input
            data-row-index={i}
            data-field="classroom"
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
        <button
          type="button"
          onClick={() => {
            if (window.confirm("이 색상 그룹을 삭제할까요?")) {
              remove(group.key);
            }
          }}
        >
          <Trash2 />
          그룹 삭제
        </button>
      </header>
      <label>
        과목명
        <input
          required
          data-row-index={group.rowIndexes[0] ?? index}
          data-field="subject"
          value={first.subject}
          placeholder="과목명을 입력하세요"
          onChange={(e) => update(group.key, "subject", e.target.value)}
        />
      </label>
      <div className="form-row">
        <label>
          교수명
          <input
            data-row-index={group.rowIndexes[0] ?? index}
            data-field="professor"
            value={first.professor}
            placeholder="교수명을 입력하세요"
            onChange={(e) => update(group.key, "professor", e.target.value)}
          />
        </label>
        <label>
          강의실
          <input
            data-row-index={group.rowIndexes[0] ?? index}
            data-field="classroom"
            value={first.classroom}
            placeholder="강의실을 입력하세요"
            onChange={(e) => update(group.key, "classroom", e.target.value)}
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
const parseOcrColor = (value) => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ""));
  if (!match) return null;
  return {
    r: Number.parseInt(match[1].slice(0, 2), 16),
    g: Number.parseInt(match[1].slice(2, 4), 16),
    b: Number.parseInt(match[1].slice(4, 6), 16),
  };
};
const ocrColorDistance = (left, right) =>
  Math.sqrt(
    (left.r - right.r) ** 2 +
      (left.g - right.g) ** 2 +
      (left.b - right.b) ** 2,
  );
const ocrRowKey = (row, index) => row._ocr?.id || row.id || `ocr-row-${index}`;
const buildOcrColorGroups = (rows) => {
  const groups = [];
  rows.forEach((row, index) => {
    const color = row.color || row._ocr?.color || "#64748b";
    const rgb = parseOcrColor(color);
    let group = rgb
      ? groups.find(
          (candidate) =>
            candidate.rgb &&
            ocrColorDistance(candidate.rgb, rgb) <= 44,
        )
      : null;
    if (!group) {
      group = {
        key: `ocr-color-${color.toLowerCase()}-${groups.length}`,
        color,
        rgb,
        rows: [],
        rowKeys: new Set(),
        rowIndexes: [],
      };
      groups.push(group);
    }
    group.rows.push(row);
    group.rowKeys.add(ocrRowKey(row, index));
    group.rowIndexes.push(index);
    if (rgb) {
      const count = group.rows.length;
      group.rgb = {
        r: (group.rgb.r * (count - 1) + rgb.r) / count,
        g: (group.rgb.g * (count - 1) + rgb.g) / count,
        b: (group.rgb.b * (count - 1) + rgb.b) / count,
      };
    }
  });
  return groups;
};
function TimetableForm({
  title,
  submitLabel,
  initialYear = getCurrentYear(),
  initialSemester = DEFAULT_SEMESTER,
  initialTitle = "",
  existingTimetables = [],
  onCancel,
  onSubmit,
}) {
  const [year, setYear] = useState(initialYear),
    [semester, setSemester] = useState(initialSemester),
    [customTitle, setCustomTitle] = useState(initialTitle),
    [errors, setErrors] = useState({});
  const autoTitle = resolveTimetableTitle(
    Number(year === "" ? 0 : year),
    semester,
    existingTimetables,
  );
  const resolvedTitle = customTitle.trim() || autoTitle;
  const submit = (e) => {
    e.preventDefault();
    const nextErrors = {
      year: validateYear(year),
      semester: validateSemester(semester),
    };
    setErrors(nextErrors);
    if (nextErrors.year || nextErrors.semester) return;
    onSubmit({
      year: Number(year),
      semester,
      title: resolvedTitle,
      titleCustom: Boolean(customTitle.trim()),
    });
  };
  return (
    <section className="card timetable-form-card">
      <Back onClick={onCancel} />
      <span className="eyebrow">TIMETABLE SETUP</span>
      <h1>{title}</h1>
      <form className="timetable-form" onSubmit={submit}>
        <label>
          연도
          <input
            type="number"
            min={0}
            max={3000}
            step={1}
            inputMode="numeric"
            value={year}
            onWheel={(event) => event.currentTarget.blur()}
            onChange={(event) => {
              const value = event.target.value;
              setYear(value === "" ? "" : Number(value));
            }}
          />
          {errors.year && <span className="field-error">{errors.year}</span>}
        </label>
        <label>
          학기
          <select
            value={semester}
            onChange={(event) => setSemester(event.target.value)}
          >
            {SEMESTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.semester && (
            <span className="field-error">{errors.semester}</span>
          )}
        </label>
        <label>
          제목
          <input
            value={customTitle}
            placeholder={autoTitle}
            onChange={(event) => setCustomTitle(event.target.value)}
          />
        </label>
        <div className="timetable-form-preview">{resolvedTitle}</div>
        <footer style={{ alignItems: "center" }}>
          <button type="button" className="secondary" style={{ marginTop: 0 }} onClick={onCancel}>
            취소
          </button>
          <button className="primary" style={{ padding: "10px 15px" }}>{submitLabel}</button>
        </footer>
      </form>
    </section>
  );
}
function Register({
  session,
  back,
  saved,
  existingRows = [],
  selectedTimetable,
  editRow,
}) {
  const formRef = useRef(null);
  const [mode, setMode] = useState("manual"),
    [rows, setRows] = useState([editRow || empty()]),
    [file, setFile] = useState(),
    [url, setUrl] = useState(""),
    [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const focusField = (rowIndex, field) => {
    window.requestAnimationFrame(() => {
      const selector = `[data-row-index="${rowIndex}"][data-field="${field}"]`;
      const target = formRef.current?.querySelector(selector);
      if (target?.focus) {
        target.focus();
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  };
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
    const requiredFields = ["subject", "professor", "classroom"];
    const missingRowIndex = rows.findIndex((row) =>
      requiredFields.some((field) => !String(row?.[field] || "").trim()),
    );
    if (missingRowIndex !== -1) {
      const missingField = requiredFields.find(
        (field) => !String(rows[missingRowIndex]?.[field] || "").trim(),
      );
      setError(
        "저장 전에 과목명, 교수명, 강의실을 모두 입력해주세요. 비어 있는 항목으로 이동합니다.",
      );
      if (missingField) focusField(missingRowIndex, missingField);
      return;
    }
    const usefulRows = rows.filter(isUsefulCourse);
    const now = new Date().toISOString();
    const year = Number(selectedTimetable?.year ?? getCurrentYear());
    const semester = String(selectedTimetable?.semester ?? DEFAULT_SEMESTER);
    const semester_id = makeSemesterId(year, semester);
    for (let i = 0; i < usefulRows.length; i += 1) {
      const row = usefulRows[i];
      const existing = existingRows.find(
        (item) =>
          item.id !== editRow?.id && isUsefulCourse(item) && rangesOverlap(row, item),
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
    if (!window.confirm("수업을 저장할까요?")) return;
    const payload = rows.map((r) => ({
      subject: r.subject,
      professor: r.professor || "",
      classroom: r.classroom || "",
      weekday: r.weekday,
      start_time: r.start_time,
      end_time: r.end_time,
      color: r.color || "#356AE6",
      memo: r.memo || "",
      user_id: session.user.id,
      timetable_id: selectedTimetable.id,
      year,
      semester,
      semester_id,
      updated_at: now,
      ...(editRow ? {} : { created_at: now }),
    }));
    const { error } = editRow
      ? await supabase
          .from("timetables")
          .update(payload[0])
          .eq("id", editRow.id)
      : await supabase.from("timetables").insert(payload);
    error ? setError(error.message) : saved();
  }
  const colorGroups = buildOcrColorGroups(rows);
  const updateColorGroup = (groupKey, key, value) =>
    setRows((currentRows) => {
      const group = buildOcrColorGroups(currentRows).find(
        (item) => item.key === groupKey,
      );
      if (!group) return currentRows;
      return currentRows.map((row, index) =>
        group.rowKeys.has(ocrRowKey(row, index))
          ? { ...row, [key]: value }
          : row,
      );
    });
  const removeColorGroup = (groupKey) =>
    setRows((currentRows) => {
      const group = buildOcrColorGroups(currentRows).find(
        (item) => item.key === groupKey,
      );
      if (!group) return currentRows;
      return currentRows.filter(
        (row, index) => !group.rowKeys.has(ocrRowKey(row, index)),
      );
    });
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
            disabled={!!editRow}
            onClick={() => {
              setMode("ocr");
              setRows([]);
            }}
          >
            <Camera />
            에타 캡처 OCR
          </button>
        </div>
        <div className="semester-context">
          {selectedTimetable.year}년 {semesterLabel(selectedTimetable.semester)}에{" "}
          {editRow ? "과목을 수정합니다." : "과목을 저장합니다."}
        </div>
        {error && <div className="error">{error}</div>}
        {mode === "ocr" && !editRow && (
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
        <form ref={formRef} onSubmit={save}>
          {mode === "ocr" && !editRow
            ? colorGroups.map((group, i) => (
                <ColorGroupEditor
                  key={group.key}
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
            disabled={!!editRow}
          >
            <Plus />
            수업 직접 추가
          </button>
          <footer style={{ alignItems: "center" }}>
            <button type="button" className="secondary" style={{ marginTop: 0 }} onClick={back}>
              취소
            </button>
            <button className="primary" style={{ padding: "10px 15px" }}>{rows.length}개 수업 저장</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
function WeeklyBoard({ rows, selectedYear, selectedSemester }) {
  const [weekOffset, setWeekOffset] = useState(() =>
    defaultWeekOffsetForSemester(selectedYear, selectedSemester),
  );
  const startHour = 9;
  const endHour = 22;
  const hourHeight = 92;
  const weekStart = addDays(mondayOf(new Date()), weekOffset * 7);
  const weekDates = days.map((_, index) => addDays(weekStart, index));
  const columnWidth = 100 / days.length;
  const period = semesterPeriod(selectedYear, selectedSemester);
  const inPeriod = weekIntersects(weekStart, period);
  const visibleRows = inPeriod ? rows : [];
  useEffect(() => {
    setWeekOffset(defaultWeekOffsetForSemester(selectedYear, selectedSemester));
  }, [selectedYear, selectedSemester]);
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
        <button
          type="button"
          onClick={() =>
            setWeekOffset(
              defaultWeekOffsetForSemester(selectedYear, selectedSemester),
            )
          }
        >
          이번 주
        </button>
        <button type="button" onClick={() => setWeekOffset((v) => v + 1)}>
          다음 주
          <ChevronRight />
        </button>
      </div>
      <div className="week-range">
        {weekStart.getFullYear()}.{monthDay(weekDates[0])} -{" "}
        {weekDates[days.length - 1].getFullYear()}.{monthDay(weekDates[days.length - 1])}
      </div>
      {!inPeriod && (
        <div className="semester-alert">
          선택한 주차는 해당 학기의 수업 기간이 아닙니다.
        </div>
      )}
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
            {visibleRows
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

/* Legacy dashboard kept for reference during timetable collection migration.
function DashboardLegacy({ session }) {
  const [profile, setProfile] = useState(),
    [rows, setRows] = useState([]),
    [selectedYear, setSelectedYear] = useState(2026),
    [selectedSemester, setSelectedSemester] = useState("2"),
    [adding, setAdding] = useState(false),
    [editing, setEditing] = useState(null),
    [error, setError] = useState("");
  const semesterRows = rows.filter((row) =>
    inSelectedSemester(row, selectedYear, selectedSemester),
  );
  const summary = summarizeRows(semesterRows);
  const semesterCards = sortSemesterTerms(groupSemesterSummary(rows));
  const yearOptions = semesterCards.length
    ? uniqueYears(semesterCards)
    : [selectedYear];
  const semesterSelectOptions = semesterCards.length
    ? semestersForYear(semesterCards, selectedYear, selectedSemester)
    : [{ year: selectedYear, semester: selectedSemester, count: 0 }];
  const changeTerm = (year, semester) => {
    setAdding(false);
    setEditing(null);
    setSelectedYear(Number(year));
    setSelectedSemester(String(semester));
  };
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
  useEffect(() => {
    if (!semesterCards.length) return;
    const selectedExists = semesterCards.some(
      (item) =>
        item.year === selectedYear && item.semester === selectedSemester,
    );
    if (!selectedExists) {
      const fallback =
        semesterCards.find((item) => item.year === selectedYear) ||
        semesterCards[0];
      setSelectedYear(fallback.year);
      setSelectedSemester(fallback.semester);
    }
  }, [semesterCards, selectedYear, selectedSemester]);
  async function remove(id) {
    await supabase.from("timetables").delete().eq("id", id);
    load();
  }
  async function removeInvalid() {
    const invalidIds = semesterRows
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
  if (adding || editing)
    return (
      <Register
        session={session}
        existingRows={semesterRows}
        selectedYear={selectedYear}
        selectedSemester={selectedSemester}
        editRow={editing}
        back={() => {
          setAdding(false);
          setEditing(null);
        }}
        saved={() => {
          setAdding(false);
          setEditing(null);
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
          <button
            className="add"
            onClick={() => {
              setEditing(null);
              setAdding(true);
            }}
          >
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
      <section className="card semester-panel">
        <div className="semester-selectors">
          <label>
            연도
            <select
              value={selectedYear}
              onChange={(e) => {
                const year = Number(e.target.value);
                const nextSemester =
                  semesterCards.find((item) => item.year === year)?.semester ||
                  selectedSemester;
                changeTerm(year, nextSemester);
              }}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}년
                </option>
              ))}
            </select>
          </label>
          <label>
            학기
            <select
              value={selectedSemester}
              onChange={(e) => changeTerm(selectedYear, e.target.value)}
            >
              {semesterSelectOptions.map((semester) => (
                <option key={semester.semester} value={semester.semester}>
                  {semesterLabel(semester.semester)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="semester-summary">
          <b>
            {selectedYear}년 {semesterLabel(selectedSemester)} · {summary.count}
            과목 · 주 {summary.hours}시간
          </b>
          <span>
            수업 요일 {summary.weekdays}일 · 가장 이른 수업 {summary.earliest} ·
            가장 늦은 수업 {summary.latest}
          </span>
        </div>
        {!!semesterCards.length && (
          <div className="semester-cards">
            {semesterCards.map((item) => (
              <button
                type="button"
                key={makeSemesterId(item.year, item.semester)}
                className={
                  item.year === selectedYear && item.semester === selectedSemester
                    ? "active"
                    : ""
                }
                onClick={() => changeTerm(item.year, item.semester)}
              >
                {item.year}년 {semesterLabel(item.semester)} · {item.count}과목
              </button>
            ))}
          </div>
        )}
      </section>
      {error && <div className="error">{error}</div>}
      {semesterRows.some((row) => !isUsefulCourse(row)) && (
        <div className="cleanup-notice">
          <span>과목명이 없는 잘못된 OCR 데이터가 있습니다.</span>
          <button onClick={removeInvalid}>
            <Trash2 />
            잘못된 항목 정리
          </button>
        </div>
      )}
      <WeeklyBoard
        rows={semesterRows}
        selectedYear={selectedYear}
        selectedSemester={selectedSemester}
      />
      <section className="card">
        <div className="card-title">
          <div>
            <span>
              <CalendarDays />
            </span>
            <h2>주간 시간표</h2>
          </div>
          <small>{semesterRows.length}개 수업</small>
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
              {semesterRows.filter(isUsefulCourse).map((r) => (
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
                      className="secondary table-action"
                      onClick={() => setEditing(r)}
                    >
                      수정
                    </button>
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
          {!semesterRows.length && (
            <div className="empty">
              <b>선택한 연도와 학기에 등록된 시간표가 없습니다.</b>
              <p>직접 입력하거나 에브리타임 캡처로 등록해보세요.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
*/
const ACTIVE_TIMETABLE_KEY = "kmu-active-timetable-id";

function Dashboard({ session }) {
  const [profile, setProfile] = useState(),
    [timetables, setTimetables] = useState([]),
    [rows, setRows] = useState([]),
    [selectedTimetableId, setSelectedTimetableId] = useState(() => {
      const saved = Number(readLocalState(ACTIVE_TIMETABLE_KEY, null));
      return Number.isFinite(saved) && saved > 0 ? saved : null;
    }),
    [selectedTimetableReady, setSelectedTimetableReady] = useState(false),
    [creatingTimetable, setCreatingTimetable] = useState(false),
    [editingTimetable, setEditingTimetable] = useState(null),
    [isTimetableListOpen, setIsTimetableListOpen] = useState(false),
    [deleteTarget, setDeleteTarget] = useState(null),
    [isDeleting, setIsDeleting] = useState(false),
    [adding, setAdding] = useState(false),
    [editing, setEditing] = useState(null),
    [error, setError] = useState("");
  const sortedTimetables = sortTimetables(timetables);
  const selectedTimetable =
    sortedTimetables.find((item) => item.id === selectedTimetableId) ||
    sortedTimetables[0] ||
    null;
  const timetableRows = selectedTimetable
    ? rows.filter((row) => row.timetable_id === selectedTimetable.id)
    : [];
  const summary = summarizeRows(timetableRows);
  const resetModes = () => {
    setAdding(false);
    setEditing(null);
    setCreatingTimetable(false);
    setEditingTimetable(null);
    setIsTimetableListOpen(false);
  };
  const closeDeleteModal = () => {
    if (isDeleting) return;
    setDeleteTarget(null);
  };

  async function load() {
    setError("");
    const [p, c, t] = await Promise.all([
      supabase.from("profiles").select("*").single(),
      supabase
        .from("timetable_collections")
        .select("*")
        .order("year", { ascending: false })
        .order("updated_at", { ascending: false }),
      supabase
        .from("timetables")
        .select("*")
        .order("weekday")
        .order("start_time"),
    ]);
    p.error ? setError(p.error.message) : setProfile(p.data);
    c.error ? setError(c.error.message) : setTimetables(c.data || []);
    t.error ? setError(t.error.message) : setRows(t.data || []);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    let active = true;
    loadUserState(ACTIVE_TIMETABLE_KEY, null).then((value) => {
      if (!active) return;
      const saved = Number(value);
      if (Number.isFinite(saved) && saved > 0) setSelectedTimetableId(saved);
      setSelectedTimetableReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!sortedTimetables.length) {
      setSelectedTimetableId(null);
      if (selectedTimetableReady) removeUserState(ACTIVE_TIMETABLE_KEY);
      return;
    }
    if (
      selectedTimetableId !== null &&
      sortedTimetables.some((item) => item.id === selectedTimetableId)
    )
      return;
    setSelectedTimetableId(sortedTimetables[0].id);
  }, [sortedTimetables, selectedTimetableId, selectedTimetableReady]);

  useEffect(() => {
    if (selectedTimetableReady && selectedTimetable?.id) {
      saveUserState(ACTIVE_TIMETABLE_KEY, selectedTimetable.id);
    }
  }, [selectedTimetable?.id, selectedTimetableReady]);

  async function createTimetable({ year, semester, title, titleCustom }) {
    const { data, error: insertError } = await supabase
      .from("timetable_collections")
      .insert({
        user_id: session.user.id,
        year,
        semester,
        title,
        title_custom: titleCustom,
      })
      .select("*")
      .single();
    if (insertError) {
      setError(insertError.message);
      return;
    }
    resetModes();
    await load();
    setSelectedTimetableId(data.id);
  }

  async function updateTimetableSettings({
    year,
    semester,
    title,
    titleCustom,
    timetableId,
  }) {
    const { error: updateError } = await supabase
      .from("timetable_collections")
      .update({
        year,
        semester,
        title,
        title_custom: titleCustom,
        updated_at: new Date().toISOString(),
      })
      .eq("id", timetableId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    resetModes();
    await load();
    setSelectedTimetableId(timetableId);
  }

  async function removeCourse(id) {
    if (!window.confirm("이 수업을 삭제할까요?")) return;
    const { error: deleteError } = await supabase
      .from("timetables")
      .delete()
      .eq("id", id);
    if (deleteError) setError(deleteError.message);
    else load();
  }

  async function removeTimetable(timetable) {
    const { error: deleteError } = await supabase
      .from("timetable_collections")
      .delete()
      .eq("id", timetable.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    if (selectedTimetableId === timetable.id) setSelectedTimetableId(null);
    resetModes();
    await load();
  }

  async function confirmDeleteTimetable() {
    if (!deleteTarget || isDeleting) return;
    try {
      setIsDeleting(true);
      await removeTimetable(deleteTarget);
      setDeleteTarget(null);
      setIsTimetableListOpen(false);
    } finally {
      setIsDeleting(false);
    }
  }

  async function removeInvalid() {
    const invalidIds = timetableRows
      .filter((row) => !isUsefulCourse(row))
      .map((row) => row.id);
    if (!invalidIds.length) return;
    if (!window.confirm("선택한 잘못된 OCR 수업을 삭제할까요?")) return;
    const { error: deleteError } = await supabase
      .from("timetables")
      .delete()
      .in("id", invalidIds);
    if (deleteError) setError(deleteError.message);
    else load();
  }

  if (creatingTimetable)
    return (
      <div className="content">
        <TimetableForm
          title="새 시간표 만들기"
          submitLabel="시간표 만들기"
          existingTimetables={sortedTimetables}
          onCancel={() => setCreatingTimetable(false)}
          onSubmit={createTimetable}
        />
      </div>
    );

  if (editingTimetable)
    return (
      <div className="content">
        <TimetableForm
          title="시간표 설정"
          submitLabel="저장"
          existingTimetables={sortedTimetables.filter(
            (item) => item.id !== editingTimetable.id,
          )}
          initialYear={editingTimetable.year ?? getCurrentYear()}
          initialSemester={editingTimetable.semester ?? DEFAULT_SEMESTER}
          initialTitle={editingTimetable.title || ""}
          onCancel={() => setEditingTimetable(null)}
          onSubmit={(values) =>
            updateTimetableSettings({
              ...values,
              timetableId: editingTimetable.id,
            })
          }
        />
      </div>
    );

  if (adding || editing)
    return (
      <Register
        session={session}
        existingRows={timetableRows}
        selectedTimetable={selectedTimetable}
        editRow={editing}
        back={() => {
          setAdding(false);
          setEditing(null);
        }}
        saved={() => {
          setAdding(false);
          setEditing(null);
          load();
        }}
      />
    );

  if (!selectedTimetable)
    return (
      <div className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow">KMU SMART SCHEDULER</span>
            <h1>{profile ? `${profile.name}님의 시간표` : "내 시간표"}</h1>
          </div>
          <div className="top-actions">
            <button className="add" onClick={() => setCreatingTimetable(true)}>
              <Plus />
              새 시간표 만들기
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
        <section className="card timetable-empty">
          <div className="empty">
            <b>아직 만든 시간표가 없습니다.</b>
            <p>연도와 학기를 선택해 첫 시간표를 만들어보세요.</p>
            <button className="primary" onClick={() => setCreatingTimetable(true)}>
              시간표 만들기
            </button>
          </div>
        </section>
      </div>
    );

  return (
    <div className="content">
      <header className="topbar">
        <div>
          <span className="eyebrow">KMU SMART SCHEDULER</span>
          <h1>{profile ? `${profile.name}님의 시간표` : "내 시간표"}</h1>
        </div>
        <div className="top-actions">
          <button
            className="add"
            onClick={() => {
              setEditing(null);
              setAdding(true);
            }}
          >
            <Plus />
            수업 등록
          </button>
          <button
            className="secondary"
            onClick={() => {
              setEditing(null);
              setAdding(false);
              setCreatingTimetable(true);
            }}
          >
            새 시간표
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
      <section className="card timetable-manager">
        <div className="timetable-manager-head">
          <div>
            <h2>{selectedTimetable.title}</h2>
            <p>
              {selectedTimetable.year}년 {getSemesterLabel(selectedTimetable.semester)}
            </p>
          </div>
          <div className="timetable-manager-actions">
            <button
              type="button"
              className="secondary timetable-list-toggle"
              aria-expanded={isTimetableListOpen}
              aria-controls="timetable-list-panel"
              onClick={() => setIsTimetableListOpen((prev) => !prev)}
            >
              <span className="timetable-toggle-label">
                {isTimetableListOpen ? "목록 닫기" : "목록"}
              </span>
              설정
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`${selectedTimetable.title} 삭제`}
              onClick={() => setDeleteTarget(selectedTimetable)}
            >
              <Trash2 />
            </button>
          </div>
        </div>
        <div className="semester-summary">
          <b>
            {selectedTimetable.year}년 {getSemesterLabel(selectedTimetable.semester)} ·{" "}
            {summary.count}과목 · 주 {summary.hours}시간
          </b>
          <span>
            수업 요일 {summary.weekdays}일 · 가장 이른 수업 {summary.earliest} · 가장
            늦은 수업 {summary.latest}
          </span>
        </div>
        <div className="timetable-current">
          <article className="timetable-item active">
            <strong>{selectedTimetable.title}</strong>
            <span>
              {selectedTimetable.year}년 {getSemesterLabel(selectedTimetable.semester)}
            </span>
            <small>{courseCountLabel(timetableRows.filter(isUsefulCourse).length)}</small>
          </article>
        </div>
        {isTimetableListOpen && (
          <div id="timetable-list-panel" className="timetable-list-panel">
            <div className="timetable-list-head">
              <b>시간표 목록</b>
              <small>{sortedTimetables.length}개</small>
            </div>
            <div className="timetable-list">
              {sortedTimetables.map((item) => {
                const count = rows.filter(
                  (row) => row.timetable_id === item.id && isUsefulCourse(row),
                ).length;
                const isSelected = item.id === selectedTimetable.id;
                return (
                  <button
                    type="button"
                    key={`panel-${item.id}`}
                    className={isSelected ? "timetable-item active" : "timetable-item"}
                    onClick={() => {
                      resetModes();
                      setSelectedTimetableId(item.id);
                      setIsTimetableListOpen(false);
                    }}
                  >
                    <strong>{item.title}</strong>
                    <span>
                      {item.year}년 {getSemesterLabel(item.semester)}
                    </span>
                    <small>{courseCountLabel(count)}</small>
                    {isSelected && <i className="timetable-selected-badge">선택됨</i>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {false && isTimetableListOpen && (
        <div id="timetable-list-panel" className="timetable-list-panel">
          <div className="timetable-list-head">
            <b>시간표 목록</b>
            <small>{sortedTimetables.length}개</small>
          </div>
          <div className="timetable-list">
          {sortedTimetables.map((item) => {
            const count = rows.filter(
              (row) => row.timetable_id === item.id && isUsefulCourse(row),
            ).length;
            return (
              <button
                type="button"
                key={item.id}
                className={
                  item.id === selectedTimetable.id
                    ? "timetable-item active"
                    : "timetable-item"
                }
                onClick={() => {
                  resetModes();
                  setSelectedTimetableId(item.id);
                  setIsTimetableListOpen(false);
                }}
              >
                <strong>{item.title}</strong>
                <span>
                  {item.year}년 {getSemesterLabel(item.semester)}
                </span>
                <small>{courseCountLabel(count)}</small>
              </button>
            );
          })}
          </div>
        </div>
        )}
      </section>
      {timetableRows.some((row) => !isUsefulCourse(row)) && (
        <div className="cleanup-notice">
          <span>과목명이 없는 잘못된 OCR 데이터가 있습니다.</span>
          <button onClick={removeInvalid}>
            <Trash2 />
            잘못된 항목 정리
          </button>
        </div>
      )}
      <WeeklyBoard
        rows={timetableRows}
        selectedYear={selectedTimetable.year}
        selectedSemester={selectedTimetable.semester}
      />
      <section className="card">
        <div className="card-title">
          <div>
            <span>
              <CalendarDays />
            </span>
            <h2>주간 시간표</h2>
          </div>
          <small>{timetableRows.length}개 수업</small>
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
              {timetableRows.filter(isUsefulCourse).map((r) => (
                <tr key={r.id}>
                  <td>{days[r.weekday]}요일</td>
                  <td>
                    {r.start_time.slice(0, 5)}~{r.end_time.slice(0, 5)}
                  </td>
                  <td>
                    <b>{r.subject}</b>
                  </td>
                  <td>{r.professor || "-"}</td>
                  <td>{r.classroom || "-"}</td>
                  <td>
                    <button
                      className="secondary table-action"
                      onClick={() => setEditing(r)}
                    >
                      수정
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => removeCourse(r.id)}
                    >
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!timetableRows.length && (
            <div className="empty">
              <b>선택한 시간표에 등록된 수업이 없습니다.</b>
              <p>직접 입력하거나 이미지 캡처로 수업을 등록해보세요.</p>
            </div>
          )}
        </div>
      </section>
      {deleteTarget && (
        <div className="modal-backdrop">
          <section
            className="modal timetable-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="timetable-delete-title"
            aria-describedby="timetable-delete-description"
          >
            <header>
              <div>
                <small>삭제 확인</small>
                <h2 id="timetable-delete-title">시간표 삭제</h2>
              </div>
            </header>
            <p id="timetable-delete-description">
              <b>{deleteTarget.title}</b>를 삭제할까요?
            </p>
            <p>
              등록된 수업{" "}
              {
                rows.filter(
                  (row) =>
                    row.timetable_id === deleteTarget.id && isUsefulCourse(row),
                ).length
              }
              개도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="timetable-delete-actions">
              <button
                type="button"
                className="secondary"
                disabled={isDeleting}
                onClick={closeDeleteModal}
              >
                취소
              </button>
              <button
                type="button"
                className="primary danger"
                disabled={isDeleting}
                onClick={confirmDeleteTimetable}
              >
                {isDeleting ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </section>
        </div>
      )}
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
