/**
 * src/agents.ts
 * ---------------------------------------------------------------
 * Five sequential agents that compose the AI-news pipeline:
 *
 *   1. Researcher    - Pull article links from 4 fixed sources via
 *                      Firecrawl, then scrape each article and apply
 *                      a 24h freshness gate BEFORE the Analyst.
 *                      Drops hits older than 24h (or with no parseable
 *                      publishedAt) to keep the digest current.
 *   2. Deduplicator  - drops URLs already in Supabase (vector similarity)
 *   3. Analyst       - emits a strict JSON array (en/th titles + summaries
 *                      + detailed body bullets for the web modal)
 *   4. Editor        - polishes Thai copy and trims to messaging-app limits
 *   5. QA            - schema-validates the JSON and writes it to Supabase
 *
 * Each agent exposes:
 *   - name:         string
 *   - systemPrompt: string   (instruction body the agent runs under)
 *   - run(input):   Promise<output>
 *
 * The agents are deliberately framework-agnostic: the LLM call is
 * isolated in `chatCompletion()`. Swap that helper for an OpenClaw
 * SDK call (`openclaw.invoke(...)`) without touching the agents.
 * ---------------------------------------------------------------
 */
import OpenAI from "openai";
import {
  firecrawlTool,
  embeddingTool,
  supabaseVectorTool,
  supabaseArticleTool,
  extractImagesFromMarkdown,
  type SupabaseArticleRow,
} from "./tools.js";

// ---------------------------------------------------------------
// Shared pipeline types + defaults
// ---------------------------------------------------------------

/**
 * The 4 priority topics the pipeline filters against.
 * Order matters: first topic whose query produces a hit wins (first-match-wins).
 */
export const DEFAULT_TOPICS = ["MCP", "Agent", "Memory", "Research"] as const;
export type TopicName = (typeof DEFAULT_TOPICS)[number];

/**
 * Pipeline operating defaults. Tuned for the daily 4-source digest.
 *
 *   TARGET_ARTICLES_PER_DAY   = 20   soft target logged in summary
 *   MAX_SCRAPE_BUDGET         = 40   hard cap on Firecrawl calls per run
 *
 * With 4 source pages + ~9 article scrapes per source = ~40 Firecrawl
 * calls, which after dedup + freshness gate typically yields 5-20
 * articles in the digest.
 */
export const TARGET_ARTICLES_PER_DAY = 20;
export const MAX_SCRAPE_BUDGET = 40;

// ---------------------------------------------------------------
// NEWS SOURCES - the 4 fixed pages we scrape each day
// ---------------------------------------------------------------

/**
 * A raw hit pulled from one of the news source pages.
 *
 * `publishedAt` may be missing - in that case the Researcher applies a
 * "trusted today" exemption for sources whose listing IS the digest
 * (HF papers date page, The Rundown, paperswithcode trending).
 */
export interface RawHit {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt?: string;
  /** Topic this hit was discovered under (first-match-wins). */
  category: string;
}

export interface ScrapedArticle extends RawHit {
  markdown: string;
  imageUrls: string[];
}

export interface DedupedArticle extends ScrapedArticle {}

export interface FinalArticle extends SupabaseArticleRow {}

/**
 * News source definition.
 *
 *   urlFor(now) -> the canonical page to scrape today (some sources
 *                   are date-dependent like HF papers, others are fixed).
 *   extractLinks(markdown) -> pull candidate article URLs from the
 *                              listing page markdown.
 *   category   -> the pipeline topic every article from this source
 *                 inherits (first-match-wins is still enforced by URL dedup).
 *   maxLinks   -> soft cap on articles pulled from this source per run.
 */
export interface NewsSource {
  id: string;
  label: string;
  category: string;
  /** Soft cap on articles pulled from this source per run. */
  maxLinks: number;
  /** Returns the URL to scrape for `now`. */
  urlFor: (now: Date) => string;
  /**
   * Pulls candidate article URLs out of the listing-page markdown.
   * Returns array of { url, title, snippet, publishedAt? }.
   */
  extractLinks: (markdown: string, sourceHost: string) => Array<{
    url: string;
    title: string;
    snippet: string;
    publishedAt?: string;
  }>;
}

/** ISO date YYYY-MM-DD for any Date (UTC). */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Extract a date-like string from any text (looks for YYYY-MM-DD or '5h ago'). */
function fuzzyDate(text: string): string | undefined {
  if (!text) return undefined;
  const iso = text.match(/\b(20\d\d-\d\d-\d\d)\b/);
  if (iso) return iso[1];
  const rel = text.match(/\b(\d+)\s*(h|hr|hour|min|m|day|d)s?\s*ago\b/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const ms =
      unit.startsWith("h") ? n * 3600_000 :
      unit.startsWith("m") ? n * 60_000 :
      n * 86_400_000;
    return new Date(Date.now() - ms).toISOString();
  }
  return undefined;
}

