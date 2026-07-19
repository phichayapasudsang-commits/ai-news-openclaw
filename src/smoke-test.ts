/**
 * Smoke test: import all agents + orchestrator and assert shapes.
 * Does NOT call any external API. Run with: npx tsx src/smoke-test.ts
 */
import {
  researcherAgent,
  deduplicatorAgent,
  analystAgent,
  editorAgent,
  qaAgent,
  DEFAULT_TOPICS,
  TARGET_ARTICLES_PER_DAY,
  MAX_SCRAPE_BUDGET,
  agents,
  __test__,
  NEWS_SOURCES,
} from "./agents.js";

const fails: string[] = [];
function check(label: string, ok: boolean, detail?: unknown) {
  const status = ok ? "OK" : "FAIL";
  console.log(`[${status}] ${label}`);
  if (!ok) {
    fails.push(label);
    if (detail !== undefined) console.log("        detail:", detail);
  }
}

// ---- agents.ts exports ---------------------------------------------
check(
  "DEFAULT_TOPICS is [MCP, Agent, Memory, Research]",
  JSON.stringify(DEFAULT_TOPICS) ===
    JSON.stringify(["MCP", "Agent", "Memory", "Research"]),
  DEFAULT_TOPICS
);

check("researcherAgent.run exists", typeof researcherAgent.run === "function");
check("deduplicatorAgent.run exists", typeof deduplicatorAgent.run === "function");
check("analystAgent.run exists", typeof analystAgent.run === "function");
check("editorAgent.run exists", typeof editorAgent.run === "function");
check("qaAgent.run exists", typeof qaAgent.run === "function");

check(
  "agents bundle has 5 agents",
  Object.keys(agents).length === 5,
  Object.keys(agents)
);

check("agents bundle no longer exports selector", !("selector" in agents));

check(
  "agents bundle has expected names",
  JSON.stringify(Object.keys(agents).sort()) ===
    JSON.stringify(["analyst", "deduplicator", "editor", "qa", "researcher"])
);

// ---- operating defaults ------------------------------------------
check(
  "TARGET_ARTICLES_PER_DAY is 20",
  TARGET_ARTICLES_PER_DAY === 20,
  TARGET_ARTICLES_PER_DAY
);
check(
  "MAX_SCRAPE_BUDGET >= target (room for filtering)",
  MAX_SCRAPE_BUDGET >= TARGET_ARTICLES_PER_DAY,
  MAX_SCRAPE_BUDGET
);

// ---- news sources (4 fixed Firecrawl targets) -------------------
check(
  "NEWS_SOURCES has exactly 4 sources",
  NEWS_SOURCES.length === 4,
  NEWS_SOURCES.map((s) => s.id)
);
check(
  "NEWS_SOURCES covers all 4 categories",
  NEWS_SOURCES.every((s) =>
    ["MCP", "Agent", "Memory", "Research"].includes(s.category)
  ) && new Set(NEWS_SOURCES.map((s) => s.category)).size >= 3,
  NEWS_SOURCES.map((s) => s.category)
);
check(
  "Every NEWS_SOURCES has extractLinks + urlFor",
  NEWS_SOURCES.every(
    (s) =>
      typeof s.urlFor === "function" && typeof s.extractLinks === "function"
  )
);

// ---- hardTrim unit tests (no API) ---------------------------------
check("hardTrim leaves short text unchanged",
  __test__.hardTrim("short", 100) === "short");
check("hardTrim truncates long text",
  __test__.hardTrim("X".repeat(500), 110).length <= 110,
  __test__.hardTrim("X".repeat(500), 110).length);
check("hardTrim returns empty for empty",
  __test__.hardTrim("", 100) === "");
check(
  "hardTrimSummary respects word cap",
  __test__.hardTrimSummary("a b c d e f g", 1000, 3).split(/\s+/).filter(Boolean).length <= 3
);
check(
  "hardTrimSummary respects char cap",
  __test__.hardTrimSummary("X ".repeat(200), 50, 1000).length <= 50
);

// ---- extractJsonPayload unit tests (Fix A) -----------------------
// Build test inputs via JSON.stringify so escape semantics stay correct.
const innerArr = JSON.stringify([{ title_en: "A" }, { title_en: "B" }]); // [{"title_en":"A"},{"title_en":"B"}]
const proseWrapped =
  "Let me analyze these articles. Here is the JSON:\n```json\n" +
  innerArr +
  "\n```\nHope that helps.";
