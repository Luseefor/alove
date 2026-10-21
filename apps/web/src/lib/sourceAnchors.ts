export type SourceAnchor = {
  from: number;
  to: number;
  original: string;
  before: string;
  after: string;
};

export function captureAnchor(
  source: string,
  from: number,
  to: number,
): SourceAnchor {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to < from ||
    to > source.length ||
    to - from > 16_000
  )
    throw new Error(
      "Select at most 16,000 characters from the current source.",
    );
  return {
    from,
    to,
    original: source.slice(from, to),
    before: source.slice(Math.max(0, from - 48), from),
    after: source.slice(to, to + 48),
  };
}

/** Resolve only an unambiguous contextual anchor; never guess after source drift. */
export function resolveAnchor(
  source: string,
  anchor: SourceAnchor,
): { from: number; to: number } | null {
  const matches = (from: number) =>
    source.slice(from, from + anchor.original.length) === anchor.original &&
    source.slice(Math.max(0, from - anchor.before.length), from) ===
      anchor.before &&
    source.slice(
      from + anchor.original.length,
      from + anchor.original.length + anchor.after.length,
    ) === anchor.after;
  let found: number | null = null;
  if (!anchor.original && !anchor.before && !anchor.after && source.length)
    return null;
  for (let at = 0; at <= source.length - anchor.original.length; ) {
    const next = anchor.original ? source.indexOf(anchor.original, at) : at;
    if (next < 0) break;
    if (matches(next)) {
      if (found !== null) return null;
      found = next;
    }
    at = next + 1;
  }
  return found === null
    ? null
    : { from: found, to: found + anchor.original.length };
}