/** Take everything after the first '/' that looks like a real path (filters nav/category links). */
function isArticlePath(path: string): boolean {
  if (!path || path === "/" || path.length < 2) return false;
  // Reject obvious listing/category/index pages.
  if (/(^|\/)(category|tag|author|page|search|login|signup|about)(\/|$)/i.test(path)) return false;
  return true;
}

/** Pull the first markdown link out of a bullet line: - [title](url). */
function extractBullets(md: string, _host: string): Array<{url: string; title: string; snippet: string; publishedAt?: string}> {
  const out: Array<{url: string; title: string; snippet: string; publishedAt?: string}> = [];
  const seen = new Set<string>();
  const re = /^\s*[-*]\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*(.*)$/gm;
  for (const m of md.matchAll(re)) {
    const title = m[1].trim();
    const url = m[2].trim();
    const tail = (m[3] ?? "").trim();
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title,
      snippet: tail,
      publishedAt: fuzzyDate(`${title} ${tail}`),
    });
  }
  return out;
}

/** Pull bare markdown links that look like articles: [title](url) anywhere. */
function extractAllLinks(md: string, host: string): Array<{url: string; title: string; snippet: string; publishedAt?: string}> {
  // Strip image markdown first so they don't break the bracket matching regex
  const cleanMd = md.replace(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g, "");
  const out: Array<{url: string; title: string; snippet: string; publishedAt?: string}> = [];
  const seen = new Set<string>();
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  for (const m of cleanMd.matchAll(re)) {
    const title = m[1].trim();
    const url = m[2].trim();
    if (!title || !url || seen.has(url)) continue;
    // Keep only links to the same host (article URLs live there).
    try {
      const u = new URL(url);
      if (u.hostname !== host && !u.hostname.endsWith(`.${host}`)) continue;
      if (!isArticlePath(u.pathname)) continue;
    } catch {
      continue;
    }
    seen.add(url);
    out.push({ url, title, snippet: "", publishedAt: fuzzyDate(title) });
  }
  return out;
}

/** Source: Hugging Face daily papers (date-based URL). */
const hfPapers: NewsSource = {
  id: "hf-papers",
  label: "Hugging Face Papers (today)",
  category: "Research",
  maxLinks: 15,
  urlFor: (now) => `https://huggingface.co/papers/date/${isoDate(now)}`,
  extractLinks: (md, host) => {
    // HF papers page links are like [Title](https://huggingface.co/papers/2507.12345)
    return extractAllLinks(md, host).filter((l) => /\/papers\/\d/.test(l.url));
  },
};

/** Source: Hugging Face blog (recent posts). */
const hfBlog: NewsSource = {
  id: "hf-blog",
  label: "Hugging Face Blog",
  category: "Memory",
  maxLinks: 8,
  urlFor: () => "https://huggingface.co/blog",
  extractLinks: (md, host) => {
    return extractAllLinks(md, host).filter((l) => /\/blog\/[^/?#]+/.test(l.url));
  },
};

/** Source: The Rundown AI (newsletter front page). */
const theRundown: NewsSource = {
  id: "the-rundown",
  label: "The Rundown AI",
  category: "Agent",
  maxLinks: 10,
  urlFor: () => "https://www.therundown.ai/",
  extractLinks: (md, host) => {
    // Prefer bullet links (article list), fall back to all same-host links.
    const bullets = extractBullets(md, host);
    if (bullets.length > 0) return bullets;
    return extractAllLinks(md, host);
  },
};

/** Source: Papers with Code trending. */
const papersWithCode: NewsSource = {
  id: "papers-with-code",
  label: "Papers with Code (trending)",
  category: "Research",
  maxLinks: 10,
  urlFor: () => "https://paperswithcode.co/",
  extractLinks: (md, host) => {
    // Trending page lists papers as links to /papers/...
    return extractAllLinks(md, host).filter((l) => /\/papers?\//.test(l.url));
  },
};

/** The 4 fixed news sources the pipeline scrapes each day. */
export const NEWS_SOURCES: ReadonlyArray<NewsSource> = [
  hfPapers,
  hfBlog,
  theRundown,
  papersWithCode,
];

// ---------------------------------------------------------------
// Generic Agent interface
// ---------------------------------------------------------------
export interface Agent<I, O> {
  name: string;
  systemPrompt: string;
  run: (input: I) => Promise<O>;
}

// ---------------------------------------------------------------
// LLM helper (replace body with `openclaw.invoke(...)` if desired)
// ---------------------------------------------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE,
});

const DEFAULT_MODEL = process.env.OPENAI_MODEL_NAME || "gpt-4o-mini";

function cleanJsonString(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  }
  return cleaned.trim();
}

