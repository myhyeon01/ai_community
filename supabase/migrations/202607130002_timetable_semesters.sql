alter table public.timetables
  add column if not exists year integer not null default 2026,
  add column if not exists semester text not null default '2',
  add column if not exists semester_id text not null default '2026-2',
  add column if not exists input_method text not null default 'manual',
  add column if not exists updated_at timestamptz not null default now();

create index if not exists timetables_user_semester_idx
  on public.timetables(user_id, year, semester, weekday, start_time);
