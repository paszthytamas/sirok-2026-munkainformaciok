create table if not exists public.worker_contacts (
  worker_id text primary key,
  name text not null,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_display text not null,
  note text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.worker_contacts enable row level security;

revoke all on table public.worker_contacts from anon, authenticated;
