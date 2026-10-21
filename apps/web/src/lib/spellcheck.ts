import {
  createDictionary,
  findMisspellings,
  getBaseDictionary,
  normalizeCustomWord,
  type Misspelling,
} from "@alove/editor";

export type { Misspelling };

export type SpellcheckDocumentOptions = {
  customWords?: Iterable<string>;
  ignoreWords?: Iterable<string>;
  /** Extra dictionary words (e.g. from `dictionary-en` once installed). */
  extraDictionaryWords?: Iterable<string>;
  maxSuggestions?: number;
};

let cachedBase: Set<string> | null = null;
let cachedExtraKey: string | null = null;
let cachedCombined: Set<string> | null = null;

function extraKey(extra: Iterable<string> | undefined): string | null {
  if (!extra) return null;
  return [...extra].map((w) => w.toLowerCase()).sort().join("\0");
}

/**
 * Active dictionary: bundled base list plus optional `dictionary-en` words.
 * Primary installs `dictionary-en` with `bun add dictionary-en`; callers
 * pass the imported word list as `extraDictionaryWords` to upgrade coverage.
 */
export function getActiveDictionary(
  extraDictionaryWords?: Iterable<string>,
): Set<string> {
  const key = extraKey(extraDictionaryWords);
  if (cachedBase === null) cachedBase = getBaseDictionary();
  if (key === cachedExtraKey && cachedCombined) return cachedCombined;
  if (!extraDictionaryWords) {
    cachedExtraKey = null;
    cachedCombined = cachedBase;
    return cachedBase;
  }
  cachedExtraKey = key;
  cachedCombined = createDictionary(extraDictionaryWords);
  return cachedCombined;
}

/**
 * Unit-test helper over an explicit word list (deterministic, offline).
 * Product spellcheck uses the full dictionary-en engine via
 * `spellcheckService.checkDocument` — never this bundled list.
 */
export function checkSpelling(
  doc: string,
  options: SpellcheckDocumentOptions = {},
): Misspelling[] {
  return findMisspellings(doc, {
    dictionary: getActiveDictionary(options.extraDictionaryWords),
    customWords: options.customWords,
    ignoreWords: options.ignoreWords,
    maxSuggestions: options.maxSuggestions ?? 4,
  });
}

export { normalizeCustomWord };

/** Normalize + dedupe a custom-word list for persistence. */
export function sanitizeCustomWords(words: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of words) {
    const w = normalizeCustomWord(String(raw));
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 500) break;
  }
  return out.sort();
}
