-- WhoIsTheBest: a snake game with a shared team leaderboard.
-- Scores are written only by the server (service role) after a plausibility
-- check; players never write or read the table directly.

create table if not exists nordcall.snake_scores (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references nordcall.teams(id) on delete cascade,
  user_id uuid not null references nordcall.profiles(id) on delete cascade,
  score int not null check (score between 0 and 100000),
  duration_ms int not null check (duration_ms between 0 and 86400000),
  created_at timestamptz not null default now()
);
create index if not exists snake_scores_team_score_idx on nordcall.snake_scores (team_id, created_at desc, score desc);
create index if not exists snake_scores_user_idx on nordcall.snake_scores (user_id, created_at desc);

alter table nordcall.snake_scores enable row level security;
revoke all on nordcall.snake_scores from anon, authenticated;
grant all on nordcall.snake_scores to service_role;

notify pgrst, 'reload schema';