check(
  "extractJsonPayload strips prose prefix + code fences",
  __test__.extractJsonPayload(proseWrapped) === innerArr
);

// Nested object whose string value contains an escaped quote.
const innerNested = JSON.stringify({ a: 1, b: { c: [1, 2, 'x"y'] }, d: 3 });
const nested = `prefix ${innerNested} suffix`;
try {
  const parsed = JSON.parse(__test__.extractJsonPayload(nested));
  check(
    "extractJsonPayload handles nested objects with escaped quotes",
    parsed.a === 1 && parsed.b.c[2] === 'x"y',
    parsed
  );
} catch (err) {
  check(
    "extractJsonPayload handles nested objects with escaped quotes",
    false,
    (err as Error).message
  );
}

const noJson = "I cannot comply with that request.";
check(
  "extractJsonPayload returns trimmed input when no JSON present",
  __test__.extractJsonPayload(noJson) === noJson.trim()
);

const arrayWrapped = `Sure! ${innerArr} is what you asked for.`;
check(
  "extractJsonPayload picks arrays too",
  __test__.extractJsonPayload(arrayWrapped) === innerArr
);

// ---- digest.ts JSON extractor regression tests -------------------
// digest.ts has its own copy of extractJsonPayload (no cross-import).
// Imported lazily so the suite can run when digest.ts isn't ready yet.
import("./digest.js")
  .then(({ __test__: digestTest }) => {
    // Case 1: prose-wrapped object (the "Let me analyze" failure mode).
    const proseObj = `Let me analyze this article.\n{\n  "title_en": "X",\n  "title_th": "Y"\n}`;
    try {
      const parsed = JSON.parse(digestTest.extractJsonPayload(proseObj));
      check(
        "digest.extractJsonPayload strips prose prefix from object",
        parsed.title_en === "X" && parsed.title_th === "Y",
        parsed
      );
    } catch (err) {
      check(
        "digest.extractJsonPayload strips prose prefix from object",
        false,
        (err as Error).message
      );
    }

    // Case 2: array with escaped quotes inside nested strings.
    const arrNested = JSON.stringify([
      { title_en: 'A "quoted" title', body_th: '- ข้อ 1\n- ข้อ 2' },
      { title_en: "B", body_th: "" },
    ]);
    const wrappedArr = `Sure, here you go:\n${arrNested}\nDone.`;
    try {
      const parsed = JSON.parse(digestTest.extractJsonPayload(wrappedArr));
      check(
        "digest.extractJsonPayload handles array with nested escapes",
        Array.isArray(parsed) &&
          parsed.length === 2 &&
          parsed[0].title_en === 'A "quoted" title',
        parsed
      );
    } catch (err) {
      check(
        "digest.extractJsonPayload handles array with nested escapes",
        false,
        (err as Error).message
      );
    }

    // Case 3: code-fenced JSON (mimics ```json ... ``` wrappers).
    const fenced = "```json\n" + innerArr + "\n```";
    check(
      "digest.extractJsonPayload strips code fences",
      digestTest.extractJsonPayload(fenced) === innerArr
    );

    // Case 4: empty / garbage input returns trimmed input unchanged.
    const garbage = "  I can't help with that.  ";
    check(
      "digest.extractJsonPayload passes through non-JSON cleanly",
      digestTest.extractJsonPayload(garbage) === garbage.trim()
    );

    // Case 5: nested braces inside string values (the HF-blog failure mode).
    const tricky = JSON.stringify({
      title_en: "Test",
      body_th: 'bullet - "quoted" with } inside',
    });
    const wrappedTricky = `Some prose ${tricky} trailing`;
    try {
      const parsed = JSON.parse(digestTest.extractJsonPayload(wrappedTricky));
      check(
        "digest.extractJsonPayload ignores braces inside string values",
        parsed.title_en === "Test" &&
          parsed.body_th.includes('with } inside'),
        parsed
      );
    } catch (err) {
      check(
        "digest.extractJsonPayload ignores braces inside string values",
        false,
        (err as Error).message
      );
    }

    console.log("\nSmoke test finished. Failing checks:", fails.length);
    if (fails.length > 0) {
      console.log("FAILURES:", fails);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("[smoke-test] could not import digest.ts:", err);
    console.log("\nSmoke test finished. Failing checks:", fails.length);
    if (fails.length > 0) {
      console.log("FAILURES:", fails);
      process.exit(1);
    }
  });
