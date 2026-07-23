// scripts/dump-latest-body.mjs
// Dump latest article's body_en and summary_en so we can see what shape
// the dashboard is actually parsing in production.

import { readFileSync } from "node:fs";

const env = readFileSync(".env", "utf8").split(/\r?\n/);
const url = env.find((l) => l.startsWith("SUPABASE_URL="))?.split("=")[1]?.trim();
const key = env
  .find((l) => l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))
  ?.split("=")[1]
  ?.trim();

const r = await fetch(
  `${url}/rest/v1/articles?select=title_en,summary_en,body_en&order=inserted_at.desc&limit=1`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
const rows = await r.json();
const a = rows[0];

console.log("=== TITLE ===");
console.log(a.title_en);
console.log("");
console.log("=== summary_en (140-char lede) ===");
console.log(a.summary_en);
console.log("");
console.log("=== body_en (full packed body) ===");
console.log(a.body_en);
console.log("");
console.log("=== body_en line count ===");
console.log(a.body_en.split(/\r?\n/).length);
