/**
 * src/digest.ts
 * ----------------------------------------------------------------
 * Daily AI news digest — independent of the 5-agent pipeline.
 *
 * Flow (rewritten 2026-07-14):
 *   1. For each of 4 fixed sources, fetch the index page HTML
 *      directly from the host (no DuckDuckGo — that returned wrong
 *      URLs).
 *   2. Parse <a href="...">title</a> tags whose href matches the
 *      source-specific pattern AND points to the same host.
 *   3. Fetch each link's body, summarise with LLM into EN+TH JSON,
 *      POST to Supabase `articles` table.
 *
 * Sources:
 *   - hf-papers       https://huggingface.co/papers/date/YYYY-MM-DD
 *                     links: huggingface.co/papers/<id>
 *   - the-rundown     https://www.therundown.ai/
 *                     links: therundown.ai/<slug>
 *   - papers-w-code   https://paperswithcode.co/
 *                     links: paperswithcode.co/papers/<slug>
 *   - hf-blog         https://huggingface.co/blog
 *                     links: huggingface.co/blog/<slug>
 *
 * Run manually:   npx tsx src/digest.ts
 * Run via cron:   scripts\run-digest.bat
 * ----------------------------------------------------------------
 */
import "dotenv/config";
import OpenAI from "openai";
import { chromium } from "playwright-core";

// ---- config ---------------------------------------------------
const FETCH_TIMEOUT_MS = 12_000;
const MAX_TEXT_CHARS = 12_000;

/** ISO date in `YYYY-MM-DD` (UTC) — used in date-based source URLs. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface SourceConfig {
  id: string;
  category: string;
  label: string;
  maxLinks: number;
  urlFor: (now: Date) => string;
  /** Regex tested against the link's pathname. */
  pathPattern: RegExp;
  /** Hostname the link's URL must match (string equality). */
  host: string;
  /** When true, the index page is loaded via a real Chromium browser
   *  (needed for SPA / Cloudflare-protected sites). */
  useBrowser?: boolean;
  /** Optional selector to wait for before reading the rendered HTML. */
  indexWaitSelector?: string;
  /** When true, individual article pages also go through Chromium.
   *  Useful when the site gates both the index AND article HTML. */
  useBrowserForArticles?: boolean;
}

/** Pathname prefixes that are navigation/utility pages, not articles. */
const NAV_PREFIXES = [
  "/", "/archive", "/subscribe", "/about", "/login", "/signup", "/signin",
  "/pricing", "/contact", "/privacy", "/terms", "/careers", "/jobs",
  "/press", "/partners", "/guides", "/tools", "/categories", "/tags",
  "/search", "/api", "/rss", "/feed", "/sitemap", "/robots.txt",
];

const SOURCES: ReadonlyArray<SourceConfig> = [
  {
    id: "hf-papers",
    category: "Research",
    label: "Hugging Face Papers (today)",
    maxLinks: 8,
    urlFor: (now) => `https://huggingface.co/papers/date/${isoDate(now)}`,
    pathPattern: /^\/papers\/\d/,
    host: "huggingface.co",
  },
  {
    id: "the-rundown",
    category: "Agent",
    label: "The Rundown AI",
    maxLinks: 8,
    urlFor: () => "https://www.therundown.ai/",
    // Accept slugs like /p/<id> or /<slug>
    pathPattern: /^\/(?:p\/[a-z0-9-]+|[a-z][a-z0-9-]+)\/?$/i,
    host: "www.therundown.ai",
    useBrowser: true,
    indexWaitSelector: "a[href]",
  },
  {
    id: "papers-w-code",
    category: "Research",
    label: "Papers with Code (trending)",
    maxLinks: 8,
    urlFor: () => "https://paperswithcode.co/",
    pathPattern: /^\/(?:paper|papers)\/[^/?#]+/i,
    host: "paperswithcode.co",
    useBrowser: true,
    useBrowserForArticles: true,
    indexWaitSelector: "a[href]",
  },
  {
    id: "hf-blog",
    category: "Memory",
    label: "Hugging Face Blog",
    maxLinks: 6,
    urlFor: () => "https://huggingface.co/blog",
    pathPattern: /^\/blog\/[^/?#]+/,
    host: "huggingface.co",
  },
];

// ---- env + OpenAI ---------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!process.env.OPENAI_API_KEY) {
  console.error("[digest] missing OPENAI_API_KEY in .env");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("[digest] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE,
});

// ---- helpers --------------------------------------------------
type RawHit = { url: string; title: string };

/** Strip HTML tags/script/style and collapse whitespace. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull article links out of raw HTML for a given source.
 * Resolves relative URLs against `baseUrl`, keeps only those whose:
 *   - hostname equals `host` (string equality)
 *   - pathname matches `pathPattern`
 *   - pathname is not a known nav/utility route
 * Also requires a non-empty anchor text (so we get a real title).
 */
function htmlExtractLinks(
  html: string,
  baseUrl: string,
  host: string,
  pathPattern: RegExp
): RawHit[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const out: RawHit[] = [];
  // Match <a ... href="...">title</a>; tolerate attributes in any order.
  const re =
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const hrefRaw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    const innerHtml = m[4] ?? "";
    if (!hrefRaw || hrefRaw.startsWith("#") || hrefRaw.startsWith("javascript:"))
      continue;
    // Skip obvious non-article hrefs.
    if (
      hrefRaw.startsWith("mailto:") ||
      hrefRaw.startsWith("tel:") ||
      /\.(png|jpe?g|gif|svg|webp|ico|css|js)(\?|$)/i.test(hrefRaw)
    ) {
      continue;
    }
    let abs: URL;
    try {
      abs = new URL(hrefRaw, base);
    } catch {
      continue;
    }
    if (abs.hostname !== host) continue;
    const path = abs.pathname;
    if (!pathPattern.test(path)) continue;
    // Drop nav / utility routes.
    const normalised = path.replace(/\/+$/, "") || "/";
    if (NAV_PREFIXES.includes(normalised)) continue;
    // Drop query-string-only links.
    if (normalised === "/" || normalised === "") continue;
    // Title from anchor text.
    const title = htmlToText(innerHtml);
    if (!title || title.length < 4) continue;
    const cleanUrl = abs.origin + abs.pathname;
    if (seen.has(cleanUrl)) continue;
    seen.add(cleanUrl);
    out.push({ url: cleanUrl, title });
  }
  return out;
}

