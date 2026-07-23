// scripts/report-image-coverage.mjs
// Reports image_url coverage by source for articles inserted today (UTC).
// Uses Supabase REST API via service role key.

import { readFileSync } from "node:fs";

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

const since = "2026-07-23T00:00:00Z";
const res = await fetch(
  `${url}/rest/v1/articles?select=original_url,image_url,source,inserted_at&order=inserted_at.desc&limit=200`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!res.ok) {
  console.error("HTTP", res.status, await res.text());
  process.exit(1);
}
const rows = await res.json();
const today = rows.filter((r) => r.inserted_at >= since);

console.log(`Articles inserted since ${since}: ${today.length}`);

const withImg = today.filter((r) => r.image_url && r.image_url.trim().length > 0);
console.log(`  with image_url:    ${withImg.length} (${Math.round((withImg.length / today.length) * 100)}%)`);
console.log(`  without image_url: ${today.length - withImg.length}`);

console.log("\n=== by source ===");
const bySrc = {};
today.forEach((r) => {
  const s = r.source || "(unknown)";
  if (!bySrc[s]) bySrc[s] = { total: 0, withImg: 0 };
  bySrc[s].total++;
  if (r.image_url && r.image_url.trim()) bySrc[s].withImg++;
});
Object.entries(bySrc)
  .sort()
  .forEach(([s, v]) => {
    const pct = Math.round((v.withImg / v.total) * 100);
    console.log(`  ${s.padEnd(40)} ${v.withImg}/${v.total} (${pct}%)`);
  });

console.log("\n=== samples (first 5 with image) ===");
today
  .filter((r) => r.image_url && r.image_url.trim())
  .slice(0, 5)
  .forEach((r) => {
    console.log(`  ${r.original_url.slice(0, 60)}`);
    console.log(`    -> ${r.image_url.slice(0, 100)}`);
  });

console.log("\n=== samples without image (if any) ===");
today
  .filter((r) => !r.image_url || !r.image_url.trim())
  .slice(0, 5)
  .forEach((r) => console.log(`  ${r.original_url}`));
