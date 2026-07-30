/**
 * src/tools.ts
 * ---------------------------------------------------------------
 * Tools used by the 5-agent AI-news pipeline.
 *
 *   1. Google Search        - find news articles
 *   2. Firecrawl            - scrape markdown + extract images
 *   3. Embedding            - create embeddings (Deduplicator)
 *   4. Supabase Vector      - cosine search with TTL window
 *   5. Supabase Articles    - persist final JSON rows
 *
 * Every tool ships as a small object with { name, schema, invoke }.
 * Stubs return placeholder data so the pipeline runs end-to-end
 * even before production keys are wired up.
 * ---------------------------------------------------------------
 */
import "dotenv/config";
import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------
export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export interface Tool<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  schema: JsonSchema;
  invoke: (args: TArgs) => Promise<TResult>;
}

// ===============================================================
// OpenAI client (re-used across LLM + embedding calls)
// ===============================================================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE,
});

export const DEFAULT_MODEL = process.env.OPENAI_MODEL_NAME || "gpt-4o-mini";
export const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

/**
 * When the API key only allows a chat model (e.g. `ptm-minimax-m3`), the live
 * embedding endpoint returns 403. Set FORCE_STUB_EMBEDDINGS=1 in `.env` to
 * skip the live call entirely and use the deterministic offline stub
 * vectors. Deduplicator will then dedupe on URL/title rather than semantics.
 */
export const FORCE_STUB_EMBEDDINGS =
  process.env.FORCE_STUB_EMBEDDINGS === "1" ||
  process.env.FORCE_STUB_EMBEDDINGS === "true";

// ===============================================================
// 1) GOOGLE SEARCH TOOL
// ===============================================================
export interface GoogleSearchArgs {
  query: string;
  num?: number;
  site?: string;
}

export interface GoogleSearchHit {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: string;
}

export type GoogleSearchResult = GoogleSearchHit[];

export const googleSearchTool: Tool<GoogleSearchArgs, GoogleSearchResult> = {
  name: "google_search",
  description:
    "Search the public web for recent articles matching `query`. " +
    "Returns title, URL, snippet and source for each hit.",
  schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      num: { type: "number", description: "1-10, default 5" },
      site: { type: "string", description: "Optional host filter" },
    },
    required: ["query"],
    additionalProperties: false,
  },

  async invoke({ query, num = 5, site }: GoogleSearchArgs) {
    const key = process.env.GOOGLE_CSE_KEY;
    const cx = process.env.GOOGLE_CSE_ID;

    // Real path - Google Programmable Search JSON API
    if (key && cx) {
      const fullQuery = site ? `${query} site:${site}` : query;
      const endpoint = new URL("https://www.googleapis.com/customsearch/v1");
      endpoint.searchParams.set("q", fullQuery);
      endpoint.searchParams.set("num", String(Math.min(10, Math.max(1, num))));
      endpoint.searchParams.set("key", key);
      endpoint.searchParams.set("cx", cx);

      const res = await fetch(endpoint);
      const data = (await res.json()) as {
        items?: Array<Record<string, unknown>>;
      };
      return (data.items ?? []).map((it) => {
        // Try several metadata fields Google CSE exposes for published date.
        const pagemap = it.pagemap as
          | { metatags?: Array<Record<string, string>> }
          | undefined;
        const meta = pagemap?.metatags?.[0] ?? {};
        const publishedAt =
          meta["article:published_time"] ||
          meta["og:published_time"] ||
          meta["pubdate"] ||
          meta["date"] ||
          undefined;
        return {
          title: (it.title as string) ?? "",
          url: (it.link as string) ?? "",
          snippet: (it.snippet as string) ?? "",
          source: safeHost((it.link as string) ?? ""),
          publishedAt,
        };
      });
    }

    // Stub path - keeps the pipeline runnable without keys
    return [
      {
        title: `[stub] ${query}`,
        url: `https://example.com/?q=${encodeURIComponent(query)}`,
        snippet:
          "Stub result. Set GOOGLE_CSE_KEY + GOOGLE_CSE_ID in .env to enable live search.",
        source: "example.com",
      },
    ];
  },
};