/** Load a URL with a real headless Chromium and return the rendered HTML.
 *  Used for SPA / Cloudflare-protected sites where a plain fetch is blocked.
 *  Optional `waitForSelector` blocks until that selector appears in the DOM,
 *  which is the cheap way to wait for client-side rendering to finish. */
async function fetchRendered(
  url: string,
  waitForSelector?: string
): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (waitForSelector) {
      try {
        await page.waitForSelector(waitForSelector, { timeout: 15_000 });
      } catch {
        // best-effort; we'll still return whatever rendered
      }
    }
    // Give SPA a moment to finish lazy-loaded list items.
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    return await page.content();
  } finally {
    await browser.close();
  }
}

/** Fetch a URL and return plain text, capped to MAX_TEXT_CHARS. */
async function fetchPage(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      console.warn(`[digest] fetch ${url} -> HTTP ${res.status}`);
      return "";
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!/text|html|xml/i.test(ct)) return "";
    const raw = await res.text();
    return htmlToText(raw).slice(0, MAX_TEXT_CHARS);
  } catch (err) {
    console.warn(`[digest] fetch ${url} failed:`, (err as Error).message);
    return "";
  } finally {
    clearTimeout(t);
  }
}

interface Article {
  title_en: string;
  title_th: string;
  summary_en: string;
  summary_th: string;
  body_en: string;
  body_th: string;
  category: string;
  original_url: string;
  image_url: string | null;
  source: string;
  published_date: string | null;
}

/** Use LLM to summarise one fetched page into EN+TH JSON. */
async function summarise(
  hit: RawHit,
  category: string,
  text: string
): Promise<Article | null> {
  const system = `
You are an AI news editor. Summarise the article text into bilingual JSON.
Strict schema (no markdown fences, no prose before/after):
{
  "title_en":       "...",
  "title_th":       "...",
  "summary_en":     "1-2 sentence lead (<= 280 chars)",
  "summary_th":     "สรุปสั้น 1-2 ประโยค (<= 280 chars)",
  "body_en":        "3-5 bullet points, each starting with '- '",
  "body_th":        "bullet 3-5 ข้อ แต่ละข้อขึ้นต้นด้วย '- '",
  "category":       "${category}",
  "original_url":   "${hit.url}",
  "image_url":      null,
  "source":         "${new URL(hit.url).hostname}",
  "published_date": null
}
`.trim();

  const user = `URL: ${hit.url}
TITLE: ${hit.title}

TEXT (may be empty if scrape failed):
${text || "(no body extracted)"}

Return ONLY the JSON object.`.trim();

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL_NAME ?? "ptm-minimax-m3",
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) {
      console.warn(`[digest] empty LLM reply for ${hit.url}`);
      return null;
    }
    // Reuse the same balanced-bracket extractor as agents.ts so digest
    // survives LLM replies that are arrays, nested objects, or wrapped in
    // prose. Falls back to lastIndexOf("}") only when no bracket opens.
    let payload = extractJsonPayload(raw);
    if (payload === raw) {
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first < 0 || last <= first) {
        console.warn(
          `[digest] no JSON in LLM reply for ${hit.url} ` +
            `(head: ${raw.slice(0, 120).replace(/\s+/g, " ")})`
        );
        return null;
      }
      payload = raw.slice(first, last + 1);
    }
    let obj: Article;
    try {
      obj = JSON.parse(payload) as Article;
    } catch (err) {
      console.warn(
        `[digest] summarise ${hit.url} JSON.parse failed: ` +
          `${(err as Error).message} (head: ${payload.slice(0, 200).replace(/\s+/g, " ")})`
      );
      return null;
    }
    obj.category = category;
    obj.original_url = hit.url;
    return obj;
  } catch (err) {
    // Outer catch now only fires for non-parse errors (LLM HTTP, network).
    console.warn(`[digest] summarise ${hit.url} failed:`, (err as Error).message);
    return null;
  }
}

