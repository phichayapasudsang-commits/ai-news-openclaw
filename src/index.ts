/**
 * src/index.ts
 * ---------------------------------------------------------------
 * Orchestrator entrypoint.
 *
 * Wires the FIVE agents together in sequence:
 *
 *   Researcher  ->  Deduplicator  ->  Analyst  ->  Editor  ->  QA
 *   (4 topics +    (vector+TTL)      (en/th +    (polish +  (insert)
 *    freshness                          category)  trim)
 *    gate BEFORE
 *    scrape)
 *
 * Note: the freshness gate moved INTO Researcher so we never call
 * Firecrawl on stale hits. Topic relevance is guaranteed by
 * Researcher looping the topics in priority order.
 *
 * Usage:
 *   npm run dev                       # run once with the default topics
 *   TOPIC="MCP,Agent"  npm run dev    # run once with custom topics (CSV)
 *   npm run build && npm start        # production
 *
 * Environment:
 *   All keys are loaded from `.env` via dotenv (see tools.ts).
 * ---------------------------------------------------------------
 */
import "dotenv/config";

import { supabaseArticleTool } from "./tools.js";
import {
  researcherAgent,
  deduplicatorAgent,
  analystAgent,
  editorAgent,
  qaAgent,
  DEFAULT_TOPICS,
  TARGET_ARTICLES_PER_DAY,
  MAX_SCRAPE_BUDGET,
  type DedupedArticle,
  type FinalArticle,
} from "./agents.js";

export interface PipelineOptions {
  /** Single topic (string) or priority list (string[]). */
  topic?: string | string[];
  /** Researcher freshness window in hours. Default 24. */
  maxAgeHours?: number;
  /** Soft daily target - logged in summary. Default: TARGET_ARTICLES_PER_DAY (20). */
  targetArticles?: number;
  /** Hard cap on Firecrawl calls per run. Default: MAX_SCRAPE_BUDGET (40). */
  scrapeBudget?: number;
  /** When true, logs every transition. Default: true. */
  verbose?: boolean;
}

export interface PipelineSummary {
  topics: string[];
  ranAt: string;
  /** Soft daily target that shaped the run. */
  targetArticles: number;
  /** Hard cap on Firecrawl calls that shaped the run. */
  scrapeBudget: number;
  /** Raw search hits before freshness gate. */
  rawHits: number;
  /** Hits dropped by Researcher freshness gate (no-date or too-old). */
  droppedStale: number;
  /** Articles actually scraped by Firecrawl. */
  scraped: number;
  freshAfterDedup: number;
  analyzed: number;
  edited: number;
  inserted: number;
  rejected: number;
  /** Convenience: inserted - targetArticles. Negative means under target. */
  shortBy: number;
}