/**
 * Robustly extract the first balanced JSON object/array from an LLM reply.
 * Strips code fences, then locates the first `[` or `{` and walks the string
 * tracking quote/escape state so we return a balanced slice even when the
 * model prefixes the reply with prose like "Let me analyze..." or suffixes
 * it with an explanation. Returns the trimmed original if no bracket is found.
 */
function extractJsonPayload(str: string): string {
  const stripped = cleanJsonString(str);
  const first = stripped.search(/[\[{]/);
  if (first < 0) return stripped;
  const open = stripped[first];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = first; i < stripped.length; i++) {
    const c = stripped[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) return stripped.slice(first, i + 1);
    }
  }
  // No balanced close found — return from first bracket to end as best effort.
  return stripped.slice(first);
}

async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
  opts: { jsonMode?: boolean; temperature?: number } = {}
): Promise<string> {
  const isGpt = DEFAULT_MODEL.startsWith("gpt-");
  const res = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: opts.temperature ?? 0.2,
    response_format: (opts.jsonMode && isGpt) ? { type: "json_object" } : undefined,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  
  let text = res.choices[0]?.message?.content ?? "";
  if (!text) {
    const reason = (res.choices[0]?.message as any).reasoning_content;
    if (reason) text = reason;
  }
  
  if (!text) throw new Error("LLM returned empty content");
  
  if (opts.jsonMode && !isGpt) {
    text = extractJsonPayload(text);
  }
  return text;
}

// ===============================================================
// AGENT 1 - RESEARCHER
// ===============================================================

/** Outcome returned by Researcher: scraped articles + diagnostics. */
export interface ResearcherResult {
  scraped: ScrapedArticle[];
  droppedStale: Array<{ url: string; title: string; publishedAt?: string; ageHours: number | null; reason: "no-date" | "too-old" }>;
  /** How many candidate links each source produced before dedup/freshness. */
  sourceCounts: Record<string, number>;
}

export const researcherAgent: Agent<
  {
    /** Ignored - categories now come from NEWS_SOURCES. Kept for backward compat. */
    topics?: string[];
    /** Override the 4 default news sources (testing only). */
    sources?: ReadonlyArray<NewsSource>;
    maxAgeHours?: number;
    now?: Date;
    /** Soft target for how many articles to publish per day. Used for
     *  logging and to cap raw search volume. Default: TARGET_ARTICLES_PER_DAY. */
    targetArticles?: number;
    /** Hard cap on Firecrawl calls per run to control cost. Default: MAX_SCRAPE_BUDGET. */
    scrapeBudget?: number;
  },
  ResearcherResult
