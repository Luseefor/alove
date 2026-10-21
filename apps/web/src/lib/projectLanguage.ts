import {
  parseBibEntries,
  parseTexLabels,
  type ProjectCiteEntry,
  type ProjectLabelEntry,
} from "@alove/editor";

export type { ProjectCiteEntry, ProjectLabelEntry };

export type ProjectLanguageIndex = {
  citations: ProjectCiteEntry[];
  labels: ProjectLabelEntry[];
};

function isTexPath(path: string): boolean {
  return path.toLowerCase().endsWith(".tex");
}

function isBibPath(path: string): boolean {
  return path.toLowerCase().endsWith(".bib");
}

/**
 * Build the project-wide cite/ref index from the workbench file map.
 * `.bib` files feed citations (key + title/author/year metadata);
 * `.tex` files feed `\label{}` entries with file + section/caption context.
 * First occurrence wins for duplicate keys; output is stably sorted.
 */
export function buildProjectLanguageIndex(
  filesByPath: Record<string, string>,
): ProjectLanguageIndex {
  const citations: ProjectCiteEntry[] = [];
  const seenCite = new Set<string>();
  const labels: ProjectLabelEntry[] = [];
  const seenLabel = new Set<string>();

  const paths = Object.keys(filesByPath).sort();
  for (const path of paths) {
    const content = filesByPath[path];
    if (typeof content !== "string") continue;
    // Skip binary data-url previews.
    if (content.startsWith("data:")) continue;
    if (isBibPath(path)) {
      for (const entry of parseBibEntries(content)) {
        if (!entry.key || seenCite.has(entry.key)) continue;
        seenCite.add(entry.key);
        citations.push(entry);
      }
    } else if (isTexPath(path)) {
      for (const entry of parseTexLabels(content, path)) {
        const token = `${entry.label}\0${entry.file ?? ""}`;
        if (seenLabel.has(token)) continue;
        seenLabel.add(token);
        labels.push(entry);
      }
    }
  }

  citations.sort((a, b) => a.key.localeCompare(b.key));
  labels.sort((a, b) => a.label.localeCompare(b.label));
  return { citations, labels };
}

/** Filter citations by a free-text query (key/title/author/year). */
export function filterCitations(
  citations: ProjectCiteEntry[],
  query: string,
): ProjectCiteEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return citations;
  return citations.filter((entry) =>
    [entry.key, entry.title, entry.author, entry.year]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}

/** Filter labels by key/context/file text. */
export function filterLabels(
  labels: ProjectLabelEntry[],
  query: string,
): ProjectLabelEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return labels;
  return labels.filter((entry) =>
    [entry.label, entry.context, entry.file]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}
