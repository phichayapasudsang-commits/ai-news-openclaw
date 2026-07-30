/**
 * UI-side types for the AI News web SPA.
 *
 * These are derived from the Supabase `articles` row schema (see
 * web/src/lib/supabase.ts → fetchArticles) and reshaped for the
 * 9:16 mobile-first layout inspired by the AI Studio reference.
 *
 * IMPORTANT: this is a read-only client. All fields below come from
 * already-stored articles; we never derive new content on the client.
 */

export type Lang = "en" | "th";

export type Category = "MCP" | "Agent" | "Memory" | "Research";

export const CATEGORIES: ReadonlyArray<Category> = [
  "MCP",
  "Agent",
  "Memory",
  "Research",
];

/** Category used by the "All" tab and the filter UI. */
export type CategoryFilter = Category | "All";

/**
 * A single bullet parsed out of the `body_en` / `body_th` newline-joined
 * string the pipeline stores in Supabase. The pipeline writes bullets as
 * "- <title>\n- <title>..."; on the client we split and shape them for
 * the key-highlights card list.
 */
export interface HighlightBullet {
  title: string;
  desc: string;
}

/**
 * UI-shaped article derived from one Supabase row. Built in
 * web/src/lib/data.ts so the components stay schema-agnostic.
 */
export interface UINewsArticle {
  id: number;
  titleEn: string;
  titleTh: string;
  category: Category;
  publishedDate: string;
  summarizedTime: string; // human-friendly date string
  summarizedDate?: string;
  snippetEn: string;
  snippetTh: string;
  executiveSummaryEn: string;
  executiveSummaryTh: string;
  keyHighlightsEn: HighlightBullet[];
  keyHighlightsTh: HighlightBullet[];
  trendsOverviewEn: string[];
  trendsOverviewTh: string[];
  originalSourceUrl?: string;
  imageUrl?: string | null;
}

/** Raw row shape returned by Supabase. */
export interface RawArticleRow {
  id: number;
  title_en: string;
  title_th: string;
  summary_en: string;
  summary_th: string;
  body_en: string;
  body_th: string;
  category: string;
  original_url: string;
  image_url: string | null;
  published_date: string;
  inserted_at?: string;
}
