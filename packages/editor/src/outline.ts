export interface OutlineHeading {
  level: number;
  title: string;
  from: number;
  to: number;
}

const sectionRe =
  /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{([^}]*)\}/;

export function parseLatexOutline(doc: string): OutlineHeading[] {
  const lines = doc.split("\n");
  const headings: OutlineHeading[] = [];
  let offset = 0;
  for (const line of lines) {
    const m = line.match(sectionRe);
    if (m) {
      const cmd = m[1]!.toLowerCase();
      const title = m[2]!.trim();
      const level =
        cmd === "part" || cmd === "chapter"
          ? 1
          : cmd === "section"
            ? 2
            : cmd === "subsection"
              ? 3
              : cmd === "subsubsection"
                ? 4
                : 5;
      const from = offset;
      const to = offset + line.length;
      headings.push({ level, title, from, to });
    }
    offset += line.length + 1;
  }
  return headings;
}
