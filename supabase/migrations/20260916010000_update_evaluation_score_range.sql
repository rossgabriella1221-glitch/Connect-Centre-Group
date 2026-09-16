alter table public.evaluations drop constraint if exists evaluations_score_check;
alter table public.evaluations drop constraint if exists evaluations_max_score_check;
alter table public.evaluations add constraint evaluations_score_check check (score between 0 and 150);
alter table public.evaluations add constraint evaluations_max_score_check check (max_score between 1 and 150);
alter table public.evaluations alter column max_score set default 150;
