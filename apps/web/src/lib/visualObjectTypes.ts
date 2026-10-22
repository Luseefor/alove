import { escapeVisualText } from "@alove/editor";

export type VisualSourcePatch = { from: number; to: number; insert: string };
export type VisualObjectBase = {
  kind: "table" | "figure" | "math" | "citation" | "reference";
  from: number;
  to: number;
  source: string;
};
export type TexGroup = {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  value: string;
};

/** Conservative bounded group reader. Offsets are relative to its source argument. */
export function readTexGroup(source: string, from: number): TexGroup | null {
  if (source[from] !== "{" || source.length > 131072) return null;
  let depth = 1;
  for (let i = from + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "%") {
      const end = source.indexOf("\n", i);
      if (end < 0) return null;
      i = end;
      continue;
    }
    if (char === "{") {
      if (++depth > 64) return null;
    }
    if (char === "}" && --depth === 0)
      return {
        from,
        to: i + 1,
        contentFrom: from + 1,
        contentTo: i,
        value: source.slice(from + 1, i),
      };
  }
  return null;
}
export function encodeVisualProse(value: string): string {
  return escapeVisualText(value);
}
export function decodeVisualProse(value: string): string | null {
  const decoded = value.replace(
    /\\(?:textbackslash\{\}|textasciitilde\{\}|textasciicircum\{\}|[%&#_${}])/g,
    (token) =>
      token === "\\textbackslash{}"
        ? "\u0001"
        : token === "\\textasciitilde{}"
          ? "~"
          : token === "\\textasciicircum{}"
            ? "^"
            : token.slice(1),
  );
  if (
    /[\\{}$%&#_^~]/.test(
      value.replace(
        /\\(?:textbackslash\{\}|textasciitilde\{\}|textasciicircum\{\}|[%&#_${}])/g,
        "",
      ),
    )
  )
    return null;
  return decoded.replace(/\u0001/g, "\\");
}
export function isVisualTexKey(key: string): boolean {
  return /^[A-Za-z0-9:._/+@-]{1,160}$/.test(key);
}
