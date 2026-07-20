/**
 * App — the single-screen feed for AI News.
 *
 * Layout is mobile-first, 9:16 friendly. On wider screens the same column
 * is capped at `max-w-md` so the content stays readable instead of
 * stretching across a desktop monitor.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchArticles } from "./lib/supabase";
import { groupByDay } from "./lib/data";
import type {
  CategoryFilter as CategoryFilterType,
  Lang,
  UINewsArticle,
} from "./lib/types";
import { CATEGORIES } from "./lib/types";
import { T } from "./lib/i18n";
import { NewsCard } from "./components/NewsCard";
import { NewsModal } from "./components/NewsModal";
import { CategoryFilter } from "./components/CategoryFilter";
import { useTheme } from "./components/ThemeToggle";

export default function App() {
  const [articles, setArticles] = useState<UINewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [category, setCategory] = useState<CategoryFilterType>("All");
  const [query, setQuery] = useState("");
  const [openArticle, setOpenArticle] = useState<UINewsArticle | null>(null);
  const [theme, toggleTheme] = useTheme();

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

  const t = T[lang];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((a) => {
      if (category !== "All" && a.category !== category) return false;
      if (!q) return true;
      return (
        a.titleEn.toLowerCase().includes(q) ||
        a.titleTh.toLowerCase().includes(q) ||
        a.snippetEn.toLowerCase().includes(q) ||
        a.snippetTh.toLowerCase().includes(q)
      );
    });
  }, [articles, category, query]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<CategoryFilterType, number>> = {
      All: articles.length,
    };
    for (const c of CATEGORIES) counts[c] = 0;
    for (const a of articles) {
      counts[a.category] = (counts[a.category] ?? 0) + 1;
    }
    return counts;
  }, [articles]);

  const lastUpdated = articles[0]?.summarizedTime;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-50">
      {/* Hero */}
      <header className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-rose-500 text-white">
        <div className="absolute inset-0 opacity-20 [background:radial-gradient(circle_at_30%_20%,white,transparent_40%)]" />
        <div className="relative mx-auto max-w-md px-5 pb-8 pt-10 sm:max-w-lg">
          <div className="flex items-center justify-between text-xs">
            <span className="rounded-full bg-white/20 px-2.5 py-1 font-medium backdrop-blur">
              {t.hero.eyebrow}
            </span>
            <div className="flex items-center gap-1">
              <LangButton
                current={lang}
                value="en"
                label={t.controls.langEN}
                onClick={() => setLang("en")}
              />
              <LangButton
                current={lang}
                value="th"
                label={t.controls.langTH}
                onClick={() => setLang("th")}
              />
              <button
                type="button"
                onClick={toggleTheme}
                className="ml-1 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-medium backdrop-blur transition hover:bg-white/30"
                aria-label="Toggle theme"
              >
                {theme === "dark" ? "☼" : "☾"}
              </button>
            </div>
          </div>

          <h1 className="mt-5 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {t.hero.title}
          </h1>
          <p className="mt-2 text-sm text-white/85">{t.hero.subtitle}</p>

          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
            {t.hero.pill}
            {lastUpdated ? (
              <span className="text-white/70">· {lastUpdated}</span>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md px-4 pb-32 sm:max-w-lg">
        {/* Search + refresh */}
        <div className="sticky top-0 z-30 -mx-4 mt-4 bg-slate-50/95 px-4 pb-3 pt-3 backdrop-blur dark:bg-slate-950/95">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.controls.searchPlaceholder}
                className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 pl-9 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50"
              />
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="9" cy="9" r="6" />
                <path d="M14 14l4 4" strokeLinecap="round" />
              </svg>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="flex-none rounded-full bg-slate-900 px-4 py-2.5 text-xs font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {t.controls.refresh}
            </button>
          </div>

          <div className="mt-3">
            <CategoryFilter
              active={category}
              onChange={setCategory}
              lang={lang}
              counts={categoryCounts}
            />
          </div>
        </div>

        {/* Body */}
        <section className="mt-4">
          {loading ? (
            <SkeletonList lang={lang} />
          ) : error ? (
            <ErrorBlock
              lang={lang}
              message={error}
              onRetry={() => void load()}
            />
          ) : groups.length === 0 ? (
            <EmptyBlock lang={lang} />
          ) : (
            groups.map((group, gi) => (
              <div key={group.key} className="mt-5">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {gi === 0 ? t.controls.todayLabel : t.controls.earlierLabel}
                  </h2>
                  <span className="text-[10px] text-slate-400">
                    {group.label}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {group.items.map((a) => (
                    <NewsCard
                      key={a.id}
                      article={a}
                      lang={lang}
                      onOpen={setOpenArticle}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </section>

        <footer className="mt-12 text-center text-[11px] text-slate-400">
          {t.footer}
        </footer>
      </main>

      <NewsModal
        article={openArticle}
        lang={lang}
        onClose={() => setOpenArticle(null)}
      />
    </div>
  );
}

// ---- helpers --------------------------------------------------

function LangButton(props: {
  current: Lang;
  value: Lang;
  label: string;
  onClick: () => void;
}) {
  const active = props.current === props.value;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
        active
          ? "bg-white text-slate-900"
          : "text-white/80 hover:bg-white/15"
      }`}
    >
      {props.label}
    </button>
  );
}

function SkeletonList({ lang }: { lang: Lang }) {
  const t = T[lang];
  return (
    <div className="mt-2 space-y-3">
      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        {t.loading}
      </p>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        />
      ))}
    </div>
  );
}

function EmptyBlock({ lang }: { lang: Lang }) {
  const t = T[lang];
  return (
    <div className="mt-8 rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
      <p className="text-base font-semibold text-slate-700 dark:text-slate-200">
        {t.empty.title}
      </p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {t.empty.body}
      </p>
    </div>
  );
}

function ErrorBlock({
  lang,
  message,
  onRetry,
}: {
  lang: Lang;
  message: string;
  onRetry: () => void;
}) {
  const t = T[lang];
  return (
    <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900 dark:bg-rose-950/40">
      <p className="text-sm font-semibold text-rose-700 dark:text-rose-200">
        {t.error.title}
      </p>
      <p className="mt-1 text-xs text-rose-600/80 dark:text-rose-300/80">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-full bg-rose-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
      >
        {t.error.retry}
      </button>
    </div>
  );
}
