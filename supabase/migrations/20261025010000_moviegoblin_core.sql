-- MovieGoblin core schema: isolated catalog and daily puzzle schedule.
-- This migration does not modify or reference any existing VIDYASETU tables.

create table if not exists public.moviegoblin_movies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  normalized_title text not null,
  aliases text[] not null default '{}',
  year smallint not null check (year between 1888 and 2100),
  genres text[] not null default '{}',
  plot text not null check (char_length(plot) > 10),
  clues jsonb not null default '[]'::jsonb,
  embedding float4[] not null check (cardinality(embedding) = 384),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure fast lookups and unique canonical titles
create unique index if not exists moviegoblin_movies_normalized_title_idx
  on public.moviegoblin_movies (normalized_title);

-- Partial index for active catalog entries
create index if not exists moviegoblin_movies_active_idx
  on public.moviegoblin_movies (is_active)
  where is_active = true;

-- GIN index for alternate title / alias array searches
create index if not exists moviegoblin_movies_aliases_idx
  on public.moviegoblin_movies using gin (aliases);

-- Daily puzzle schedule: maps calendar date to selected movie
create table if not exists public.moviegoblin_daily (
  puzzle_date date primary key,
  movie_id uuid not null references public.moviegoblin_movies(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists moviegoblin_daily_movie_id_idx
  on public.moviegoblin_daily (movie_id);

-- Update timestamp trigger
drop trigger if exists moviegoblin_movies_set_updated_at on public.moviegoblin_movies;
create trigger moviegoblin_movies_set_updated_at
  before update on public.moviegoblin_movies
  for each row execute function private.set_row_updated_at();

-- ─── Security: Strict RLS & Role Lockdown ──────────────────────────────────────
-- Enable Row Level Security on both tables.
alter table public.moviegoblin_movies enable row level security;
alter table public.moviegoblin_daily enable row level security;

-- Explicitly revoke all privileges from public/anon and authenticated users.
-- With zero granting policies and revoked privileges, PostgREST direct client queries
-- are denied by default.
revoke all on table public.moviegoblin_movies from public, anon, authenticated;
revoke all on table public.moviegoblin_daily from public, anon, authenticated;

-- Grant full access solely to service_role (used by the backend server).
grant all on table public.moviegoblin_movies to service_role;
grant all on table public.moviegoblin_daily to service_role;
