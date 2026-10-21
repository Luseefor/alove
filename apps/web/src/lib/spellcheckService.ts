import NSpell from "nspell";
import {
  extractProseTokens,
  levenshtein,
  type Misspelling,
} from "@alove/editor";
import { useEffect, useState, useSyncExternalStore } from "react";

export type SpellChecker = {
  correct(word: string): boolean;
  suggest(word: string, max?: number): string[];
};

export type CheckerStatus = "idle" | "loading" | "ready" | "error";

const AFF_URL = "/dictionaries/en/index.aff";
const DIC_URL = "/dictionaries/en/index.dic";

let enginePromise: Promise<SpellChecker> | null = null;
let status: CheckerStatus = "idle";
let statusError: string | null = null;
const listeners = new Set<() => void>();

function setStatus(next: CheckerStatus, error: string | null = null) {
  status = next;
  statusError = error;
  for (const notify of listeners) notify();
}

function subscribeStatus(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function getSpellcheckStatus(): CheckerStatus {
  return status;
}

export function getSpellcheckError(): string | null {
  return statusError;
}

/** React binding for the English dictionary load state. */
export function useSpellcheckStatus(): {
  status: CheckerStatus;
  error: string | null;
} {
  const current = useSyncExternalStore(
    subscribeStatus,
    () => status,
    () => status,
  );
  // Read the error alongside status without a second subscription.
  return { status: current, error: statusError };
}

/**
 * Ultra-common function words, used ONLY to break edit-distance ties when
 * ranking suggestions (e.g. `teh` -> `the` over `ten`). Correctness
 * (flagging) always comes from the full dictionary-en engine; this set
 * never adds or removes checkable words.
 */
const COMMON_TIEBREAK = new Set(
  "the of and to in is that it was for on are as with his they this have from or one had by word but not what all were we when your can said there use each which their how will up about out many then them these so some her would make like him into has two more very after words first where did get many".split(
    " ",
  ),
);

function rankSuggestions(
  word: string,
  candidates: string[],
  max: number,
): string[] {
  const lower = word.toLowerCase();
  const seen = new Set<string>();
  const scored: {
    text: string;
    distance: number;
    common: number;
    index: number;
  }[] = [];
  candidates.forEach((raw, index) => {
    const text = raw.trim();
    if (!text || /^[A-Z]{2,}$/.test(text)) return; // drop acronym noise (NEH)
    const key = text.toLowerCase();
    if (!key || key === lower || seen.has(key)) return;
    seen.add(key);
    scored.push({
      text,
      distance: levenshtein(lower, key, 3),
      common: COMMON_TIEBREAK.has(key) ? 0 : 1,
      index,
    });
  });
  scored.sort(
    (a, b) =>
      a.distance - b.distance || a.common - b.common || a.index - b.index,
  );
  return scored.slice(0, max).map((s) => s.text);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Dictionary fetch failed (${response.status}): ${url}`);
  }
  return response.text();
}

/**
 * Load the full Hunspell English dictionary (affix-aware via nspell) exactly
 * once and cache the engine. Concurrent callers share the in-flight promise.
 */
export function loadEnglishChecker(): Promise<SpellChecker> {
  if (enginePromise) return enginePromise;
  setStatus("loading");
  enginePromise = (async () => {
    try {
      const [aff, dic] = await Promise.all([
        fetchText(AFF_URL),
        fetchText(DIC_URL),
      ]);
      const engine = NSpell(aff, dic);
      const checker: SpellChecker = {
        correct: (word) =>
          engine.correct(word) || engine.correct(word.toLowerCase()),
        suggest: (word, max = 3) =>
          rankSuggestions(
            word,
            [...engine.suggest(word), ...engine.suggest(word.toLowerCase())],
            max ?? 3,
          ),
      };
      setStatus("ready");
      return checker;
    } catch (error) {
      setStatus(
        "error",
        error instanceof Error ? error.message : "Dictionary failed to load",
      );
      // Allow a later retry: drop the rejected promise.
      enginePromise = null;
      throw error;
    }
  })();
  return enginePromise;
}

/** Reset cached engine state (tests only). */
export function resetSpellcheckServiceForTests(): void {
  enginePromise = null;
  setStatus("idle");
}

const suggestionCaches = new WeakMap<SpellChecker, Map<string, string[]>>();
/** Corrections are requested by a visible tooltip, then reused across edits. */
export function getSpellingSuggestions(
  checker: SpellChecker,
  word: string,
  max = 3,
): string[] {
  let cache = suggestionCaches.get(checker);
  if (!cache) {
    cache = new Map();
    suggestionCaches.set(checker, cache);
  }
  const key = `${word}\0${max}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const suggestions = checker.suggest(word, max);
  cache.set(key, suggestions);
  if (cache.size > 1000) cache.delete(cache.keys().next().value!);
  return suggestions;
}

export type DocumentCheckOptions = {
  customWords?: Iterable<string>;
  ignoreWords?: Iterable<string>;
  maxMisspellings?: number;
  maxSuggestions?: number;
};

/**
 * Check a LaTeX document with a full-dictionary checker. Personal dictionary
 * and session ignores are layered on top without mutating the engine.
 * Bounded: stops after `maxMisspellings` hits.
 */
export function checkDocument(
  doc: string,
  checker: SpellChecker,
  options: DocumentCheckOptions = {},
): Misspelling[] {
  const custom = new Set<string>();
  for (const w of options.customWords ?? []) {
    const n = w.trim().toLowerCase();
    if (n) custom.add(n);
  }
  const ignore = new Set<string>();
  for (const w of options.ignoreWords ?? []) {
    const n = w.trim().toLowerCase();
    if (n) ignore.add(n);
  }
  const maxMisspellings = options.maxMisspellings ?? 100;
  const maxSuggestions = options.maxSuggestions ?? 3;
  const out: Misspelling[] = [];
  for (const token of extractProseTokens(doc)) {
    if (out.length >= maxMisspellings) break;
    const lower = token.word.toLowerCase();
    if (custom.has(lower) || ignore.has(lower)) continue;
    if (checker.correct(token.word)) continue;
    out.push({
      word: token.word,
      from: token.from,
      to: token.to,
      suggestions:
        maxSuggestions > 0
          ? getSpellingSuggestions(checker, token.word, maxSuggestions)
          : [],
    });
  }
  return out;
}

/**
 * React binding: when `enabled`, kicks off the one-time dictionary load and
 * returns the cached checker once ready (null while idle/loading/error).
 */
export function useEnglishSpellchecker(enabled: boolean): SpellChecker | null {
  const { status } = useSpellcheckStatus();
  const [checker, setChecker] = useState<SpellChecker | null>(null);
  useEffect(() => {
    if (!enabled) return;
    // Idle starts the one-time load; ready re-attaches the cached engine.
    // Error stays put until the settings dialog's Retry button reloads.
    if (status !== "idle" && status !== "ready") return;
    let cancelled = false;
    loadEnglishChecker()
      .then((loaded) => {
        if (!cancelled) setChecker(loaded);
      })
      .catch(() => {
        if (!cancelled) setChecker(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, status]);
  return status === "ready" ? checker : null;
}

/**
 * Minimal in-memory checker over an explicit word list.
 * Unit-test seam only — never the product path.
 */
export function createWordListChecker(words: Iterable<string>): SpellChecker {
  const set = new Set<string>();
  for (const w of words) {
    const n = w.trim().toLowerCase();
    if (n) set.add(n);
  }
  return {
    correct: (word) => set.has(word.toLowerCase()),
    suggest: (word, max = 3) => {
      const lower = word.toLowerCase();
      const scored: { text: string; distance: number }[] = [];
      for (const candidate of set) {
        if (candidate === lower) continue;
        if (Math.abs(candidate.length - lower.length) > 3) continue;
        const distance = levenshtein(lower, candidate, 2);
        if (distance <= 2) scored.push({ text: candidate, distance });
      }
      scored.sort(
        (a, b) => a.distance - b.distance || a.text.localeCompare(b.text),
      );
      return scored.slice(0, max).map((s) => s.text);
    },
  };
}
