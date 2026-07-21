drop policy if exists "Public can read worker contacts" on public.worker_contacts;

create policy "Public can read worker contacts"
  on public.worker_contacts for select
  to anon, authenticated
  using (true);

grant select on table public.worker_contacts to anon, authenticated;
