-- supabase/schema.sql
-- ---------------------------------------------------------------
-- Schema for the 5-agent AI-news pipeline.
--
-- Tables:
--   articles         - final published articles (en/th + category)
--   article_vectors  - embeddings for dedup, with 2-day TTL window
--
-- RPC:
--   find_similar_articles()  - vector cosine search with TTL filter
-- ---------------------------------------------------------------

create extension if not exists vector;

-- ===============================================================
-- ARTICLES (final rows produced by the Editor agent)
-- ===============================================================
create table if not exists articles (
  id              bigserial primary key,
  title_en        text        not null,
  title_th        text        not null,
  summary_en      text        not null,
  summary_th      text        not null,
  category        text,
  original_url    text        unique not null,
  image_url       text,
  source          text,
  published_date  date,
  raw_content     text,        -- kept for QA traceability
  inserted_at     timestamptz default now()
);

create index if not exists articles_inserted_at_idx
  on articles (inserted_at desc);

-- ===============================================================
-- ARTICLE_VECTORS (embeddings for the Deduplicator)
-- ===============================================================
create table if not exists article_vectors (
  url          text        primary key,
  embedding    vector(1536) not null,
  content_text text        not null,
  source       text,
  inserted_at  timestamptz default now()
);

create index if not exists article_vectors_inserted_at_idx
  on article_vectors (inserted_at desc);

-- IVFFlat index for cosine distance. lists=100 is fine up to ~1M rows.
create index if not exists article_vectors_embedding_idx
  on article_vectors using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ===============================================================
-- RPC: similarity search with TTL window (default 2 days)
-- ===============================================================
create or replace function find_similar_articles(
  query_embedding vector(1536),
  threshold       float   default 0.85,
  days_back       int     default 2,
  max_results     int     default 50
)
returns table (
  url          text,
  similarity   float,
  content_text text,
  source       text
)
language plpgsql
as $$
begin
  return query
    select
      v.url,
      1 - (v.embedding <=> query_embedding) as similarity,
      v.content_text,
      v.source
    from article_vectors v
    where v.inserted_at > now() - (days_back || ' days')::interval
      and 1 - (v.embedding <=> query_embedding) >= threshold
    order by v.embedding <=> query_embedding
    limit max_results;
end;
$$;

-- ===============================================================
-- RPC: cache hygiene - drop vectors older than TTL window
-- Call this on a schedule or before each pipeline run.
-- ===============================================================
create or replace function purge_old_vectors(retention_days int default 7)
returns int
language plpgsql
as $$
declare
  deleted_count int;
begin
  delete from article_vectors
   where inserted_at < now() - (retention_days || ' days')::interval;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
