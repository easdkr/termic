import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Combine conditional Tailwind classes; later wins on conflicts. */
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

/** "user input" → "user-input"; strips diacritics-ish + lowercases. */
export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Truncate path to "…/last/two/segments" when it gets long. */
export function shortPath(p: string, segments = 2) {
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= segments) return p;
  return "…/" + parts.slice(-segments).join("/");
}
