-- MyFundedBook backend. Paste into Supabase > SQL Editor > Run. Safe to re-run.

-- 1. One table holds everything: trades, notes, playbooks, meta (settings/profile).
create table if not exists public.journal (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  col        text not null check (col in ('trades','notes','playbooks','meta')),
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, col, id)
);
create index if not exists journal_user_col_idx on public.journal (user_id, col);

-- 2. Row Level Security: each user can only touch their own rows.
alter table public.journal enable row level security;
drop policy if exists "journal_select_own" on public.journal;
drop policy if exists "journal_insert_own" on public.journal;
drop policy if exists "journal_update_own" on public.journal;
drop policy if exists "journal_delete_own" on public.journal;
create policy "journal_select_own" on public.journal for select to authenticated using (user_id = auth.uid());
create policy "journal_insert_own" on public.journal for insert to authenticated with check (user_id = auth.uid());
create policy "journal_update_own" on public.journal for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "journal_delete_own" on public.journal for delete to authenticated using (user_id = auth.uid());

-- The app's "Connect your database" check queries the table before sign-in, so allow
-- anon to run a select (RLS still returns zero rows).
grant select on public.journal to anon;
grant select, insert, update, delete on public.journal to authenticated;

-- 3. Live sync across devices.
do $$ begin
  alter publication supabase_realtime add table public.journal;
exception when duplicate_object then null; end $$;

-- 4. Private screenshot bucket "shots"; files live under <user_id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shots', 'shots', false, 10485760, array['image/webp','image/jpeg','image/png','image/gif'])
on conflict (id) do nothing;

drop policy if exists "shots_select_own" on storage.objects;
drop policy if exists "shots_insert_own" on storage.objects;
drop policy if exists "shots_update_own" on storage.objects;
drop policy if exists "shots_delete_own" on storage.objects;
create policy "shots_select_own" on storage.objects for select to authenticated using (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "shots_insert_own" on storage.objects for insert to authenticated with check (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "shots_update_own" on storage.objects for update to authenticated using (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "shots_delete_own" on storage.objects for delete to authenticated using (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text);
