/**
 * Per-category color palette for pills, chips and accents.
 * Kept in one place so cards, the modal and the filter bar stay consistent.
 */
import type { Category } from "../lib/types";

export interface CategoryColor {
  bar: string; // top of card
  chip: string; // small pill
  ring: string; // modal accent
  text: string; // primary text color on light surface
}

const TABLE: Record<Category, CategoryColor> = {
  MCP: {
    bar: "bg-indigo-500",
    chip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200",
    ring: "ring-indigo-400",
    text: "text-indigo-600 dark:text-indigo-300",
  },
  Agent: {
    bar: "bg-emerald-500",
    chip:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
    ring: "ring-emerald-400",
    text: "text-emerald-600 dark:text-emerald-300",
  },
  Memory: {
    bar: "bg-amber-500",
    chip:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
    ring: "ring-amber-400",
    text: "text-amber-600 dark:text-amber-300",
  },
  Research: {
    bar: "bg-rose-500",
    chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
    ring: "ring-rose-400",
    text: "text-rose-600 dark:text-rose-300",
  },
};

export function categoryColor(category: Category): CategoryColor {
  return TABLE[category] ?? TABLE.Research;
}