/** Normalize `topic?: string | string[]` to a non-empty string[]. */
function resolveTopics(topic?: string | string[]): string[] {
  if (Array.isArray(topic)) {
    const cleaned = topic.map((t) => t.trim()).filter(Boolean);
    if (cleaned.length > 0) return cleaned;
  }
  if (typeof topic === "string" && topic.trim().length > 0) {
    return topic.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return [...DEFAULT_TOPICS];
}

/**
 * Execute the full pipeline once and return a short summary.
 */
export async function runPipeline(
  opts: PipelineOptions = {}
): Promise<PipelineSummary> {
  const topics = resolveTopics(opts.topic);
  const maxAgeHours = opts.maxAgeHours ?? 24;
  const targetArticles = opts.targetArticles ?? TARGET_ARTICLES_PER_DAY;
  const scrapeBudget = opts.scrapeBudget ?? MAX_SCRAPE_BUDGET;
  const verbose = opts.verbose ?? true;
  const log = (msg: string) => {
    if (verbose) console.log(`[pipeline] ${msg}`);
  };

  // ---- Stage 1: Researcher ---------------------------------------
  log(
    `1/5 Researcher: target=${targetArticles}/day, scrapeBudget=${scrapeBudget}, ` +
      `freshness <= ${maxAgeHours}h, topics=[${topics.join(", ")}] ...`
  );
  const research = await researcherAgent.run({
    topics,
    maxAgeHours,
    targetArticles,
    scrapeBudget,
  });
  log(
    `   raw hits=${research.scraped.length + research.droppedStale.length} ` +
      `droppedStale=${research.droppedStale.length} scraped=${research.scraped.length}`
  );
  if (research.scraped.length === 0) {
    return {
      topics,
      ranAt: new Date().toISOString(),
      targetArticles,
      scrapeBudget,
      rawHits: research.droppedStale.length,
      droppedStale: research.droppedStale.length,
      scraped: 0,
      freshAfterDedup: 0,
      analyzed: 0,
      edited: 0,
      inserted: 0,
      rejected: 0,
      shortBy: targetArticles,
    };
  }

  // ---- Stage 2: Deduplicator -------------------------------------
  log(`2/5 Deduplicator: checking ${research.scraped.length} URL(s) against Supabase vector cache ...`);
  const unique: DedupedArticle[] = await deduplicatorAgent.run({
    articles: research.scraped,
  });
  log(`   ${unique.length} fresh / ${research.scraped.length - unique.length} duplicate`);
  if (unique.length === 0) {
    return {
      topics,
      ranAt: new Date().toISOString(),
      targetArticles,
      scrapeBudget,
      rawHits: research.scraped.length + research.droppedStale.length,
      droppedStale: research.droppedStale.length,
      scraped: research.scraped.length,
      freshAfterDedup: 0,
      analyzed: 0,
      edited: 0,
      inserted: 0,
      rejected: 0,
      shortBy: targetArticles,
    };
  }

  // ---- Stage 3: Analyst ------------------------------------------
  log(`3/5 Analyst: summarising ${unique.length} article(s) (en/th + category) ...`);
  const analyzed: FinalArticle[] = await analystAgent.run({
    articles: unique,
    topics,
  });
  log(`   produced ${analyzed.length} structured row(s)`);

  // ---- Stage 4: Editor -------------------------------------------
  log(`4/5 Editor: polishing Thai + trimming titles/summaries ...`);
  const { edited, changes } = await editorAgent.run({ articles: analyzed });
  log(`   edited=${edited.length} changes=${changes.length}`);

  // ---- Stage 5: QA -----------------------------------------------
  log(`5/5 QA: validating and inserting ...`);
  const qa = await qaAgent.run({ articles: edited });
  log(`   inserted=${qa.inserted} rejected=${qa.rejected.length}`);

  // ---- Cleanup: Delete older articles ----------------------------
  log("Cleanup: deleting articles older than 3 days ...");
  try {
    const cleanup = await supabaseArticleTool.deleteOlderArticles(3);
    if (cleanup.error) {
      log(`   cleanup failed: ${cleanup.error}`);
    } else {
      log(`   cleanup success: deleted ${cleanup.deleted} old article(s)`);
    }
  } catch (err) {
    log(`   cleanup error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    topics,
    ranAt: new Date().toISOString(),
    targetArticles,
    scrapeBudget,
    rawHits: research.scraped.length + research.droppedStale.length,
    droppedStale: research.droppedStale.length,
    scraped: research.scraped.length,
    freshAfterDedup: unique.length,
    analyzed: analyzed.length,
    edited: edited.length,
    inserted: qa.inserted,
    rejected: qa.rejected.length,
    shortBy: targetArticles - qa.inserted,
  };
}

// ---------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------
async function main() {
  const topic = process.env.TOPIC?.trim() || undefined;
  const summary = await runPipeline({ topic });
  console.log("\n========= Pipeline summary =========");
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    `\nTarget: ${summary.inserted}/${summary.targetArticles} ` +
      `(${summary.shortBy >= 0 ? `short by ${summary.shortBy}` : `over by ${-summary.shortBy}`})`
  );
}

// Run only when executed directly, not on import.
const entry = process.argv[1] ?? "";
const isDirect =
  entry.endsWith("index.ts") || entry.endsWith("index.js");
if (isDirect) {
  main().catch((err) => {
    console.error("[pipeline] fatal:", err);
    process.exitCode = 1;
  });
}