> = {
  name: "Researcher",
  systemPrompt: `
You are the Researcher agent in a multi-agent AI-news pipeline.

Your job is to discover fresh, high-quality articles from a fixed set
of news source pages and return their full textual content so downstream
agents can summarise them.

You have one tool at your disposal:
  - firecrawl_scrape(url) -> { markdown, imageUrls, metadata }

Operating procedure:
  1. For each source page in NEWS_SOURCES, firecrawl_scrape the URL.
  2. Extract candidate article links from the listing-page markdown
     using the source's extractLinks function.
  3. Deduplicate by URL across all sources, preserving the FIRST
     source that produced the hit (first-match-wins). The source's
     category becomes the article's 'category' field.
  4. FRESHNESS GATE - drop BEFORE scraping articles:
     a. If publishedAt is missing or unparseable, drop the hit
        ("no-date"). We never guess publication time.
     b. If publishedAt is older than maxAgeHours (default 24h), drop
        the hit ("too-old").
     c. Keep only hits that pass both checks.
  5. Call firecrawl_scrape on each SURVIVING article URL to fetch the
     full markdown body and embedded image URLs.
  6. Drop hits that produced no usable markdown.

Return the researcher result object with scraped articles, droppedStale
diagnostics, and per-source candidate counts.
`.trim(),

  async run({
    sources = NEWS_SOURCES,
    maxAgeHours = 24,
    now = new Date(),
    targetArticles: _targetArticles = TARGET_ARTICLES_PER_DAY,
    scrapeBudget = MAX_SCRAPE_BUDGET,
  }) {
    // 1) Scrape each source's listing page (in parallel).
    const sourceMarkdown = await Promise.all(
      sources.map(async (src) => {
        const url = src.urlFor(now);
        try {
          const { markdown } = await firecrawlTool.invoke({
            url,
            formats: ["markdown"],
          });
          return { src, url, markdown, ok: true as const };
        } catch (err) {
          console.warn(`[Researcher] source scrape failed: ${url}`, err);
          return { src, url, markdown: "", ok: false as const };
        }
      })
    );

    // 2) Extract candidate article links from each source's markdown.
    const seen = new Map<string, RawHit>();
    const sourceCounts: Record<string, number> = {};
    for (const { src, url, markdown, ok } of sourceMarkdown) {
      let host = "";
      try { host = new URL(url).hostname; } catch {}
      const candidates = ok ? src.extractLinks(markdown, host) : [];
      const capped = candidates.slice(0, src.maxLinks);
      sourceCounts[src.id] = capped.length;
      console.log(
        `[Researcher] ${src.id}: url=${url} ok=${ok} mdLen=${markdown.length} candidates=${capped.length}`
      );
      // First-match-wins across sources (sources array is priority order).
      for (const c of capped) {
        if (!c.url || seen.has(c.url)) continue;
        let publishedAt = c.publishedAt;
        // Trusted today exemption for sources whose listing IS the daily digest
        if (!publishedAt && ["hf-papers", "the-rundown", "papers-with-code"].includes(src.id)) {
          publishedAt = now.toISOString();
        }
        seen.set(c.url, {
          title: c.title,
          url: c.url,
          snippet: c.snippet,
          source: host,
          publishedAt,
          category: src.category,
        });
      }
    }

    // 3) FRESHNESS GATE - drop BEFORE scraping to save Firecrawl calls.
    const cutoffMs = now.getTime() - maxAgeHours * 60 * 60 * 1000;
    const survivors = new Map<string, RawHit>();
    const droppedStale: ResearcherResult["droppedStale"] = [];
    for (const [url, hit] of seen) {
      const ts = parsePublishedAt(hit.publishedAt);
      if (ts === null) {
        droppedStale.push({
          url,
          title: hit.title,
          publishedAt: hit.publishedAt,
          ageHours: null,
          reason: "no-date",
        });
        continue;
      }
      const ageHours = (now.getTime() - ts) / (60 * 60 * 1000);
      if (ts < cutoffMs) {
        droppedStale.push({
          url,
          title: hit.title,
          publishedAt: hit.publishedAt,
          ageHours: Math.round(ageHours * 10) / 10,
          reason: "too-old",
        });
        continue;
      }
      survivors.set(url, hit);
    }

    // 4) Cap survivors to scrapeBudget before paying Firecrawl.
    const survivorEntries = Array.from(survivors.entries()).slice(0, scrapeBudget);
    const scrapeCandidates = new Map(survivorEntries);
    const surplusStale: ResearcherResult["droppedStale"] = Array.from(
      survivors.entries()
    )
      .slice(scrapeBudget)
      .map(([url, hit]) => ({
        url,
        title: hit.title,
        publishedAt: hit.publishedAt,
        ageHours: null,
        reason: "no-date", // re-purpose: budget overflow (UI doesn't need to render)
      }));

    // 5) Scrape each surviving article (in parallel, capped at scrapeBudget).
    const scraped: ScrapedArticle[] = await Promise.all(
      Array.from(scrapeCandidates.values()).map(async (hit) => {
        try {
          const { markdown, imageUrls, metadata } = await firecrawlTool.invoke({
            url: hit.url,
            formats: ["markdown"],
          });
          // Some listings don't expose a date - try to recover one from
          // article metadata so we don't keep dropping valid articles.
          const recovered =
            (metadata as Record<string, unknown> | undefined)?.publishedTime as
              | string
              | undefined;
          const publishedAt =
            hit.publishedAt ??
            (typeof recovered === "string" ? recovered : undefined);
          return {
            ...hit,
            publishedAt,
            markdown,
            imageUrls: imageUrls?.length
              ? imageUrls
              : extractImagesFromMarkdown(markdown),
          };
        } catch (err) {
          console.warn(`[Researcher] scrape failed: ${hit.url}`, err);
          return { ...hit, markdown: "", imageUrls: [] };
        }
      })
    );

    // 6) Drop hits that produced no usable markdown.
    return {
      scraped: scraped.filter((a) => a.markdown.length > 0),
      droppedStale: [...droppedStale, ...surplusStale],
      sourceCounts,
    };
  },
};

/**
 * Parse an article's publishedAt into a Unix-ms timestamp.
 * Returns null if the value is missing or unparseable.
 * Accepts ISO-8601, RFC-2822, and YYYY-MM-DD shapes.
 */
