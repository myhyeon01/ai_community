import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { calculateMakeupSchedules } from "./academic";
import { getAcademicCalendar } from "./academicApi";
import AcademicCalendarView from "./AcademicCalendarView";

function useAcademicData() {
  const [state, setState] = useState({
    schedules: [],
    timetable: [],
    loading: true,
    error: "",
    fetchedAt: "",
  });

  async function load(force = false) {
    setState((value) => ({ ...value, loading: true, error: "" }));
    try {
      const [calendar, timetable] = await Promise.all([
        getAcademicCalendar(force),
        supabase
          .from("timetables")
          .select("*")
          .order("weekday")
          .order("start_time"),
      ]);

      if (timetable.error) {
        console.warn(
          "개인 시간표를 불러오지 못해 학사일정만 표시합니다.",
          timetable.error,
        );
      }

      setState({
        schedules: calendar.schedules || [],
        timetable: timetable.data || [],
        loading: false,
        error: "",
        fetchedAt: calendar.fetched_at || new Date().toISOString(),
      });
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.error("학사일정 요청 실패", error);
      setState((value) => ({
        ...value,
        loading: false,
        error: error?.message || "학사일정을 불러오지 못했습니다.",
      }));
    }
  }

  useEffect(() => {
    load();
  }, []);

  return { ...state, load };
}

export default function AcademicPage() {
  const data = useAcademicData();
  const changes = useMemo(
    () => calculateMakeupSchedules(data.schedules, data.timetable),
    [data.schedules, data.timetable],
  );

  return (
    <AcademicCalendarView
      schedules={data.schedules}
      changes={changes}
      loading={data.loading}
      error={data.error}
      fetchedAt={data.fetchedAt}
      refresh={data.load}
    />
  );
}
