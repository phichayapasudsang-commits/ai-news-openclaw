/**
 * scripts/ddg-diag.ts
 * Quick probe of DuckDuckGo HTML endpoint. Run with:
 *   npx tsx scripts/ddg-diag.ts [query]
 */
const query = process.argv[2] ?? "MCP news today";
const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);

const res = await fetch(url, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    Accept: "text/html",
  },
});

console.log("status:", res.status);
console.log("content-type:", res.headers.get("content-type"));
const body = await res.text();
console.log("body length:", body.length);
console.log("--- first 1500 chars ---");
console.log(body.slice(0, 1500));
console.log("--- link regex test ---");
const linkRe =
  /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
let hits = 0;
let m: RegExpExecArray | null;
while ((m = linkRe.exec(body)) !== null && hits < 3) {
  console.log(`HIT[${hits}]:`, m[1].slice(0, 120), "||", m[2].replace(/<[^>]+>/g, "").slice(0, 80));
  hits++;
}
console.log("total link hits:", hits);
