-- db/migrations/0002_add_content_jsonb.sql
-- ---------------------------------------------------------------
-- Add a JSONB column to hold the full structured article payload
-- (title/summary/body in EN+TH + metadata) produced by the daily
-- digest cron job.  The legacy flat columns are kept for backward
-- compatibility with the existing web SPA.
-- ---------------------------------------------------------------

alter table articles
  add column if not exists content jsonb;

create index if not exists articles_content_category_idx
  on articles using gin ((content -> 'category'));

-- Backfill any pre-existing rows so content is never NULL.
update articles
  set content = jsonb_build_object(
    'title_en',       title_en,
    'title_th',       title_th,
    'summary_en',     summary_en,
    'summary_th',     summary_th,
    'body_en',        coalesce(body_en, ''),
    'body_th',        coalesce(body_th, ''),
    'category',       category,
    'original_url',   original_url,
    'image_url',      image_url,
    'source',         source,
    'published_date', published_date::text
  )
  where content is null;
