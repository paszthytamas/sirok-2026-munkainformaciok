create table if not exists public.admin_allowlist (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.worker_credentials (
  worker_id text primary key,
  name text not null,
  password_lookup text not null unique,
  password_salt text not null,
  password_hash text not null,
  password_iterations integer not null check (password_iterations between 100000 and 1000000),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_entries (
  worker_id text not null,
  shift_id text not null,
  adjustment_hours numeric(7,2) not null default 0,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (worker_id, shift_id)
);

create table if not exists public.car_assignments (
  boundary_id text primary key,
  payload jsonb not null default '{"arrivals":{"cars":[]},"departures":{"cars":[]}}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.admin_allowlist enable row level security;
alter table public.worker_credentials enable row level security;
alter table public.app_settings enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.car_assignments enable row level security;

drop policy if exists "Public can read car assignments" on public.car_assignments;
create policy "Public can read car assignments"
  on public.car_assignments for select
  to anon, authenticated
  using (true);

revoke all on table public.admin_allowlist from anon, authenticated;
revoke all on table public.worker_credentials from anon, authenticated;
revoke all on table public.app_settings from anon, authenticated;
revoke all on table public.payroll_entries from anon, authenticated;
revoke insert, update, delete on table public.car_assignments from anon, authenticated;
grant select on table public.car_assignments to anon, authenticated;

insert into public.app_settings (key, value)
values ('hourly_rate', '0'::jsonb)
on conflict (key) do nothing;

