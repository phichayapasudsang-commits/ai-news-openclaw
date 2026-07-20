/**
 * Mapping layer between the Supabase row schema and the UI shapes.
 *
 * Pipeline stores articles as flat columns (`title_en`, `body_en`, ...)
 * with `body_en` being a newline-joined bullet list starting with "- ".
 * The UI wants structured fields (executive summary, key highlights),
 * so we reshape here.
 */
import type {
  Category,
  HighlightBullet,
  RawArticleRow,
  UINewsArticle,
} from "./types";

const CATEGORY_SET: ReadonlySet<string> = new Set([
  "MCP",
  "Agent",
  "Memory",
  "Research",
]);

/**
 * Split a pipeline body string into a list of bullet items.
 * Each line that starts with "-" (with optional leading whitespace) is a
 * bullet. Lines without a leading "-" are ignored.
 */
export function parseBullets(body: string): string[] {
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

/**
 * Shape a raw row into the UI model. Falls back to empty strings when
 * data is missing so downstream components never have to handle nulls.
 */
export function toUINewsArticle(row: RawArticleRow): UINewsArticle {
  const category: Category = CATEGORY_SET.has(row.category)
    ? (row.category as Category)
    : "Research";

  const highlightsEnRaw = parseBullets(row.body_en);
  const highlightsThRaw = parseBullets(row.body_th);

  return {
    id: row.id,
    titleEn: row.title_en || "",
    titleTh: row.title_th || row.title_en || "",
    category,
    publishedDate: row.published_date || "",
    summarizedTime: formatSummarizedTime(row.inserted_at),
    summarizedDate: formatSummarizedDate(row.inserted_at),
    snippetEn: trimForSnippet(row.summary_en),
    snippetTh: trimForSnippet(row.summary_th),
    executiveSummaryEn: row.summary_en || "",
    executiveSummaryTh: row.summary_th || "",
    keyHighlightsEn: highlightsEnRaw.map(toHighlight),
    keyHighlightsTh: highlightsThRaw.map(toHighlight),
    originalSourceUrl: row.original_url || undefined,
    imageUrl: row.image_url ?? undefined,
  };
}

/** Cap snippet length for card preview. */
function trimForSnippet(text: string, max = 220): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Convert one bullet string into a {title, desc} pair.
 * Pipeline bullets are short single-line items, so we keep `title` for
 * the full line and leave `desc` empty. The card UI uses both; the
 * detail screen shows title in larger weight and desc in muted text.
 */
function toHighlight(line: string): HighlightBullet {
  return { title: line, desc: "" };
}

/** e.g. "16 Jul 2026, 10:32" (en) / "16 ก.ค. 2569 10:32" (th). */
function formatSummarizedTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Use EN locale here for stability; the UI can localize per language.
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSummarizedDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Group articles by day-of-publication or by insertion date as fallback. */
export function groupByDay(
  rows: UINewsArticle[]
): Array<{ key: string; label: string; items: UINewsArticle[] }> {
  const buckets = new Map<string, UINewsArticle[]>();
  for (const a of rows) {
    const key = a.publishedDate || a.summarizedDate || "unknown";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(a);
  }
  return [...buckets.entries()]
    .map(([key, items]) => ({
      key,
      label: key === "unknown" ? "Earlier" : key,
      items: items.sort((a, b) => b.id - a.id),
    }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}
