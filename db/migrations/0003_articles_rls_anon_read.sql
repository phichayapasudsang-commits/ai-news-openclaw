-- db/migrations/0003_articles_rls_anon_read.sql
-- ---------------------------------------------------------------
-- Allow anonymous (anon) reads on `articles` so the web SPA can
-- load the feed without exposing the service_role key to browsers.
-- Writes (insert/update/delete) remain service_role-only; that's
-- enforced by simply not granting these policies.
-- ---------------------------------------------------------------

alter table articles enable row level security;

drop policy if exists "anon read articles" on articles;
create policy "anon read articles"
  on articles
  for select
  to anon
  using (true);