// ===============================================================
// 2) FIRECRAWL TOOL
// ===============================================================
export interface FirecrawlArgs {
  url: string;
  formats?: Array<"markdown" | "html" | "screenshot" | "links">;
}

export interface FirecrawlResult {
  url: string;
  markdown: string;
  imageUrls: string[];
  metadata?: Record<string, unknown>;
}

export const firecrawlTool: Tool<FirecrawlArgs, FirecrawlResult> = {
  name: "firecrawl_scrape",
  description:
    "Scrape the full markdown content of a URL and extract embedded image URLs.",
  schema: {
    type: "object",
    properties: {
      url: { type: "string", format: "uri" },
      formats: {
        type: "array",
        items: {
          type: "string",
          enum: ["markdown", "html", "screenshot", "links"],
        },
      },
    },
    required: ["url"],
    additionalProperties: false,
  },

  async invoke({ url, formats = ["markdown"] }: FirecrawlArgs) {
    const apiKey = process.env.FIRECRAWL_API_KEY;

    // Real path - Firecrawl /scrape endpoint
    if (apiKey) {
      const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url, formats }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        data?: { markdown?: string; metadata?: Record<string, unknown> };
      };
      const markdown = data.data?.markdown ?? "";
      const imageUrls = extractImagesFromMarkdown(markdown);
      return { url, markdown, imageUrls, metadata: data.data?.metadata };
    }

    // Stub path
    return {
      url,
      markdown: `# [stub] Scraped ${url}\n\nNo real content - wire up FIRECRAWL_API_KEY.`,
      imageUrls: [],
      metadata: { stub: true },
    };
  },
};

/** Helper: pull <img>/markdown image references out of markdown text. */
export function extractImagesFromMarkdown(md: string): string[] {
  const urls = new Set<string>();
  const re = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
  for (const m of md.matchAll(re)) urls.add(m[1]);
  return Array.from(urls);
}

// ===============================================================
// 3) EMBEDDING TOOL
// ===============================================================
export interface EmbeddingArgs {
  texts: string[];
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
}

export const embeddingTool: Tool<EmbeddingArgs, EmbeddingResult> = {
  name: "create_embeddings",
  description:
    "Create one embedding vector per input text using OpenAI's embedding model.",
  schema: {
    type: "object",
    properties: {
      texts: { type: "array", items: { type: "string" } },
    },
    required: ["texts"],
    additionalProperties: false,
  },

  async invoke({ texts }: EmbeddingArgs): Promise<EmbeddingResult> {
    if (texts.length === 0) return { vectors: [], model: EMBEDDING_MODEL };
    if (FORCE_STUB_EMBEDDINGS) {
      return {
        vectors: texts.map((t, i) => stubVector(t, i)),
        model: "stub",
      };
    }
    if (!process.env.OPENAI_API_KEY) {
      // Deterministic stub vectors so cosine math still works locally
      return {
        vectors: texts.map((t, i) => stubVector(t, i)),
        model: "stub",
      };
    }

    try {
      const res = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
      });
      return {
        vectors: res.data.map((d) => d.embedding),
        model: EMBEDDING_MODEL,
      };
    } catch (err) {
      console.warn("[embeddingTool] Live embedding call failed. Falling back to offline stub vectors.", err);
      return {
        vectors: texts.map((t, i) => stubVector(t, i)),
        model: "stub",
      };
    }
  },
};

/** Deterministic stub embedding (length 1536) for offline runs. */
function stubVector(text: string, seed: number): number[] {
  const v = new Array<number>(1536).fill(0);
  let h = (seed + 1) * 2654435761;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 1597334677);
    v[h % 1536] += 1;
  }
  // L2 normalize
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

// ===============================================================
// 4) SUPABASE VECTOR TOOL  (Deduplicator)
// ===============================================================
export interface VectorCacheArgs {
  rows: Array<{
    url: string;
    embedding: number[];
    contentText: string;
    source?: string;
  }>;
}

export interface VectorCacheResult {
  inserted: number;
}

export interface VectorSearchArgs {
  embedding: number[];
  threshold?: number;
  daysBack?: number;
  maxResults?: number;
}

export interface VectorSearchHit {
  url: string;
  similarity: number;
  contentText: string;
  source?: string;
}

