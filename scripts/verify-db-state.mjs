// scripts/verify-db-state.mjs
// Quick dump: total row count + distribution by inserted_at date.
// Verifies that cleanup-old-articles.mjs actually deleted what it claimed.

import { readFileSync } from "node:fs";

const env = readFileSync(".env", "utf8").split(/\r?\n/);
const url = env.find((l) => l.startsWith("SUPABASE_URL="))?.split("=")[1]?.trim();
const key = env
  .find((l) => l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))
  ?.split("=")[1]
  ?.trim();

const r = await fetch(
  `${url}/rest/v1/articles?select=id,title_en,inserted_at,source&order=inserted_at.asc&limit=500`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
const rows = await r.json();
console.log("Total rows:", rows.length);

const byDate = {};
for (const row of rows) {
  const d = (row.inserted_at || "").slice(0, 10);
  byDate[d] = (byDate[d] || 0) + 1;
}
console.log("\nBy inserted_at date:");
Object.entries(byDate).forEach(([d, c]) => console.log(`  ${d}: ${c}`));

console.log("\nRows with inserted_at on 2026-07-14:");
const old = rows.filter((r) => (r.inserted_at || "").startsWith("2026-07-14"));
console.log(`  count: ${old.length}`);
old.forEach((r) => console.log(`  ${r.id}  ${r.inserted_at}  ${r.source}  ${(r.title_en || "").slice(0, 50)}`));

console.log("\nRows with inserted_at on 2026-07-16:");
const r16 = rows.filter((r) => (r.inserted_at || "").startsWith("2026-07-16"));
console.log(`  count: ${r16.length}`);
r16.forEach((r) => console.log(`  ${r.id}  ${r.inserted_at}  ${r.source}  ${(r.title_en || "").slice(0, 50)}`));
