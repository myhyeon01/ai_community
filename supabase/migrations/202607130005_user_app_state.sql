create table if not exists public.user_app_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  state_key text not null,
  state_value jsonb not null default 'null'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, state_key),
  constraint user_app_state_key_not_blank check (length(trim(state_key)) > 0)
);

create index if not exists user_app_state_user_updated_idx
  on public.user_app_state(user_id, updated_at desc);

alter table public.user_app_state enable row level security;

drop policy if exists "user_app_state_select_own" on public.user_app_state;
create policy "user_app_state_select_own" on public.user_app_state
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "user_app_state_insert_own" on public.user_app_state;
create policy "user_app_state_insert_own" on public.user_app_state
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "user_app_state_update_own" on public.user_app_state;
create policy "user_app_state_update_own" on public.user_app_state
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_app_state_delete_own" on public.user_app_state;
create policy "user_app_state_delete_own" on public.user_app_state
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_app_state to authenticated;
