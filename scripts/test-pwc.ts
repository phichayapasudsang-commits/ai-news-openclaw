// scripts/test-pwc.ts — isolated probe for paperswithcode.co via Playwright.
// Run:  npx tsx scripts/test-pwc.ts
import "dotenv/config";
import { chromium } from "playwright-core";

const URL = "https://paperswithcode.co/";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  console.log("[test-pwc] opening", URL);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

  const links = await page.$$eval(
    "a[href]",
    (anchors) => anchors.slice(0, 100).map((a) => ({
      href: (a as HTMLAnchorElement).href,
      text: (a.textContent || "").trim().slice(0, 80),
    }))
  );
  console.log(`[test-pwc] ${links.length} anchors on index`);

  // Now probe one article page
  const first = links.find(
    (l) => /\/paper\/\d/.test(l.href) && l.text.length > 4
  );
  if (first) {
    console.log(`[test-pwc] visiting ${first.href}`);
    const p2 = await ctx.newPage();
    await p2.goto(first.href, { waitUntil: "domcontentloaded", timeout: 30000 });
    await p2.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    const articleText = await p2.$$eval(
      "p, h1, h2, h3, li",
      (els) => els.map((e) => (e.textContent || "").trim()).filter(Boolean).join("\n")
    );
    console.log(`[test-pwc] article textLen=${articleText.length}`);
    console.log(articleText.slice(0, 800));
    await p2.close();
  } else {
    console.log("[test-pwc] no paper links found on index");
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