// ---- shared JSON extractor ------------------------------------
/** Strip markdown code fences from an LLM reply. */
function cleanJsonString(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  }
  return cleaned.trim();
}

/**
 * Extract the first balanced JSON object/array from a possibly-noisy LLM reply.
 * Walks the string tracking quote/escape state so nested brackets inside
 * strings don't confuse the depth counter. Returns the trimmed input when no
 * bracket is found (caller can fall back to manual slicing).
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
  return stripped.slice(first);
}

/** POST one article to Supabase articles table.
 * Returns:
 *   true          - new row inserted
 *   false         - non-dup error (network, schema, etc.)
 *   "skip-dup"    - row already exists (unique constraint 23505)
 */
async function insertArticle(a: Article): Promise<boolean | "skip-dup"> {
  const flatRow = {
    title_en:       a.title_en,
    title_th:       a.title_th,
    summary_en:     a.summary_en,
    summary_th:     a.summary_th,
    body_en:        a.body_en,
    body_th:        a.body_th,
    category:       a.category,
    original_url:   a.original_url,
    image_url:      a.image_url,
    source:         a.source,
    published_date: a.published_date,
    raw_content:    null,
    content:        a, // JSONB column from migration 0002
  };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/articles`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify([flatRow]),
    });
    if (!res.ok) {
      if (res.status === 409) return "skip-dup" as const; // 23505
      const txt = await res.text();
      console.warn(`[digest] supabase ${res.status}: ${txt.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[digest] supabase POST failed:`, (err as Error).message);
    return false;
  }
}

// ---- main -----------------------------------------------------
async function main() {
  const startedAt = new Date();
  console.log(`[digest] start ${startedAt.toISOString()}`);
  console.log(`[digest] sources: ${SOURCES.map((s) => s.id).join(", ")}`);

  let inserted = 0;
  let skipped = 0;
  let duped = 0;

  for (const src of SOURCES) {
    const indexUrl = src.urlFor(startedAt);
    console.log(
      `\n[digest] source=${src.id}  url=${indexUrl}` +
        (src.useBrowser ? "  (browser-rendered)" : "")
    );

    let html = "";
    try {
      if (src.useBrowser) {
        html = await fetchRendered(indexUrl, src.indexWaitSelector);
      } else {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(indexUrl, {
          redirect: "follow",
          signal: ctrl.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
              "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
        });
        clearTimeout(timer);
        if (!res.ok) {
          console.warn(`[digest] index ${res.status}`);
          continue;
        }
        html = await res.text();
      }
    } catch (err) {
      console.warn(`[digest] index fetch failed:`, (err as Error).message);
      continue;
    }

    const hits = htmlExtractLinks(html, indexUrl, src.host, src.pathPattern)
      .slice(0, src.maxLinks);
    console.log(`[digest]   ${hits.length} candidate links`);

    for (const hit of hits) {
      const rawHtml = src.useBrowserForArticles
        ? await fetchRendered(hit.url)
        : await fetchPage(hit.url);
      const text = htmlToText(rawHtml).slice(0, MAX_TEXT_CHARS);
      console.log(`[digest]   ${hit.url}  textLen=${text.length}`);
      if (!text || text.length < 200) {
        skipped++;
        continue;
      }
      const article = await summarise(hit, src.category, text);
      if (!article) {
        skipped++;
        continue;
      }
      const result = await insertArticle(article);
      if (result === true) {
        console.log(`[digest]   -> INSERTED  ${article.title_en.slice(0, 60)}`);
        inserted++;
      } else if (result === "skip-dup") {
        console.log(`[digest]   -> DUP-SKIP  ${article.title_en.slice(0, 60)}`);
        duped++;
      } else {
        console.log(`[digest]   -> FAILED    ${article.title_en.slice(0, 60)}`);
        skipped++;
      }
    }
  }

  console.log(
    `\n[digest] done  inserted=${inserted}  duped=${duped}  skipped=${skipped}  at=${new Date().toISOString()}`
  );
}

// Only run main() when this file is executed directly. When imported
// (e.g. by smoke-test.ts) we just expose __test__ helpers.
import { fileURLToPath } from "node:url";
const isDirectRun =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("digest.ts") ||
    process.argv[1].endsWith("digest.js"));
if (isDirectRun) {
  main().catch((err) => {
    console.error("[digest] fatal:", err);
    process.exit(1);
  });
}

/** Exported for unit testing only. */
export const __test__ = { extractJsonPayload };
