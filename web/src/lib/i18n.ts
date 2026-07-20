/**
 * UI strings for the AI News SPA, bilingual (en / th).
 *
 * Keep the shape flat — components should be able to import only what
 * they need (e.g. `T.hero.title[lang]`).
 */
import type { Lang } from "./types";

interface Dict {
  nav: {
    home: string;
    categories: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    pill: string;
  };
  controls: {
    todayLabel: string;
    earlierLabel: string;
    all: string;
    searchPlaceholder: string;
    refresh: string;
    themeLight: string;
    themeDark: string;
    langEN: string;
    langTH: string;
  };
  empty: {
    title: string;
    body: string;
  };
  loading: string;
  error: {
    title: string;
    retry: string;
  };
  card: {
    readMore: string;
    source: string;
  };
  detail: {
    summaryEn: string;
    summaryTh: string;
    highlightsEn: string;
    highlightsTh: string;
    openOriginal: string;
    close: string;
  };
  footer: string;
}

export const T: Record<Lang, Dict> = {
  en: {
    nav: { home: "Home", categories: "Categories" },
    hero: {
      eyebrow: "AI Pulse",
      title: "AI News, decoded.",
      subtitle:
        "Bite-sized, bilingual digests of the most important stories — refreshed every morning.",
      pill: "Updated daily",
    },
    controls: {
      todayLabel: "Today",
      earlierLabel: "Earlier",
      all: "All",
      searchPlaceholder: "Search headlines…",
      refresh: "Refresh",
      themeLight: "Light",
      themeDark: "Dark",
      langEN: "EN",
      langTH: "TH",
    },
    empty: {
      title: "Nothing here yet",
      body: "Once the digest pipeline runs, headlines will appear here.",
    },
    loading: "Loading the latest pulse…",
    error: {
      title: "Couldn't reach the feed",
      retry: "Try again",
    },
    card: {
      readMore: "Read digest",
      source: "Source",
    },
    detail: {
      summaryEn: "English summary",
      summaryTh: "Thai summary",
      highlightsEn: "Key highlights",
      highlightsTh: "ประเด็นสำคัญ",
      openOriginal: "Open original article",
      close: "Close",
    },
    footer: "Powered by OpenClaw · Supabase",
  },
  th: {
    nav: { home: "หน้าหลัก", categories: "หมวดหมู่" },
    hero: {
      eyebrow: "AI Pulse",
      title: "สรุปข่าว AI ฉบับเข้าใจง่าย",
      subtitle:
        "สรุปข่าว AI สำคัญ ๆ เป็นภาษาไทยและอังกฤษ อัปเดตทุกเช้า",
      pill: "อัปเดตทุกวัน",
    },
    controls: {
      todayLabel: "วันนี้",
      earlierLabel: "ก่อนหน้านี้",
      all: "ทั้งหมด",
      searchPlaceholder: "ค้นหาหัวข้อข่าว…",
      refresh: "รีเฟรช",
      themeLight: "สว่าง",
      themeDark: "มืด",
      langEN: "EN",
      langTH: "TH",
    },
    empty: {
      title: "ยังไม่มีข่าว",
      body: "เมื่อ pipeline ทำงาน ข่าวจะปรากฏที่นี่",
    },
    loading: "กำลังโหลดข่าวล่าสุด…",
    error: {
      title: "โหลดข่าวไม่สำเร็จ",
      retry: "ลองอีกครั้ง",
    },
    card: {
      readMore: "อ่านสรุป",
      source: "แหล่งข่าว",
    },
    detail: {
      summaryEn: "สรุปภาษาอังกฤษ",
      summaryTh: "สรุปภาษาไทย",
      highlightsEn: "ประเด็นสำคัญ",
      highlightsTh: "ประเด็นสำคัญ",
      openOriginal: "เปิดบทความต้นฉบับ",
      close: "ปิด",
    },
    footer: "ขับเคลื่อนโดย OpenClaw · Supabase",
  },
};
