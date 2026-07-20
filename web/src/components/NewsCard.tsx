/**
 * NewsCard — the primary surface of the feed.
 *
 * Mobile-first 9:16 aspect ratio. Shows the title in both languages,
 * a snippet in the active language, and a small footer with category
 * + summarized time.
 */
import type { Lang, UINewsArticle } from "../lib/types";
import { T } from "../lib/i18n";
import { categoryColor } from "./categoryColor";

interface Props {
  article: UINewsArticle;
  lang: Lang;
  onOpen: (a: UINewsArticle) => void;
}

export function NewsCard({ article, lang, onOpen }: Props) {
  const t = T[lang];
  const title = lang === "th" ? article.titleTh : article.titleEn;
  const snippet = lang === "th" ? article.snippetTh : article.snippetEn;
  const color = categoryColor(article.category);

  return (
    <button
      type="button"
      onClick={() => onOpen(article)}
      className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
    >
      {/* Top color band */}
      <div className={`h-1 w-full ${color.bar}`} aria-hidden />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between text-xs">
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${color.chip}`}
          >
            #{article.category}
          </span>
          <time className="text-slate-500 dark:text-slate-400">
            {article.summarizedTime || article.publishedDate}
          </time>
        </div>

        <h3 className="line-clamp-3 text-base font-semibold leading-snug text-slate-900 group-hover:text-indigo-600 dark:text-slate-50 dark:group-hover:text-indigo-300">
          {title}
        </h3>

        {snippet ? (
          <p className="line-clamp-3 text-sm text-slate-600 dark:text-slate-300">
            {snippet}
          </p>
        ) : null}

        <div className="mt-auto flex items-center justify-between pt-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            {t.card.readMore} →
          </span>
          {article.originalSourceUrl ? (
            <span className="max-w-[50%] truncate text-slate-400 dark:text-slate-500">
              {safeHost(article.originalSourceUrl)}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
