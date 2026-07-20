/**
 * CategoryFilter — horizontal chip row for filtering by topic.
 * Uses the same palette as the cards / modal accents.
 */
import type { CategoryFilter, Lang } from "../lib/types";
import { CATEGORIES } from "../lib/types";
import { T } from "../lib/i18n";
import { categoryColor } from "./categoryColor";

interface Props {
  active: CategoryFilter;
  onChange: (next: CategoryFilter) => void;
  lang: Lang;
  counts?: Partial<Record<CategoryFilter, number>>;
}

export function CategoryFilter({ active, onChange, lang, counts }: Props) {
  const t = T[lang];
  const all: CategoryFilter[] = ["All", ...CATEGORIES];

  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {all.map((cat) => {
        const isActive = cat === active;
        const color =
          cat === "All"
            ? {
                active: "bg-slate-900 text-white dark:bg-slate-50 dark:text-slate-900",
                idle: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
              }
            : {
                active: `${categoryColor(cat).bar} text-white`,
                idle: `${categoryColor(cat).chip}`,
              };
        const count = counts?.[cat];
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onChange(cat)}
            className={`flex-none rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              isActive ? color.active : color.idle
            }`}
          >
            {cat === "All" ? t.controls.all : `#${cat}`}
            {typeof count === "number" && count > 0 ? (
              <span className="ml-1.5 text-[10px] opacity-70">{count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
