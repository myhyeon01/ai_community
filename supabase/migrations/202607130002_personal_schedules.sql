create table if not exists public.personal_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title varchar(120) not null,
  category varchar(30) not null default '기타',
  schedule_date date not null,
  start_time time not null,
  end_time time not null,
  location varchar(150) not null default '',
  memo text not null default '',
  priority varchar(10) not null default 'normal' check (priority in ('high', 'normal', 'low')),
  repeat_type varchar(10) not null default 'none' check (repeat_type in ('none', 'daily', 'weekly', 'monthly')),
  reminder_minutes integer not null default 30 check (reminder_minutes between 0 and 10080),
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_schedule_time_order check (end_time > start_time)
);

create index if not exists personal_schedules_user_date_idx
  on public.personal_schedules(user_id, schedule_date, start_time);

alter table public.personal_schedules enable row level security;

drop policy if exists "personal_schedules_select_own" on public.personal_schedules;
create policy "personal_schedules_select_own" on public.personal_schedules
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "personal_schedules_insert_own" on public.personal_schedules;
create policy "personal_schedules_insert_own" on public.personal_schedules
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "personal_schedules_update_own" on public.personal_schedules;
create policy "personal_schedules_update_own" on public.personal_schedules
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "personal_schedules_delete_own" on public.personal_schedules;
create policy "personal_schedules_delete_own" on public.personal_schedules
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.personal_schedules to authenticated;
