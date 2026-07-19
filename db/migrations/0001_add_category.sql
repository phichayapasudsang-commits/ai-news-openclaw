-- =============================================================
-- Migration 0001: add `category`, `body_en`, `body_th` to `articles`
-- =============================================================
--
-- Background:
--   The pipeline now tags every article with one of the four
--   priority topics (MCP, Agent, Memory, Research) via first-match
--   ordering at the Researcher stage, and the Analyst agent emits
--   a detailed bullet-point body (body_en / body_th) for the web
--   modal. The web SPA needs to be able to filter by category and
--   render the detailed body in the article modal.
--
-- This migration is additive and safe to run on a populated table.
-- Legacy rows get category = '' (empty string) and the CHECK
-- constraint explicitly allows that so we don't have to invent a
-- category for old data. body_en / body_th default to '' for legacy
-- rows so the modal can render without errors.
--
-- Apply via:
--   psql "$DATABASE_URL" -f db/migrations/0001_add_category.sql
--
-- Or paste into the Supabase SQL editor (Database -> SQL Editor).
-- =============================================================

begin;

-- 1) Add the category column. DEFAULT '' keeps the migration safe on
--    populated tables (NOT NULL + DEFAULT means existing rows are
--    backfilled automatically without rewriting the table).
alter table articles
  add column if not exists category text not null default '';

-- 2) Add the detailed body columns for the web modal. Empty string
--    is fine for legacy rows; the modal hides them when blank.
alter table articles
  add column if not exists body_en text not null default '';

alter table articles
  add column if not exists body_th text not null default '';

-- 3) Constrain the category values to the 4 pipeline topics. Empty
--    string is allowed for legacy rows; new rows from the pipeline
--    will always be one of the four.
alter table articles
  drop constraint if exists articles_category_check;

alter table articles
  add constraint articles_category_check
  check (category = '' or category in ('MCP', 'Agent', 'Memory', 'Research'));

-- 4) Index for the category filter on the web SPA. B-tree is fine
--    because the column has very low cardinality (5 distinct values).
create index if not exists articles_category_idx
  on articles (category);

-- 5) Update the public SELECT policy note. The existing
--    "anon can read articles" policy already covers the new columns,
--    so no RLS changes are needed.

commit;

-- =============================================================
-- Rollback (do NOT run unless you really mean it):
--
--   alter table articles drop constraint articles_category_check;
--   drop index if exists articles_category_idx;
--   alter table articles drop column body_th;
--   alter table articles drop column body_en;
--   alter table articles drop column category;
-- =============================================================
