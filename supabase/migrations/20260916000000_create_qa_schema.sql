create extension if not exists pgcrypto;

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  agent text not null,
  campaign text not null,
  transaction_id text,
  evaluator text,
  recording_path text,
  detected_language text,
  original_transcript text,
  english_transcript text,
  score integer not null check (score between 0 and 200),
  max_score integer not null default 200 check (max_score = 200),
  percentage numeric(5,2) not null check (percentage between 0 and 100),
  status text not null default 'completed' check (status in ('processing','completed','review_required','failed')),
  summary text,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.evaluations enable row level security;
grant select, insert, update, delete on public.evaluations to authenticated;

create policy "Users read own evaluations" on public.evaluations for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users create own evaluations" on public.evaluations for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Users update own evaluations" on public.evaluations for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Users delete own evaluations" on public.evaluations for delete to authenticated using ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('qa-recordings', 'qa-recordings', false, 26214400, array['audio/mpeg','audio/mp4','audio/wav','audio/webm','audio/ogg'])
on conflict (id) do nothing;

create policy "Users upload own recordings" on storage.objects for insert to authenticated
with check (bucket_id = 'qa-recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users read own recordings" on storage.objects for select to authenticated
using (bucket_id = 'qa-recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete own recordings" on storage.objects for delete to authenticated
using (bucket_id = 'qa-recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);
