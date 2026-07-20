/**
 * NewsModal — full-detail view for a single article.
 * Mobile-first 9:16 layout with bilingual summary + key highlights.
 */
import { useEffect } from "react";
import type { Lang, UINewsArticle } from "../lib/types";
import { T } from "../lib/i18n";
import { categoryColor } from "./categoryColor";

interface Props {
  article: UINewsArticle | null;
  lang: Lang;
  onClose: () => void;
}

export function NewsModal({ article, lang, onClose }: Props) {
  useEffect(() => {
    if (!article) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [article, onClose]);

  if (!article) return null;
  const t = T[lang];
  const color = categoryColor(article.category);
  const title = lang === "th" ? article.titleTh : article.titleEn;
  const summary = lang === "th" ? article.executiveSummaryTh : article.executiveSummaryEn;
  const highlights =
    lang === "th" ? article.keyHighlightsTh : article.keyHighlightsEn;
  const titleSecondary = lang === "th" ? article.titleEn : article.titleTh;
  const summarySecondary =
    lang === "th" ? article.executiveSummaryEn : article.executiveSummaryTh;
  const highlightsSecondary =
    lang === "th" ? article.keyHighlightsEn : article.keyHighlightsTh;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/70 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-4"
      onClick={onClose}
    >
      <article
        onClick={(e) => e.stopPropagation()}
        className={`relative flex max-h-[95vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800 sm:max-h-[85vh] sm:max-w-md sm:rounded-3xl ${color.ring} ring-1`}
      >
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${color.chip}`}
            >
              #{article.category}
            </span>
            <time className="text-xs text-slate-500 dark:text-slate-400">
              {article.summarizedTime || article.publishedDate}
            </time>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label={t.detail.close}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <h2 className="text-lg font-semibold leading-snug text-slate-900 dark:text-slate-50">
            {title}
          </h2>
          {titleSecondary && titleSecondary !== title ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {titleSecondary}
            </p>
          ) : null}

          {/* Executive summary */}
          {summary ? (
            <section className="mt-5">
              <h3 className={`text-xs font-semibold uppercase tracking-wide ${color.text}`}>
                {lang === "th" ? t.detail.summaryTh : t.detail.summaryEn}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {summary}
              </p>
              {summarySecondary && summarySecondary !== summary ? (
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {summarySecondary}
                </p>
              ) : null}
            </section>
          ) : null}

          {/* Key highlights */}
          {highlights.length > 0 ? (
            <section className="mt-5">
              <h3 className={`text-xs font-semibold uppercase tracking-wide ${color.text}`}>
                {lang === "th" ? t.detail.highlightsTh : t.detail.highlightsEn}
              </h3>
              <ul className="mt-2 space-y-2">
                {highlights.map((h, i) => (
                  <li
                    key={i}
                    className="flex gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <span
                      className={`mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-semibold text-white ${color.bar}`}
                    >
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{h.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Source link */}
          {article.originalSourceUrl ? (
            <a
              href={article.originalSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900 ${color.text}`}
            >
              {t.detail.openOriginal}
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  d="M7 5h8v8M15 5L5 15"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          ) : null}

          {/* Secondary-language highlights (always show at the bottom) */}
          {highlightsSecondary.length > 0 && highlightsSecondary !== highlights ? (
            <section className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {lang === "th" ? t.detail.highlightsEn : t.detail.highlightsTh}
              </h3>
              <ul className="mt-2 space-y-1.5">
                {highlightsSecondary.map((h, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-sm text-slate-600 dark:text-slate-400"
                  >
                    <span className="text-slate-400">•</span>
                    <span className="leading-relaxed">{h.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </article>
    </div>
  );
}