function parsePublishedAt(value: string | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

// ===============================================================
// AGENT 2 - DEDUPLICATOR  (vector-similarity, TTL window)
// ===============================================================
export const deduplicatorAgent: Agent<
  { articles: ScrapedArticle[]; similarityThreshold?: number; daysBack?: number },
  DedupedArticle[]
> = {
  name: "Deduplicator",
  systemPrompt: `
You are the Deduplicator agent.

You protect the pipeline from re-processing articles that have already
been seen recently. You use semantic similarity (embeddings) so that
rewrites / syndicated copies are caught as well as exact URL matches.

Steps:
  1. Embed a short text snippet for each incoming article.
  2. For each embedding, call supabase_vector.find_similar() against
     the TTL window (default 2 days, threshold default 0.85).
  3. An article is a DUPLICATE if any hit returns similarity >= threshold.
  4. Return only the FRESH (non-duplicate) articles, preserving order.
  5. Cache every kept article's embedding in supabase_vector.cache()
     so future runs can recognise them too.
`.trim(),

  async run({
    articles,
    similarityThreshold,
    daysBack,
  }) {
    if (articles.length === 0) return [];

    // 1) Embed a compact text per article (title + first 1k chars).
    const texts = articles.map(
      (a) => `${a.title}\n\n${a.markdown.slice(0, 1000)}`
    );
    const { vectors } = await embeddingTool.invoke({ texts });

    // 2) Search for near-duplicates in parallel.
    const dupSets = await Promise.all(
      vectors.map((v) =>
        supabaseVectorTool
          .findSimilar({
            embedding: v,
            threshold: similarityThreshold,
            daysBack,
            maxResults: 1,
          })
          .then((hits) => new Set(hits.map((h) => h.url)))
      )
    );

    // 3) Keep only articles whose own URL is NOT flagged as duplicate.
    const fresh: DedupedArticle[] = [];
    const cacheRows: Array<{
      url: string;
      embedding: number[];
      contentText: string;
      source?: string;
    }> = [];
    articles.forEach((a, i) => {
      const dupes = dupSets[i];
      if (dupes.size > 0) {
        console.log(
          `[Deduplicator] drop (duplicate of ${[...dupes].join(", ")}): ${a.url}`
        );
        return;
      }
      fresh.push(a);
      cacheRows.push({
        url: a.url,
        embedding: vectors[i],
        contentText: texts[i],
        source: a.source,
      });
    });

    // 4) Cache embeddings of kept articles so the next run sees them.
    if (cacheRows.length > 0) {
      try {
        await supabaseVectorTool.cacheEmbeddings({ rows: cacheRows });
      } catch (err) {
        console.warn("[Deduplicator] cacheEmbeddings failed:", err);
      }
    }

    return fresh;
  },
};

// ===============================================================
// AGENT 3 - ANALYST
// ===============================================================
export const analystAgent: Agent<
  { articles: DedupedArticle[]; topics?: string[] },
  FinalArticle[]
> = {
  name: "Analyst",
  systemPrompt: `
You are the Analyst agent in an AI-news pipeline.

Given a JSON array of articles (each with markdown content), produce
a STRICT JSON array (no markdown fences, no commentary) with one
object per article using EXACTLY these keys:

  {
    "title_en":        string  - original English title,
    "title_th":        string  - Thai translation of the title,
    "summary_en":      string  - 2-3 sentence English summary (<= 60 words),
    "summary_th":      string  - 2-3 sentence Thai summary (<= 60 words),
    "body_en":         string  - DETAILED English summary, 3-5 bullet points
                                  covering the full content. Each bullet on
                                  its own line starting with "- ". Total
                                  80-160 words. The reader should understand
                                  the article WITHOUT clicking through.
    "body_th":         string  - DETAILED Thai summary, same structure as body_en.
                                  Each bullet starts with "- ". Natural Thai,
                                  not literal translation.
    "category":        string  - COPY VERBATIM from the input article's category,
    "original_url":    string  - URL from the input,
    "image_url":       string  - best image URL or "" if none,
    "published_date":  string  - ISO-8601 date (YYYY-MM-DD) if known
  }

Rules:
  - Output a single top-level JSON array. NO prose, NO markdown fences.
  - The 'category' field MUST be copied verbatim from the input - do
    NOT re-classify or invent a new category.
  - If an article lacks a usable date, set published_date to "".
  - If no image is available, set image_url to "" (not null).
  - Keep summaries (summary_en/summary_th) under 60 words each.
  - body_en / body_th should give the reader a real understanding of:
      * WHO is involved (company / research team / author)
      * WHAT was done / discovered / announced
      * WHY it matters (impact, novelty)
      * HOW it works (method / architecture, when relevant)
      * KEY results / numbers / benchmarks, when available
  - Do not invent facts. If the source does not mention a detail,
    omit that bullet rather than guess.
  - Translation must be natural Thai, not literal word-for-word.
`.trim(),

  async run({ articles }) {
    if (articles.length === 0) return [];

    const userPrompt = `
Articles (JSON):
${JSON.stringify(
  articles.map((a) => ({
    title: a.title,
    url: a.url,
    snippet: a.snippet,
    source: a.source,
    publishedAt: a.publishedAt,
    category: a.category,
    imageUrls: a.imageUrls,
    markdown: a.markdown.slice(0, 8000), // bound token cost
  })),
  null,
  2
)}

Return ONLY the strict JSON array described in your system prompt.
`.trim();

    const raw = await chatCompletion(this.systemPrompt, userPrompt, {
      jsonMode: true,
      temperature: 0.3,
    });

    // The model may wrap the array in { articles: [...] } even when
    // asked for a top-level array; handle both shapes defensively.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(
        `[Analyst] LLM reply failed JSON.parse (${(err as Error).message}). ` +
          `First 500 chars: ${raw.slice(0, 500)}`
      );
      return [];
    }

    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { articles?: unknown }).articles)
      ? (parsed as { articles: unknown[] }).articles
      : null;

    if (!arr) {
      console.warn(
        "[Analyst] LLM reply parsed but was not a JSON array. First 500 chars: " +
          raw.slice(0, 500)
      );
      return [];
    }
    return arr as FinalArticle[];
  },
};

