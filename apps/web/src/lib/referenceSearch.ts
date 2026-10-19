import type { BibEntry } from "@/services/BibliographyService";

export function matchesReference(
  entry: BibEntry,
  query: string,
  mode: "default" | "fuzzy" | "bibtex",
): boolean {
  const needle = query.trim();
  if (!needle) return true;
  if (mode === "bibtex") return entry.id === needle;
  const text = [entry.id, entry.title, entry.author, entry.year]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  const tokens = needle.toLocaleLowerCase().split(/\s+/);
  if (mode === "default") return tokens.every((token) => text.includes(token));
  return tokens.every((token) => {
    let from = 0;
    for (const char of token) {
      const index = text.indexOf(char, from);
      if (index < 0) return false;
      from = index + char.length;
    }
    return true;
  });
}
