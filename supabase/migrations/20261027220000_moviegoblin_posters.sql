-- Migration: Add poster_url and popularity/rating metrics to moviegoblin_movies
-- Safe, non-destructive, backwards-compatible schema extension

alter table public.moviegoblin_movies
  add column if not exists poster_url text,
  add column if not exists popularity float4,
  add column if not exists vote_count integer,
  add column if not exists vote_average float4;

comment on column public.moviegoblin_movies.poster_url is 'TMDB poster image URL';
comment on column public.moviegoblin_movies.popularity is 'TMDB popularity score';
comment on column public.moviegoblin_movies.vote_count is 'TMDB total vote count';
comment on column public.moviegoblin_movies.vote_average is 'TMDB vote average rating (0-10)';
