// scripts/dump-cleanup-preview.mjs
// Saves the rows that are about to be deleted by cleanup-old-articles.mjs
// to a JSON log under logs/. Run BEFORE the cleanup so we have a permanent
// record of what got removed.
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
cutoff.setUTCDate(cutoff.getUTCDate() - days);
const cutoffStr = cutoff.toISOString().slice(0, 10);

const res = await fetch(
  `${url}/rest/v1/articles?select=id,title_en,source,published_date,inserted_at,image_url&published_date=lte.${cutoffStr}&order=published_date.asc&limit=1000`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!res.ok) {
  console.error("HTTP", res.status, await res.text());
  process.exit(1);
}
const rows = await res.json();

const summary = {
  cleanup_date: new Date().toISOString(),
  cutoff: cutoffStr,
  retention_days: days,
  total: rows.length,
  by_source: {},
  by_year: {},
};
for (const r of rows) {
  summary.by_source[r.source || "(unknown)"] = (summary.by_source[r.source || "(unknown)"] || 0) + 1;
  const y = (r.published_date || "unknown").slice(0, 4);
  summary.by_year[y] = (summary.by_year[y] || 0) + 1;
}

mkdirSync(resolve(outfile, ".."), { recursive: true });
writeFileSync(
  outfile,
  JSON.stringify({ summary, rows }, null, 2),
  "utf8",
);

console.log(`Wrote ${rows.length} rows to ${outfile}`);
console.log(`by_source:`, summary.by_source);
console.log(`by_year:`, summary.by_year);
