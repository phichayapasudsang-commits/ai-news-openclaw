/**
 * Browser-safe Supabase client for the AI News web SPA.
 *
 * Uses the anon key only. The service_role key must NEVER ship to the
 * browser. Reads are gated by the RLS policy added in
 * db/migrations/0003_articles_rls_anon_read.sql.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RawArticleRow, UINewsArticle } from "./types";
import { toUINewsArticle } from "./data";

const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const isMockMode = import.meta.env.VITE_USE_MOCK === "1";

if (!isMockMode && (!url || !anon)) {
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing. " +
      "Copy .env.example to .env and fill in the values."
  );
}

let _client: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_client) return _client;
  if (!url || !anon) {
    throw new Error(
      "Supabase env vars missing. Set VITE_SUPABASE_URL and " +
        "VITE_SUPABASE_ANON_KEY in .env (or enable VITE_USE_MOCK=1 for " +
        "demo data)."
    );
  }
  _client = createClient(url, anon, { auth: { persistSession: false } });
  return _client;
}

/**
 * Fetch the most recent N articles, newest first, mapped into the UI
 * shape. Set VITE_USE_MOCK=1 in .env to serve a static fixture instead
 * of hitting Supabase.
 */
export async function fetchArticles(limit = 50): Promise<UINewsArticle[]> {
  if (isMockMode) {
    await new Promise((r) => setTimeout(r, 400));
    return [...MOCK]
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
      .slice(0, limit)
      .map(toUINewsArticle);
  }

  const { data, error } = await getSupabase()
    .from("articles")
    .select(
      "id, title_en, title_th, summary_en, summary_th, " +
        "body_en, body_th, category, original_url, image_url, " +
        "published_date, inserted_at"
    )
    .order("inserted_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }
  return ((data ?? []) as unknown as RawArticleRow[]).map(toUINewsArticle);
}

const MOCK: RawArticleRow[] = [
  {
    id: 1,
    title_en: "OpenAI unveils GPT-5 with built-in agent memory",
    title_th: "OpenAI เปิดตัว GPT-5 พร้อมหน่วยความจำตัวแทนในตัว",
    summary_en:
      "OpenAI announced GPT-5 today, featuring a native long-term memory module that lets agents recall prior conversations without external RAG pipelines.",
    summary_th:
      "OpenAI ประกาศเปิดตัว GPT-5 วันนี้ มาพร้อมโมดูลความจำระยะยาวในตัว ทำให้ตัวแทน AI จำบทสนทนาเก่าได้โดยไม่ต้องใช้ระบบ RAG ภายนอก",
    category: "Agent",
    original_url: "https://openai.com/blog/gpt-5-agent-memory",
    image_url: null,
    published_date: "2026-07-03",
    inserted_at: "2026-07-03T07:05:00Z",
    body_en:
      "- Native long-term memory module ships inside GPT-5 weights.\n" +
      "- Agents can recall prior conversations without an external RAG store.\n" +
      "- Memory is encrypted at rest and tied to the user's OpenAI account.\n" +
      "- Developers can scope memory per project via the new /memory API.",
    body_th:
      "- โมดูลความจำระยะยาวฝังอยู่ในตัวโมเดล GPT-5 โดยตรง\n" +
      "- ตัวแทนจำบทสนทนาเก่าได้โดยไม่ต้องพึ่งระบบ RAG ภายนอก\n" +
      "- ความจำถูกเข้ารหัสและผูกกับบัญชีผู้ใช้ OpenAI\n" +
      "- นักพัฒนากำหนดขอบเขตความจำต่อโปรเจ็คผ่าน API /memory ใหม่",
  },
  {
    id: 2,
    title_en: "Anthropic's MCP protocol becomes an open standard",
    title_th: "โปรโตคอล MCP ของ Anthropic กลายเป็นมาตรฐานเปิด",
    summary_en:
      "The Model Context Protocol, first introduced by Anthropic in 2024, has been handed over to a new Linux Foundation working group.",
    summary_th:
      "โปรโตคอล Model Context Protocol ที่ Anthropic เปิดตัวในปี 2024 ถูกส่งต่อให้คณะทำงานใหม่ของมูลนิธิ Linux เป็นผู้ดูแล",
    category: "MCP",
    original_url: "https://www.anthropic.com/news/mcp-linux-foundation",
    image_url: null,
    published_date: "2026-07-02",
    inserted_at: "2026-07-02T18:30:00Z",
    body_en:
      "- MCP transferred to a new Linux Foundation working group.\n" +
      "- Anthropic remains a maintainer alongside Microsoft and Google.\n" +
      "- Spec, reference SDKs and conformance suite move to vendor-neutral governance.\n" +
      "- Goal: prevent any single lab from forking the protocol.",
    body_th:
      "- MCP ถูกย้ายไปอยู่ใต้คณะทำงานใหม่ของมูลนิธิ Linux\n" +
      "- Anthropic ยังเป็นผู้ดูแลร่วมกับ Microsoft และ Google\n" +
      "- สเปก SDK ตัวอย่าง และชุดทดสอบ conformance ย้ายไปอยู่ภายใต้องค์กรกลาง\n" +
      "- เป้าหมายคือป้องกันไม่ให้ห้องปฏิบัติการใด fork โปรโตคอลไปเอง",
  },
  {
    id: 3,
    title_en: "Researchers publish survey on agent memory architectures",
    title_th: "นักวิจัยตีพิมพ์บทสำรวจสถาปัตยกรรมความจำของตัวแทน AI",
    summary_en:
      "A new arXiv paper categorises 47 memory designs across episodic, semantic and procedural layers, and identifies open research gaps.",
    summary_th:
      "บทความ arXiv ใหม่จำแนกการออกแบบความจำ 47 แบบในชั้น episodic, semantic และ procedural พร้อมชี้ช่องว่างงานวิจัยที่เปิดกว้าง",
    category: "Research",
    original_url: "https://arxiv.org/abs/2026.12345",
    image_url: null,
    published_date: "2026-06-28",
    inserted_at: "2026-06-28T08:20:00Z",
    body_en:
      "- Survey categorises 47 memory designs across episodic, semantic and procedural layers.\n" +
      "- Identifies open gaps in cross-layer retrieval.\n" +
      "- Argues for a unified evaluation benchmark.\n" +
      "- Authors release reference implementations on GitHub.",
    body_th:
      "- บทสำรวจจำแนกการออกแบบความจำ 47 แบบในชั้น episodic, semantic และ procedural\n" +
      "- ชี้ช่องว่างของการค้นคืนข้ามชั้นความจำ\n" +
      "- เสนอให้มีเกณฑ์ประเมินกลางสำหรับงานวิจัยความจำตัวแทน\n" +
      "- ผู้เขียนปล่อยโค้ดอ้างอิงไว้บน GitHub ให้ทดลอง",
  },
];
