create table if not exists public.shift_leaders (
  shift_id text primary key,
  worker_id text not null,
  updated_at timestamptz not null default now()
);

alter table public.shift_leaders enable row level security;

drop policy if exists "Public can read shift leaders" on public.shift_leaders;
create policy "Public can read shift leaders"
  on public.shift_leaders for select
  to anon, authenticated
  using (true);

revoke all on table public.shift_leaders from anon, authenticated;
grant select on table public.shift_leaders to anon, authenticated;

