import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchArticles } from "./lib/supabase";
import type { Lang, UINewsArticle, CategoryFilter as CategoryFilterType } from "./lib/types";

import { 
  Globe, 
  Moon, 
  Sun, 
  Search, 
  Info, 
  ExternalLink, 
  X, 
  Clipboard, 
  Check, 
  RefreshCw 
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function App() {
  const [articles, setArticles] = useState<UINewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilterType>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeArticle, setActiveArticle] = useState<UINewsArticle | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });
  const [copied, setCopied] = useState(false);

  // Sync theme class with document element
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Load articles from Supabase
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchArticles(100);
      setArticles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);



  // Filtered articles based on search & category
  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return articles.filter((a) => {
      if (selectedCategory !== "All" && a.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        a.titleEn.toLowerCase().includes(q) ||
        a.titleTh.toLowerCase().includes(q) ||
        a.snippetEn.toLowerCase().includes(q) ||
        a.snippetTh.toLowerCase().includes(q)
      );
    });
  }, [articles, selectedCategory, searchQuery]);

  // Get active translation fields
  const getArticleTranslation = (art: UINewsArticle) => {
    const isTh = lang === 'th';
    return {
      title: isTh ? art.titleTh : art.titleEn,
      summary: isTh ? art.executiveSummaryTh : art.executiveSummaryEn,
      highlights: isTh ? art.keyHighlightsTh : art.keyHighlightsEn,
      trends: isTh ? art.trendsOverviewTh : art.trendsOverviewEn,
    };
  };

  // Helper: calculate reading time dynamically
  const calculateReadingTime = (art: UINewsArticle): number => {
    const { title, summary, highlights, trends } = getArticleTranslation(art);
    const highlightText = highlights.map(h => h.title).join(' ');
    const trendText = trends.join(' ');
    const totalWords = `${title} ${summary} ${highlightText} ${trendText}`.trim().split(/\s+/).length;
    // Assume average reading speed of 180 words per minute
    return Math.max(1, Math.ceil(totalWords / 180));
  };

  // Helper: get category color styles
  const getCategoryStyles = (category: string) => {
    switch (category) {
      case 'Agent':
        return {
          bg: 'bg-indigo-50 dark:bg-indigo-950/40',
          text: 'text-indigo-600 dark:text-indigo-400',
          border: 'border-indigo-200 dark:border-indigo-900',
          dot: 'bg-indigo-500'
        };
      case 'memory':
      case 'Memory':
        return {
          bg: 'bg-amber-50 dark:bg-amber-950/40',
          text: 'text-amber-600 dark:text-amber-400',
          border: 'border-amber-200 dark:border-amber-900',
          dot: 'bg-amber-500'
        };
      case 'MCP':
        return {
          bg: 'bg-rose-50 dark:bg-rose-950/40',
          text: 'text-rose-600 dark:text-rose-400',
          border: 'border-rose-200 dark:border-rose-900',
          dot: 'bg-rose-500'
        };
      case 'Research':
      default:
        return {
          bg: 'bg-emerald-50 dark:bg-emerald-950/40',
          text: 'text-emerald-600 dark:text-emerald-400',
          border: 'border-emerald-200 dark:border-emerald-900',
          dot: 'bg-emerald-500'
        };
    }
  };

  // Extract related articles in same category
  const relatedArticles = useMemo(() => {
    if (!activeArticle) return [];
    return articles
      .filter((a) => a.category === activeArticle.category && a.id !== activeArticle.id)
      .slice(0, 2);
  }, [activeArticle, articles]);

  // Copy Summary formatting logic
  const handleCopySummary = (art: UINewsArticle) => {
    const isTh = lang === 'th';
    const title = isTh ? art.titleTh : art.titleEn;
    const summary = isTh ? art.executiveSummaryTh : art.executiveSummaryEn;
    const highlights = isTh ? art.keyHighlightsTh : art.keyHighlightsEn;
    const trends = isTh ? art.trendsOverviewTh : art.trendsOverviewEn;
    const publishedDate = art.publishedDate;
    const summarizedTime = art.summarizedTime;
    const minRead = calculateReadingTime(art);

    // Format metadata
    const metaLine = isTh 
      ? `วันที่เผยแพร่: ${publishedDate}—สรุปโดย AI: ${summarizedTime}—${minRead} min read`
      : `Published: ${publishedDate}—AI Summary: ${summarizedTime}—${minRead} min read`;

    // Highlights
    const highlightHeader = isTh ? 'โครงสร้างวิเคราะห์จุดต่อจุดโดยละเอียด' : 'Detailed Analysis';
    const formattedHighlights = highlights
      .map((h) => {
        const titleText = h.title.includes('：') ? h.title.split('：')[0] + '…' : h.title.slice(0, 30) + '…';
        return `${titleText}\n${h.title}`;
      })
      .join('\n\n');

    // Trends
    const trendsHeader = isTh ? 'นัยสำคัญเชิงกลยุทธ์และผลกระทบตลาด' : 'Strategic Implications & Market Impact';
    const formattedTrends = trends.map((t) => `${t}`).join('\n');

    // Pull quote from second trend if available, else first
    const pullQuote = trends.length >= 2 ? trends[1] : (trends.length > 0 ? trends[0] : '');
    const formattedQuote = pullQuote ? `\n“${pullQuote}”\n` : '';

    const textToCopy = `${title}
${metaLine}
${summary}
${formattedQuote}
${highlightHeader}
${formattedHighlights}

${trendsHeader}
${formattedTrends}`;

    void navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#fffbfb] text-black dark:bg-[#090a0f] dark:text-[#f3f4f6] font-sans transition-colors duration-300">
      {/* Upper Navigation Row */}
      <header className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center border-b border-black/10 dark:border-zinc-800/80">
        <div className="font-mono text-xs tracking-wider uppercase opacity-60">
          {lang === 'en' ? 'OpenClaw System' : 'ระบบ OpenClaw'}
        </div>
        <div className="flex items-center gap-3">
          {/* Language Switcher */}
          <button
            onClick={() => setLang(lang === 'en' ? 'th' : 'en')}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono border border-black dark:border-zinc-700 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all active:scale-95 text-black dark:text-zinc-200 bg-white dark:bg-[#111218]"
            title={lang === 'en' ? 'Switch to Thai' : 'เปลี่ยนเป็นอังกฤษ'}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>{lang === 'en' ? 'TH' : 'EN'}</span>
          </button>

          {/* Theme Switcher */}
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="px-3 py-1 text-xs font-mono border border-black dark:border-zinc-700 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all active:scale-95 text-black dark:text-zinc-200 flex items-center gap-1.5 bg-white dark:bg-[#111218]"
            title={theme === 'light' ? 'Activate Dark Mode' : 'Activate Light Mode'}
          >
            {theme === 'light' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {!activeArticle ? (
            <motion.div
              key="feed-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Wireframe Centered Block Layout */}
              <div 
                className="border-4 border-black dark:border-zinc-100 p-6 md:p-8 rounded-lg mb-8 text-center bg-white dark:bg-[#111218] shadow-lg transition-transform duration-300 hover:scale-[1.01]" 
                style={theme === 'light' ? { backgroundColor: '#fffbfb' } : undefined}
              >
                <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight mb-2 uppercase select-none text-black dark:text-white">
                  {lang === 'en' ? 'Agentic AI News' : 'ข่าวกรอง AI อัจฉริยะ'}
                </h1>
                <p className="font-sans text-sm sm:text-base md:text-lg font-medium text-black/80 dark:text-zinc-400 capitalize max-w-2xl mx-auto">
                  {lang === 'en' ? 'Curation and detailed analysis by Autonomous Agents' : 'วิเคราะห์เจาะลึกข่าวสารความเคลื่อนไหววงการปัญญาประดิษฐ์โดย AI Agents'}
                </p>
                <div className="h-1.5 w-16 bg-[#0066cc] dark:bg-emerald-400 mx-auto my-4 rounded-full"></div>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-500 italic max-w-lg mx-auto">
                  {lang === 'en' ? 'Delivering concise, formatted intelligence daily' : 'คัดกรองข่าวสำคัญ ย่อยข้อมูล ประเมินผลกระทบเสร็จสรรพในหน้าเดียว'}
                </p>
              </div>

              {/* Action Controls Panel */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center mb-6">
                {/* Categories Selector list */}
                <div className="md:col-span-8 overflow-x-auto scrollbar-none py-1 flex gap-2 select-none">
                  {(['All', 'Agent', 'Memory', 'MCP', 'Research'] as CategoryFilterType[]).map((cat) => {
                    const active = selectedCategory === cat;
                    const catLabel = cat === 'All' ? (lang === 'en' ? 'All' : 'ทั้งหมด') : cat;
                    return (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-3 py-1.5 rounded-full text-xs font-mono font-medium border transition-all shrink-0 active:scale-95 ${
                          active
                            ? 'bg-black border-black text-white dark:bg-white dark:border-white dark:text-[#090a0f] shadow-md scale-105'
                            : 'border-black text-black hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900'
                        }`}
                      >
                        [{catLabel}]
                      </button>
                    );
                  })}
                </div>

                {/* Search bar */}
                <div className="md:col-span-4 relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 dark:text-zinc-500" />
                  <input
                    type="text"
                    placeholder={lang === 'en' ? 'Search headlines...' : 'ค้นหาข่าวสำคัญ...'}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full text-xs py-2 pl-9 pr-4 rounded-full border border-black dark:border-zinc-800 bg-white dark:bg-[#111218] text-black dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white transition-all shadow-inner"
                  />
                </div>
              </div>

              {/* Quick Instructions & Utility Bar */}
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 p-3 bg-white dark:bg-[#111218] border border-black dark:border-zinc-800 rounded-lg">
                <div className="flex items-start gap-2 max-w-[80%]">
                  <Info className="h-4 w-4 text-black/80 dark:text-zinc-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] leading-relaxed text-black/80 dark:text-zinc-400">
                    <span className="font-bold">{lang === 'en' ? 'Instructions' : 'คำแนะนำ'}:</span> {lang === 'en' ? 'Click "Read Summary" on any card to view detailed key highlights, strategic implications and formatted pull quotes.' : 'คลิกปุ่ม "อ่านบทสรุป" ในการ์ดข่าวที่คุณสนใจเพื่ออ่านสรุปแบบวิเคราะห์เจาะลึกนัยสำคัญเชิงกลยุทธ์'}
                  </div>
                </div>
                
                <button
                  onClick={load}
                  disabled={loading}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-black text-white hover:bg-zinc-900/80 dark:bg-emerald-400 dark:text-[#090a0f] dark:hover:bg-emerald-300 text-[11px] font-mono border border-black dark:border-emerald-400 transition-all disabled:opacity-50 active:scale-95 cursor-pointer shadow-md font-semibold"
                >
                  <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                  <span>{lang === 'en' ? 'REFRESH' : 'รีเฟรช'}</span>
                </button>
              </div>

              {/* Feed Card Grid */}
              {loading ? (
                <div className="text-center py-20 font-mono text-sm opacity-60">
                  <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
                  Loading pipeline data...
                </div>
              ) : error ? (
                <div className="p-6 border-2 border-red-500 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 font-mono text-xs rounded-lg">
                  ❌ Error loading from database: {error}
                </div>
              ) : filteredArticles.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-black/30 dark:border-zinc-800 rounded-lg text-sm text-zinc-500">
                  {lang === 'en' ? 'No articles found matching the filters.' : 'ไม่พบข่าวสารในหมวดหมู่หรือคำค้นหาที่เลือก'}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {filteredArticles.map((art) => {
                    const trans = getArticleTranslation(art);
                    const styles = getCategoryStyles(art.category);
                    
                    return (
                      <article
                        key={art.id}
                        className="group border border-black dark:border-zinc-800 hover:border-black dark:hover:border-zinc-300 rounded-lg p-5 md:p-6 bg-white dark:bg-[#111218] transition-all hover:shadow-xl hover:translate-y-[-2px] relative cursor-pointer flex flex-col justify-between"
                        onClick={() => setActiveArticle(art)}
                      >
                        <div>
                          {/* Card Header Row */}
                          <div className="flex justify-between items-center mb-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${styles.bg} ${styles.text} ${styles.border}`}>
                              {art.category}
                            </span>
                            <span className="text-[10px] font-mono text-zinc-400 flex items-center gap-1.5">
                              <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
                              {art.publishedDate}
                            </span>
                          </div>

                          {/* Card Media Preview */}
                          {art.imageUrl && (
                            <div className="w-full h-36 overflow-hidden rounded border border-black/10 dark:border-zinc-800 mb-3 bg-zinc-100 dark:bg-zinc-900">
                              <img 
                                src={art.imageUrl} 
                                alt={trans.title}
                                className="w-full h-full object-cover grayscale contrast-[1.1] dark:contrast-[1.2] transition-transform duration-300 group-hover:scale-105"
                                loading="lazy"
                              />
                            </div>
                          )}

                          {/* Card Content */}
                          <h2 className="font-display font-bold text-base leading-snug mb-2 group-hover:text-[#0066cc] dark:group-hover:text-emerald-400 transition-colors line-clamp-2">
                            {trans.title}
                          </h2>
                          <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-3 mb-4 leading-relaxed">
                            {trans.summary || art.snippetEn}
                          </p>
                        </div>

                        {/* Card Footer Actions */}
                        <div className="flex justify-between items-center pt-2 border-t border-dashed border-black/10 dark:border-zinc-800/80">
                          <button
                            className="text-xs font-mono font-bold border-b border-dashed border-black hover:border-solid dark:border-zinc-400 select-none pb-0.5"
                          >
                            [{lang === 'en' ? 'Read Summary' : 'อ่านบทสรุป'}]
                          </button>
                          
                          {art.originalSourceUrl && (
                            <a
                              href={art.originalSourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[10px] font-mono text-[#0066cc] dark:text-emerald-400 hover:underline flex items-center gap-0.5"
                            >
                              <span>Source</span>
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </motion.div>
          ) : (
            /* Redesigned Article Detail View (Fullscreen Style) */
            <motion.div
              key="detail-view"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              transition={{ duration: 0.25 }}
              className="border-2 border-black dark:border-zinc-700 bg-white dark:bg-[#111218] p-6 md:p-10 rounded-lg shadow-2xl relative"
            >
              {/* Back Link Button */}
              <button
                onClick={() => setActiveArticle(null)}
                className="absolute top-4 right-4 md:top-6 md:right-6 p-2 rounded-full border border-black/20 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800 text-black dark:text-white transition-all cursor-pointer active:scale-95"
                title={lang === 'en' ? 'Back to Feed' : 'กลับหน้าหลัก'}
              >
                <X className="h-4 w-4" />
              </button>

              {/* Category & Time Row */}
              <div className="flex items-center gap-2 mb-4">
                <span className={`px-2.5 py-0.5 rounded text-xs font-mono border ${getCategoryStyles(activeArticle.category).bg} ${getCategoryStyles(activeArticle.category).text} ${getCategoryStyles(activeArticle.category).border}`}>
                  {activeArticle.category}
                </span>
              </div>

              {/* Title Section */}
              <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight mb-3">
                {lang === 'th' ? activeArticle.titleTh : activeArticle.titleEn}
              </h1>

              {/* Metadata line (Restructured) */}
              <div className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 mb-6 pb-4 border-b border-black/10 dark:border-zinc-800/80 flex flex-wrap gap-x-2 gap-y-1 items-center">
                <span>{lang === 'th' ? 'วันที่เผยแพร่' : 'Published'}: {activeArticle.publishedDate}</span>
                <span className="opacity-40">—</span>
                <span>{lang === 'th' ? 'สรุปโดย AI' : 'AI Summary'}: {activeArticle.summarizedTime}</span>
                <span className="opacity-40">—</span>
                <span className="font-semibold">{calculateReadingTime(activeArticle)} min read</span>
              </div>

              {/* Detailed Content Grid Layout */}
              <div className="space-y-6">
                {/* 1. Executive Summary Paragraph */}
                <div>
                  <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                    {lang === 'th' ? activeArticle.executiveSummaryTh : activeArticle.executiveSummaryEn}
                  </p>
                </div>

                {/* 2. Pull Quote Section (Dynamically Extracted Quote) */}
                {(() => {
                  const trends = lang === 'th' ? activeArticle.trendsOverviewTh : activeArticle.trendsOverviewEn;
                  const quote = trends.length >= 2 ? trends[1] : (trends.length > 0 ? trends[0] : '');
                  if (!quote) return null;
                  return (
                    <div className="py-6 my-2 border-t border-b border-black/10 dark:border-zinc-800/80 text-center">
                      <p className="font-display text-base md:text-lg italic font-semibold text-zinc-900 dark:text-zinc-100 max-w-2xl mx-auto leading-normal">
                        “{quote}”
                      </p>
                    </div>
                  );
                })()}

                {/* 3. Detailed Key Highlights List */}
                {(() => {
                  const highlights = lang === 'th' ? activeArticle.keyHighlightsTh : activeArticle.keyHighlightsEn;
                  if (highlights.length === 0) return null;
                  return (
                    <div>
                      <h2 className="font-mono text-xs uppercase tracking-wider font-bold mb-3 text-[#0066cc] dark:text-emerald-400">
                        {lang === 'th' ? 'โครงสร้างวิเคราะห์จุดต่อจุดโดยละเอียด' : 'Detailed Analysis'}
                      </h2>
                      <ul className="space-y-4">
                        {highlights.map((h, idx) => {
                          const titleText = h.title.includes('：') ? h.title.split('：')[0] + '…' : h.title.slice(0, 30) + '…';
                          return (
                            <li key={idx} className="flex gap-4 items-start text-xs sm:text-sm text-zinc-700 dark:text-zinc-300">
                              <span className="flex-none font-mono font-bold text-xs bg-black text-white dark:bg-white dark:text-[#090a0f] h-5 w-5 rounded flex items-center justify-center mt-0.5">
                                {idx + 1}
                              </span>
                              <div className="leading-relaxed">
                                <span className="font-bold text-black dark:text-white block mb-0.5">{titleText}</span>
                                <span>{h.title}</span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })()}

                {/* 4. Strategic Implications List */}
                {(() => {
                  const trends = lang === 'th' ? activeArticle.trendsOverviewTh : activeArticle.trendsOverviewEn;
                  if (trends.length === 0) return null;
                  return (
                    <div>
                      <h2 className="font-mono text-xs uppercase tracking-wider font-bold mb-3 text-[#0066cc] dark:text-emerald-400">
                        {lang === 'th' ? 'นัยสำคัญเชิงกลยุทธ์และผลกระทบตลาด' : 'Strategic Implications & Market Impact'}
                      </h2>
                      <ul className="space-y-2 list-none">
                        {trends.map((trendText, idx) => (
                          <li key={idx} className="flex gap-2.5 items-start text-xs sm:text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                            <span className="text-[#0066cc] dark:text-emerald-400 font-bold select-none">•</span>
                            <span>{trendText}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {/* 5. More in Category Section */}
                {relatedArticles.length > 0 && (
                  <div className="pt-8 border-t border-black/10 dark:border-zinc-800/80">
                    <h3 className="font-mono text-xs uppercase tracking-wider font-bold mb-4 opacity-75">
                      {lang === 'en' ? `More in ${activeArticle.category}` : `ข่าวแนะนำในหมวดหมู่ ${activeArticle.category}`}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {relatedArticles.map((rel) => {
                        const relTitle = lang === 'th' ? rel.titleTh : rel.titleEn;
                        return (
                          <div 
                            key={rel.id}
                            onClick={() => {
                              setActiveArticle(rel);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="p-4 border border-black/10 dark:border-zinc-800 hover:border-black dark:hover:border-zinc-500 rounded bg-[#fffbfb] dark:bg-[#0d0e14] cursor-pointer transition-colors flex flex-col justify-between"
                          >
                            <h4 className="font-sans font-bold text-xs line-clamp-2 mb-2 text-black dark:text-white hover:text-[#0066cc] dark:hover:text-emerald-400">
                              {relTitle}
                            </h4>
                            <div className="font-mono text-[9px] text-zinc-400">
                              {rel.publishedDate}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 6. Footer Button Bar (Source, Copy & Close) */}
                <div className="flex flex-wrap gap-3 pt-6 border-t border-black/10 dark:border-zinc-800/80">
                  {/* Read Original Source Link */}
                  {activeArticle.originalSourceUrl && (
                    <a
                      href={activeArticle.originalSourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 border border-black dark:border-zinc-700 font-mono text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800 text-black dark:text-zinc-200 transition-all flex items-center gap-1.5 rounded"
                    >
                      <span>{lang === 'en' ? 'Read Original Source' : 'อ่านแหล่งข้อมูลต้นฉบับ'}</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}

                  {/* Copy Summary Button */}
                  <button
                    onClick={() => handleCopySummary(activeArticle)}
                    className="px-4 py-2 border border-black dark:border-zinc-700 bg-white dark:bg-[#111218] font-mono text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800 text-black dark:text-zinc-200 transition-all flex items-center gap-1.5 rounded active:scale-95"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        <span>{lang === 'en' ? 'COPIED!' : 'คัดลอกแล้ว!'}</span>
                      </>
                    ) : (
                      <>
                        <Clipboard className="h-3.5 w-3.5" />
                        <span>{lang === 'en' ? 'COPY SUMMARY' : 'คัดลอกบทสรุป'}</span>
                      </>
                    )}
                  </button>

                  {/* Close and Back to Home */}
                  <button
                    onClick={() => setActiveArticle(null)}
                    className="px-4 py-2 bg-black text-white hover:bg-zinc-900 dark:bg-white dark:text-[#090a0f] dark:hover:bg-zinc-200 font-mono text-xs font-bold transition-all ml-auto rounded"
                  >
                    [{lang === 'en' ? 'Back to Home' : 'กลับหน้าหลัก'}]
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
