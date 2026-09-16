create table if not exists public.voiceqa_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.voiceqa_owners enable row level security;
revoke all on table public.voiceqa_owners from anon, authenticated;