// ===============================================================
// AGENT 4 - EDITOR  (Thai polish + length trimming)
// ===============================================================

/** Default caps - tuned for Telegram / X / LINE mobile readability. */
const DEFAULT_TITLE_MAX_CHARS = 110;
const DEFAULT_SUMMARY_MAX_CHARS = 320;
const DEFAULT_SUMMARY_MAX_WORDS = 60;
/** Detailed-body cap - shown in the web modal, so longer is fine. */
const DEFAULT_BODY_MAX_CHARS = 1200;
const DEFAULT_BODY_MAX_WORDS = 200;

/** Style guide the Editor enforces on Thai copy. */
const THAI_POLISH_RULES = [
  "Use natural conversational Thai, not literal word-for-word translation.",
  "Avoid English filler (e.g. 'the', 'is', 'a') inside Thai titles.",
  "Prefer short Thai words over Sino-Thai compounds when both work.",
  "Do not invent facts, numbers, or quoted text not present in the input.",
  "Preserve technical proper nouns in English (e.g. MCP, Claude, OpenAI).",
];

export const editorAgent: Agent<
  { articles: FinalArticle[] },
  { edited: FinalArticle[]; changes: Array<{ url: string; reason: string }> }
> = {
  name: "Editor",
  systemPrompt: `
You are the Editor agent.

You sit between the Analyst and the QA gate. Your job is to polish
the Thai copy and trim length so the final rows fit messaging-app
readability constraints while keeping the detailed body readable
in the web modal.

For every article in the input array you must:

  1. POLISH Thai
     Rewrite title_th, summary_th and body_th so they read naturally.
     Apply this style guide:
${THAI_POLISH_RULES.map((r) => `       - ${r}`).join("\n")}

  2. TRIM length
     - title_th   MUST be <= ${DEFAULT_TITLE_MAX_CHARS} characters.
     - summary_th MUST be <= ${DEFAULT_SUMMARY_MAX_CHARS} characters
       AND <= ${DEFAULT_SUMMARY_MAX_WORDS} words.
     - body_th    MUST be <= ${DEFAULT_BODY_MAX_CHARS} characters
       AND <= ${DEFAULT_BODY_MAX_WORDS} words (used in the web modal).
     - If trimming, prefer dropping adjectives / examples over facts.
     - Never truncate mid-word in Thai - cut at a clean boundary.

  3. PRESERVE
     - title_en, summary_en, body_en: pass through unchanged.
     - category, original_url, image_url, published_date: pass through unchanged.

Output a STRICT JSON object (no fences) of shape:
  {
    "edited":   [FinalArticle, ...]  // same length and order as input,
    "changes":  [{ "url": string, "reason": string }, ...]
  }
'changes' is for logging - describe what you trimmed / rewrote.
`.trim(),

  async run({ articles }) {
    if (articles.length === 0) return { edited: [], changes: [] };

    const userPrompt = `
Articles (JSON):
${JSON.stringify(
  articles.map((a) => ({
    title_en: a.title_en,
    title_th: a.title_th,
    summary_en: a.summary_en,
    summary_th: a.summary_th,
    body_en: a.body_en,
    body_th: a.body_th,
    category: a.category,
    original_url: a.original_url,
    image_url: a.image_url,
    published_date: a.published_date,
  })),
  null,
  2
)}

Limits to enforce:
  title_th   <= ${DEFAULT_TITLE_MAX_CHARS} chars
  summary_th <= ${DEFAULT_SUMMARY_MAX_CHARS} chars AND <= ${DEFAULT_SUMMARY_MAX_WORDS} words
  body_th    <= ${DEFAULT_BODY_MAX_CHARS} chars AND <= ${DEFAULT_BODY_MAX_WORDS} words

Return ONLY the strict JSON object described in your system prompt.
`.trim();

    const raw = await chatCompletion(this.systemPrompt, userPrompt, {
      jsonMode: true,
      temperature: 0.4,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(
        `[Editor] LLM reply failed JSON.parse (${(err as Error).message}). ` +
          `First 500 chars: ${raw.slice(0, 500)}. Falling back to local trim pass.`
      );
      return localTrimFallback(articles);
    }

    const obj = parsed as { edited?: unknown; changes?: unknown };
    if (!obj || !Array.isArray(obj.edited)) {
      console.warn(
        "[Editor] LLM reply did not include { edited: [...] }. " +
          "First 500 chars: " +
          raw.slice(0, 500) +
          ". Falling back to local trim pass."
      );
      return localTrimFallback(articles);
    }

    // Hard-enforce the length limits locally even if the LLM slipped -
    // never trust the model to be the only line of defence.
    const edited = (obj.edited as FinalArticle[]).map((row, i) => {
      const original = articles[i];
      const title_th = hardTrim(row.title_th, DEFAULT_TITLE_MAX_CHARS);
      const summary_th = hardTrimSummary(
        row.summary_th,
        DEFAULT_SUMMARY_MAX_CHARS,
        DEFAULT_SUMMARY_MAX_WORDS
      );
      // body_th may be missing if Analyst didn't produce it; fall back
      // gracefully so we still insert the row.
      const body_th = row.body_th
        ? hardTrimSummary(row.body_th, DEFAULT_BODY_MAX_CHARS, DEFAULT_BODY_MAX_WORDS)
        : original.body_th ?? "";
      const body_en = row.body_en ?? original.body_en ?? "";
      return {
        title_en: row.title_en ?? original.title_en,
        title_th,
        summary_en: row.summary_en ?? original.summary_en,
        summary_th,
        body_en,
        body_th,
        category: row.category ?? original.category,
        original_url: row.original_url ?? original.original_url,
        image_url: row.image_url ?? original.image_url,
        source: row.source ?? original.source ?? null,
        published_date: row.published_date ?? original.published_date,
        raw_content: row.raw_content ?? original.raw_content ?? null,
      } as FinalArticle;
    });

    const changes = Array.isArray(obj.changes)
      ? (obj.changes as Array<{ url: string; reason: string }>)
      : [];

    return { edited, changes };
  },
};

/**
 * Local-only fallback used when the Editor LLM returns unparseable JSON.
 * Re-applies the same hardTrim rules to each article so the pipeline still
 * produces schema-valid rows instead of throwing and aborting the run.
 */
function localTrimFallback(
  articles: FinalArticle[]
): { edited: FinalArticle[]; changes: Array<{ url: string; reason: string }> } {
  const edited = articles.map((row) => ({
    title_en: row.title_en,
    title_th: hardTrim(row.title_th, DEFAULT_TITLE_MAX_CHARS),
    summary_en: row.summary_en,
    summary_th: hardTrimSummary(
      row.summary_th,
      DEFAULT_SUMMARY_MAX_CHARS,
      DEFAULT_SUMMARY_MAX_WORDS
    ),
    body_en: row.body_en ?? "",
    body_th: hardTrimSummary(
      row.body_th ?? "",
      DEFAULT_BODY_MAX_CHARS,
      DEFAULT_BODY_MAX_WORDS
    ),
    category: row.category,
    original_url: row.original_url,
    image_url: row.image_url ?? null,
    source: row.source ?? null,
    published_date: row.published_date,
    raw_content: row.raw_content ?? null,
  }));
  const changes = articles.map((a) => ({
    url: a.original_url,
    reason: "Editor fallback: LLM reply unusable; applied local hardTrim only.",
  }));
  return { edited, changes };
}

/** Trim a string to <= max chars at a clean Thai boundary if possible. */
function hardTrim(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  const ELLIPSIS = "\u2026";
  // Reserve room for the ellipsis so the final length never exceeds `max`.
  const roomForEllipsis = max - ELLIPSIS.length;
  if (roomForEllipsis < 1) return text.slice(0, max);
  const slice = text.slice(0, roomForEllipsis);
  // Try to back off to the nearest whitespace or Thai sentence break.
  const cut = slice.search(/[ \n\t\u200b\u3002\u3001\.\!\?,;:]/);
  if (cut > max * 0.6) return slice.slice(0, cut).trimEnd() + ELLIPSIS;
  return slice.trimEnd() + ELLIPSIS;
}

/** Trim a summary by both char and word cap; prefer word-level cut. */
function hardTrimSummary(text: string, maxChars: number, maxWords: number): string {
  if (!text) return "";
  let out = text;
  const words = out.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    out = words.slice(0, maxWords).join(" ") + "\u2026";
  }
  if (out.length > maxChars) {
    out = hardTrim(out, maxChars);
  }
  return out;
}

