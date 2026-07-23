// scripts/dump-cleanup-preview.mjs
// Saves the rows that are about to be deleted by cleanup-old-articles.mjs
// to a JSON log under logs/. Run BEFORE the cleanup so we have a permanent
// record of what got removed.
//
// Uses `inserted_at` (when we summarised) — NOT `published_date` (when the
// source article came out). That matches the cleanup script's retention
// rule: keep the last `days` calendar days of summarisation work.
//
// Usage:
//   node scripts/dump-cleanup-preview.mjs [--days=3] [outfile]
//
// Defaults: --days=3, outfile=logs/cleanup-<YYYY-MM-DD>.json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith("--days="));
const days = daysArg ? parseInt(daysArg.split("=")[1], 10) : 3;
const outfile = args.find((a) => !a.startsWith("--")) ?? `logs/cleanup-${new Date().toISOString().slice(0, 10)}.json`;

const env = readFileSync(".env", "utf8").split(/\r?\n/);
const url = env.find((l) => l.startsWith("SUPABASE_URL="))?.split("=")[1]?.trim();
const key = env
  .find((l) => l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))
  ?.split("=")[1]
  ?.trim();
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const todayUtc = new Date();
const cutoff = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate()));
cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
const cutoffIso = cutoff.toISOString();

const res = await fetch(
  `${url}/rest/v1/articles?select=id,title_en,source,published_date,inserted_at,image_url&inserted_at=lt.${cutoffIso}&order=inserted_at.asc&limit=1000`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!res.ok) {
  console.error("HTTP", res.status, await res.text());
  process.exit(1);
}
const rows = await res.json();

const summary = {
  cleanup_date: new Date().toISOString(),
  cutoff: cutoffIso,
  retention_days: days,
  retention_rule: "rows where inserted_at < cutoff are deleted (last N calendar days of summarisation)",
  total: rows.length,
  by_source: {},
  by_inserted_at_date: {},
};
for (const r of rows) {
  summary.by_source[r.source || "(unknown)"] = (summary.by_source[r.source || "(unknown)"] || 0) + 1;
  const d = (r.inserted_at || "unknown").slice(0, 10);
  summary.by_inserted_at_date[d] = (summary.by_inserted_at_date[d] || 0) + 1;
}

mkdirSync(resolve(outfile, ".."), { recursive: true });
writeFileSync(
  outfile,
  JSON.stringify({ summary, rows }, null, 2),
  "utf8",
);

console.log(`Wrote ${rows.length} rows to ${outfile}`);
console.log(`by_source:`, summary.by_source);
console.log(`by_inserted_at_date:`, summary.by_inserted_at_date);