export const supabaseVectorTool = {
  name: "supabase_vector",
  description:
    "Persist article embeddings and run cosine-similarity search within a TTL window.",

  /** Upsert embeddings so we never query against the same URL twice. */
  async cacheEmbeddings({ rows }: VectorCacheArgs): Promise<VectorCacheResult> {
    if (rows.length === 0) return { inserted: 0 };
    const sb = getClient();
    const payload = rows.map((r) => ({
      url: r.url,
      embedding: r.embedding,
      content_text: r.contentText,
      source: r.source ?? null,
    }));
    const { error, count } = await sb
      .from("article_vectors")
      .upsert(payload, { onConflict: "url", count: "exact" });
    if (error) throw new Error(`vector cache upsert failed: ${error.message}`);
    return { inserted: count ?? rows.length };
  },

  /** Cosine-similarity search via the find_similar_articles() RPC. */
  async findSimilar({
    embedding,
    threshold,
    daysBack,
    maxResults,
  }: VectorSearchArgs): Promise<VectorSearchHit[]> {
    const t = threshold ?? Number(process.env.DEDUP_SIMILARITY_THRESHOLD ?? 0.85);
    const d = daysBack ?? Number(process.env.DEDUP_CACHE_DAYS ?? 2);
    const m = maxResults ?? 50;
    const sb = getClient();
    const { data, error } = await sb.rpc("find_similar_articles", {
      query_embedding: embedding,
      threshold: t,
      days_back: d,
      max_results: m,
    });
    if (error) throw new Error(`vector search failed: ${error.message}`);
    return (data ?? []).map((r: Record<string, unknown>) => ({
      url: r.url as string,
      similarity: Number(r.similarity),
      contentText: r.content_text as string,
      source: (r.source as string | null) ?? undefined,
    }));
  },
};

// ===============================================================
// 5) SUPABASE ARTICLES TOOL  (QA + Editor)
// ===============================================================
export interface SupabaseArticleRow {
  title_en: string;
  title_th: string;
  summary_en: string;
  summary_th: string;
  /** Detailed bullet summary for the web modal (en). */
  body_en: string;
  /** Detailed bullet summary for the web modal (th). */
  body_th: string;
  category: string;
  original_url: string;
  image_url: string | null;
  source?: string | null;
  published_date: string;
  raw_content?: string | null;
}

export interface SupabaseInsertArgs {
  rows: SupabaseArticleRow[];
}

export interface SupabaseInsertResult {
  inserted: number;
  errors: Array<{ url: string; message: string }>;
}

export const supabaseArticleTool = {
  name: "supabase_articles",
  description:
    "Insert final, Editor-formatted JSON rows into the `articles` table.",

  async insertArticles({ rows }: SupabaseInsertArgs): Promise<SupabaseInsertResult> {
    if (rows.length === 0) return { inserted: 0, errors: [] };
    const sb = getClient();
    const { data, error } = await sb
      .from("articles")
      .insert(rows)
      .select("original_url");
    if (error) {
      return {
        inserted: 0,
        errors: rows.map((r) => ({ url: r.original_url, message: error.message })),
      };
    }
    const inserted = data?.length ?? 0;
    const insertedUrls = new Set((data ?? []).map((r) => r.original_url as string));
    const errors = rows
      .filter((r) => !insertedUrls.has(r.original_url))
      .map((r) => ({ url: r.original_url, message: "row not echoed by PostgREST" }));
    return { inserted, errors };
  },

  async deleteOlderArticles(daysToKeep = 3): Promise<{ deleted: number; error?: string }> {
    const sb = getClient();
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - daysToKeep);
    const isoThreshold = threshold.toISOString();

    const { data, error } = await sb
      .from("articles")
      .delete()
      .lt("inserted_at", isoThreshold)
      .select("id");

    if (error) {
      return { deleted: 0, error: error.message };
    }
    return { deleted: data?.length ?? 0 };
  },
};

// ===============================================================
// Internal helpers
// ===============================================================
let _client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing. Set them in .env."
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

// ===============================================================
// Convenience re-export
// ===============================================================
export const tools = {
  googleSearch: googleSearchTool,
  firecrawl: firecrawlTool,
  embedding: embeddingTool,
  supabaseVector: supabaseVectorTool,
  supabaseArticle: supabaseArticleTool,
};