/** Exported for unit testing only. */
export const __test__ = { hardTrim, hardTrimSummary, extractJsonPayload };

// ===============================================================
// AGENT 5 - QA
// ===============================================================
export interface QARunResult {
  inserted: number;
  rejected: Array<{ index: number; reason: string; row?: unknown }>;
}

const REQUIRED_KEYS: Array<keyof FinalArticle> = [
  "title_en",
  "title_th",
  "summary_en",
  "summary_th",
  "category",
  "original_url",
  "image_url",
  "published_date",
];

function validateArticle(row: unknown, _index: number): {
  ok: boolean;
  reason?: string;
  clean?: FinalArticle;
} {
  if (typeof row !== "object" || row === null) {
    return { ok: false, reason: "row is not an object" };
  }
  const obj = row as Record<string, unknown>;

  for (const key of REQUIRED_KEYS) {
    if (!(key in obj)) {
      return { ok: false, reason: `missing field "${key}"` };
    }
  }

  if (typeof obj.original_url !== "string" || !/^https?:\/\//.test(obj.original_url)) {
    return { ok: false, reason: "original_url is not a valid http(s) URL" };
  }
  for (const k of ["title_en", "title_th", "summary_en", "summary_th"] as const) {
    if (typeof obj[k] !== "string" || obj[k].trim().length === 0) {
      return { ok: false, reason: `${k} must be a non-empty string` };
    }
  }
  if (typeof obj.category !== "string" || obj.category.trim().length === 0) {
    return { ok: false, reason: "category must be a non-empty string" };
  }
  if (obj.image_url !== "" && obj.image_url !== null && typeof obj.image_url !== "string") {
    return { ok: false, reason: "image_url must be string, null, or empty string" };
  }
  if (
    obj.published_date !== "" &&
    obj.published_date !== null &&
    (typeof obj.published_date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}/.test(obj.published_date as string))
  ) {
    return { ok: false, reason: "published_date must be YYYY-MM-DD or empty" };
  }

  const clean: FinalArticle = {
    title_en: (obj.title_en as string).trim(),
    title_th: (obj.title_th as string).trim(),
    summary_en: (obj.summary_en as string).trim(),
    summary_th: (obj.summary_th as string).trim(),
    // Detailed body is OPTIONAL. The Analyst always tries to emit it,
    // but if a particular row slips through with empty bullets we
    // gracefully fall back to "" rather than rejecting the whole row.
    body_en: typeof obj.body_en === "string" ? obj.body_en.trim() : "",
    body_th: typeof obj.body_th === "string" ? obj.body_th.trim() : "",
    category: (obj.category as string).trim(),
    original_url: obj.original_url as string,
    image_url: (obj.image_url as string | null) || null,
    source: (obj.source as string | null) ?? null,
    published_date: (obj.published_date as string) || "",
    raw_content: (obj.raw_content as string | null) ?? null,
  };
  return { ok: true, clean };
}

