// scripts/cleanup-old-articles.mjs
// One-shot DB cleanup: delete articles whose published_date is older than
// the retention window. Default window = 3 days inclusive
// (today, yesterday, day-before-yesterday are kept; older is removed).
//
// This is a manual DB maintenance tool — it does NOT touch the digest
// pipeline. Run on demand after bt reviews what's about to go:
//
//   node scripts/cleanup-old-articles.mjs --dry-run   # preview only
//   node scripts/cleanup-old-articles.mjs             # live delete (3-sec abort)
//   node scripts/cleanup-old-articles.mjs --days=7    # custom window
//
// Example: today is 2026-07-23 → cutoff = 2026-07-20 → delete rows with
// published_date < 2026-07-20, keep 2026-07-21/22/23.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const daysArg = args.find((a) => a.startsWith("--days="));
const days = daysArg ? parseInt(daysArg.split("=")[1], 10) : 3;
if (!Number.isFinite(days) || days < 1) {
  console.error("--days must be a positive integer (default 3)");
  process.exit(1);
}

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

// "Today" in UTC to match Supabase's default timezone for date columns.
// Cutoff = today - days. We delete where published_date <= cutoff, so the
// retention window is the inclusive range (today - days + 1, today].
// E.g. days=3 on 2026-07-23 → cutoff = 2026-07-20 → delete rows with
// published_date <= 2026-07-20 → keep 2026-07-21, 22, 23.
const now = new Date();
const todayUtc = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
);
const cutoff = new Date(todayUtc);
cutoff.setUTCDate(cutoff.getUTCDate() - days);
const cutoffStr = cutoff.toISOString().slice(0, 10);
const todayStr = todayUtc.toISOString().slice(0, 10);

console.log(`Mode:     ${dryRun ? "DRY-RUN (no rows deleted)" : "LIVE DELETE"}`);
console.log(`Today:    ${todayStr} (UTC)`);
console.log(`Cutoff:   published_date <= ${cutoffStr} (will be deleted)`);
console.log(`Keep:     ${days} days inclusive (${days === 1 ? todayStr : `${addDays(todayStr, -(days - 1))} → ${todayStr}`})`);

// 1. Count and preview
const selectRes = await fetch(
  `${url}/rest/v1/articles?select=id,title_en,published_date,source&published_date=lte.${cutoffStr}&order=published_date.asc&limit=500`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!selectRes.ok) {
  console.error("HTTP", selectRes.status, await selectRes.text());
  process.exit(1);
}
const oldRows = await selectRes.json();

const nullRes = await fetch(
  `${url}/rest/v1/articles?select=id&published_date=is.null`,
  { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" } },
);
let nullCount = 0;
if (nullRes.ok) {
  // Prefer count header; fall back to array length
  const range = nullRes.headers.get("content-range");
  if (range && range.includes("/")) {
    nullCount = Number(range.split("/")[1]);
  } else {
    const arr = await nullRes.json();
    nullCount = arr.length;
  }
}

console.log(`\nRows to delete:    ${oldRows.length}`);
console.log(`Rows with null published_date (kept): ${nullCount}`);

if (oldRows.length > 0) {
  console.log("\n=== preview (oldest first, up to 10) ===");
  oldRows.slice(0, 10).forEach((r) => {
    const title = (r.title_en || "(no title)").slice(0, 60);
    console.log(`  [${r.published_date}] ${(r.source || "?").padEnd(28)} — ${title}`);
  });
  if (oldRows.length > 10) console.log(`  ... and ${oldRows.length - 10} more`);
}

if (dryRun) {
  console.log("\nDRY-RUN — no rows deleted. Re-run without --dry-run to commit.");
  process.exit(0);
}

if (oldRows.length === 0) {
  console.log("\nNothing to delete. Database is already within the retention window.");
  process.exit(0);
}

// 2. 3-second abort window
console.log(`\nAbout to DELETE ${oldRows.length} rows in 3 seconds — Ctrl-C to abort.`);
await new Promise((r) => setTimeout(r, 3000));

// 3. Delete in batches (Supabase URL length limit ~8 KB)
const BATCH = 100;
let deleted = 0;
for (let i = 0; i < oldRows.length; i += BATCH) {
  const batch = oldRows.slice(i, i + BATCH);
  const ids = batch.map((r) => r.id).join(",");
  const delRes = await fetch(`${url}/rest/v1/articles?id=in.(${ids})`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!delRes.ok) {
    console.error(`\nDELETE failed at batch ${i / BATCH + 1}: HTTP ${delRes.status}`);
    console.error(await delRes.text());
    process.exit(1);
  }
  deleted += batch.length;
  console.log(`  deleted ${deleted}/${oldRows.length}`);
}

console.log(`\n✅ Cleaned up ${deleted} rows. Database now holds ${days}-day window.`);

function addDays(yyyyMmDd, delta) {
  const d = new Date(yyyyMmDd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