export const qaAgent: Agent<
  { articles: FinalArticle[] },
  QARunResult
> = {
  name: "QA",
  systemPrompt: `
You are the QA agent and the last gate before data lands in Supabase.

Your responsibilities:
  1. Validate every object from the Analyst against this strict schema:
       title_en, title_th, summary_en, summary_th  - non-empty strings
       original_url                                - http(s) URL
       image_url                                   - string or null
       published_date                              - YYYY-MM-DD or ""
  2. Reject rows that fail validation and report WHY.
  3. Hand the surviving rows to supabase.insert_articles() and
     return a summary { inserted, rejected }.

Never write rows that violate the schema.
`.trim(),

  async run({ articles }) {
    const rejected: QARunResult["rejected"] = [];
    const valid: FinalArticle[] = [];

    articles.forEach((row, i) => {
      const v = validateArticle(row, i);
      if (v.ok && v.clean) valid.push(v.clean);
      else rejected.push({ index: i, reason: v.reason ?? "unknown", row });
    });

    if (valid.length === 0) {
      return { inserted: 0, rejected };
    }

    const { inserted, errors } = await supabaseArticleTool.insertArticles({
      rows: valid,
    });

    // Map DB errors back to QA rejections for visibility.
    for (const err of errors) {
      const idx = valid.findIndex((r) => r.original_url === err.url);
      rejected.push({
        index: idx >= 0 ? idx : -1,
        reason: `db: ${err.message}`,
        row: idx >= 0 ? valid[idx] : undefined,
      });
    }

    return { inserted, rejected };
  },
};

// ===============================================================
// Convenience: pipeline bundle
// ===============================================================
export const agents = {
  researcher: researcherAgent,
  deduplicator: deduplicatorAgent,
  analyst: analystAgent,
  editor: editorAgent,
  qa: qaAgent,
};
