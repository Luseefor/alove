/**
 * LaTeX-aware spellcheck helpers (CodeMirror-view agnostic).
 *
 * The tokenizer blanks TeX machinery (commands, key-only arguments, math,
 * verbatim/code, urls, comments) while preserving character offsets, then
 * reports prose tokens missing from the dictionary. Suggestions use a
 * bounded Levenshtein scan over the active word list.
 */

export type ProseToken = { word: string; from: number; to: number };

export type Misspelling = {
  word: string;
  from: number;
  to: number;
  suggestions: string[];
};

function blank(match: string): string {
  return match.replace(/[^\n]/g, " ");
}

const VERBATIM_BLOCK =
  /\\begin\s*\{(verbatim|Verbatim|lstlisting|minted|comment)\}[\s\S]*?\\end\s*\{\1\}/g;
const MATH_BLOCK =
  /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\\begin\s*\{(equation|align|gather|math|displaymath|eqnarray)\*?\}[\s\S]*?\\end\s*\{\1\*?\}/g;
const MATH_INLINE = /\$[^$\n]*?\$/g;
// \verb delimiter is never a letter, space, or `*`; content stays on one line.
const VERB_INLINE = /\\verb\*?([^a-zA-Z\s*])[^\n]*?\1/g;
const URL_RE = /https?:\/\/\S+|www\.\S+|\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
// Environment names are markup, never prose (`\begin{itemize}` etc.).
const ENV_RE = /\\(?:begin|end)\s*\{[^}]*\}/g;

// Commands whose `{...}` payloads are keys/paths, never prose.
const KEY_COMMANDS =
  "(?:cite[a-zA-Z]*\\*?|Cite[a-zA-Z]*\\*?|parencite\\*?|textcite\\*?|autocite\\*?|smartcite\\*?|footcite[a-z]*\\*?|nocite\\*?|ref|eqref|pageref|autoref|cref|Cref|nameref|labelcref|cpageref|label|url|includegraphics|input|include|bibliography|bibliographystyle|usepackage|documentclass|addbibresource|verbatiminput|lstinputlisting)";
const KEY_ARG_RE = new RegExp(
  `\\\\${KEY_COMMANDS}\\s*(\\[[^\\]]*\\]\\s*)*\\{[^}]*\\}`,
  "g",
);
const HREF_RE = /\\href\s*(\[[^\]]*\]\s*)?\{[^}]*\}\s*\{([^}]*)\}/g;
const COMMAND_RE = /\\[a-zA-Z]+\*?/g;

function blankLineComments(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    let cut = -1;
    for (let c = 0; c < line.length; c += 1) {
      if (line[c] !== "%") continue;
      let run = 0;
      for (let b = c - 1; b >= 0 && line[b] === "\\"; b -= 1) run += 1;
      if (run % 2 === 0) {
        cut = c;
        break;
      }
    }
    if (cut !== -1) {
      lines[i] = line.slice(0, cut) + " ".repeat(line.length - cut);
    }
  }
  return lines.join("\n");
}

/** Mask TeX machinery with spaces, preserving offsets for token mapping. */
export function maskLatexProse(doc: string): string {
  let out = doc;
  out = out.replace(VERBATIM_BLOCK, blank);
  // Inline verbatim before comments: `%` inside \verb|...| is literal text.
  out = out.replace(VERB_INLINE, blank);
  out = blankLineComments(out);
  // `\$` is a literal dollar, never a math delimiter (odd-run check:
  // `\\$` is a newline command followed by math start).
  out = out.replace(/\\+\$/g, (m) =>
    (m.length - 1) % 2 === 1 ? `${" ".repeat(m.length - 2)}  ` : m,
  );
  out = out.replace(MATH_BLOCK, blank);
  // \href{url}{prose}: keep the prose at its original offsets, blank the
  // wrapper. The replacement must be exactly match.length long or every
  // later diagnostic offset shifts.
  out = out.replace(HREF_RE, (match, _opt, prose: string) => {
    const proseStart = match.lastIndexOf("{") + 1;
    const head = match.slice(0, proseStart).replace(/[^\n]/g, " ");
    const tail = match
      .slice(proseStart + prose.length)
      .replace(/[^\n]/g, " ");
    return `${head}${prose}${tail}`;
  });
  out = out.replace(MATH_INLINE, (m) => (m.length <= 2 ? "  " : blank(m)));
  out = out.replace(KEY_ARG_RE, blank);
  out = out.replace(URL_RE, blank);
  out = out.replace(ENV_RE, blank);
  out = out.replace(COMMAND_RE, blank);
  return out;
}

const WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/**
 * Skip tokens that are fragments of paths/identifiers (`intro.tex`,
 * `user@host`, `a/b`). Sentence-final punctuation (`word. Next`) is not a
 * join: the punctuation must connect two word runs to count.
 */
function isPathAdjacent(doc: string, from: number, to: number): boolean {
  const before = doc[from - 1];
  const after = doc[to];
  if (before === "." && isWordChar(doc[from - 2])) return true;
  if (after === "." && isWordChar(doc[to + 1])) return true;
  if (before === "@" && isWordChar(doc[from - 2])) return true;
  if (after === "@" && isWordChar(doc[to + 1])) return true;
  if (before === "/" && isWordChar(doc[from - 2])) return true;
  if (after === "/" && isWordChar(doc[to + 1])) return true;
  // A lone backslash prefix is an escape/command remnant; `\\` is a newline
  // command, so prose after it stays checkable.
  if (before === "\\" && doc[from - 2] !== "\\") return true;
  return false;
}

/** Extract checkable prose tokens with document offsets. */
export function extractProseTokens(doc: string): ProseToken[] {
  const tokens: ProseToken[] = [];
  if (!doc) return tokens;
  const masked = maskLatexProse(doc);
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(masked)) !== null) {
    const word = m[0]!;
    const from = m.index;
    const to = from + word.length;
    if (word.length < 3) continue;
    if (word === word.toUpperCase() && word.length <= 5) continue; // acronyms
    if (/^\d+$/.test(word)) continue;
    // Skip single-letter contractions remnants and path fragments.
    if (isPathAdjacent(doc, from, to)) continue;
    // Skip tokens abutting braces left by key blanking (already blanked).
    tokens.push({ word, from, to });
  }
  return tokens;
}

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

/** Normalize a user dictionary entry; empty string when invalid. */
export function normalizeCustomWord(word: string): string {
  const w = word.trim().toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
  if (!/^[a-z][a-z'\-]*[a-z]$/.test(w) && !/^[a-z]{2,}$/.test(w)) return "";
  if (w.length < 2 || w.length > 40) return "";
  return w;
}

export function levenshtein(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  // Optimal string alignment: adjacent transposition costs 1 (teh -> the).
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i += 1) {
    let rowMin = cap + 1;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
      if (best < rowMin) rowMin = best;
    }
    if (rowMin > cap) return cap + 1;
  }
  const dist = d[m]![n]!;
  return dist <= cap ? dist : cap + 1;
}

/** Up to `max` suggestions within edit distance 2 (3 for long words). */
export function suggestCorrections(
  word: string,
  dictionary: Iterable<string>,
  max = 4,
): string[] {
  const lower = word.toLowerCase();
  const scored: { w: string; d: number }[] = [];
  for (const raw of dictionary) {
    const cand = raw.toLowerCase();
    if (!cand || cand === lower) continue;
    if (Math.abs(cand.length - lower.length) > 3) continue;
    if (cand[0] !== lower[0] && levenshtein(cand, lower, 1) > 1) {
      // Cheap pre-filter: different first letter usually means distance > 2
      // unless lengths differ; still verify with full computation below.
    }
    const cap = lower.length >= 7 ? 3 : 2;
    const d = levenshtein(lower, cand, cap);
    if (d <= cap && d > 0) scored.push({ w: raw, d });
  }
  scored.sort((a, b) => a.d - b.d || a.w.localeCompare(b.w));
  return scored.slice(0, max).map((s) => s.w);
}

export type SpellcheckOptions = {
  dictionary: Set<string> | string[];
  customWords?: Iterable<string>;
  ignoreWords?: Iterable<string>;
  maxSuggestions?: number;
};

function toLowerSet(values: Iterable<string> | undefined): Set<string> {
  const out = new Set<string>();
  if (!values) return out;
  for (const v of values) {
    const w = normalizeWord(v);
    if (w) out.add(w);
  }
  return out;
}

/** Misspellings in prose order with suggestions. */
export function findMisspellings(
  doc: string,
  options: SpellcheckOptions,
): Misspelling[] {
  const dict = options.dictionary instanceof Set
    ? options.dictionary
    : new Set(
        [...options.dictionary].map(normalizeWord).filter(Boolean),
      );
  const custom = toLowerSet(options.customWords);
  const ignore = toLowerSet(options.ignoreWords);
  const maxSuggestions = options.maxSuggestions ?? 4;
  // Suggestion pool excludes single letters; keep iteration bounded.
  const pool = new Set<string>([...dict].map((w) => w.toLowerCase()));
  for (const w of custom) pool.add(w);
  const out: Misspelling[] = [];
  const seenAt = new Map<string, number>();
  for (const token of extractProseTokens(doc)) {
    const lower = token.word.toLowerCase();
    if (dict.has(lower) || custom.has(lower) || ignore.has(lower)) continue;
    // Report each unique word once per position (multiple positions each get one).
    const seenKey = `${lower}:${token.from}`;
    if (seenAt.has(seenKey)) continue;
    seenAt.set(seenKey, 1);
    out.push({
      word: token.word,
      from: token.from,
      to: token.to,
      suggestions: suggestCorrections(lower, pool, maxSuggestions),
    });
    if (out.length >= 200) break;
  }
  return out;
}

// Compact base word list: common English + academic/LaTeX prose.
// Full coverage comes from the `dictionary-en` package once primary installs
// it; this bundled list keeps offline/unit behavior deterministic.
const BASE_WORDS = [
  "a", "about", "above", "abstract", "academic", "according", "across",
  "action", "active", "addition", "after", "again", "against", "algorithm",
  "all", "almost", "also", "although", "always", "among", "amount",
  "an", "and", "another", "any", "analysis", "appear", "appeared", "appearing",
  "appears", "appendix", "apple", "apply", "approach",
  "april", "are", "area", "around", "article", "as", "assign", "at",
  "august", "author", "auxiliary", "available", "away", "back", "based",
  "basic", "because", "become", "been", "before", "begin", "behind",
  "being", "below", "best", "between", "beyond", "bibliography", "big",
  "binary", "body", "book", "both", "bottom", "brown", "build", "but",
  "by", "called", "can", "cannot", "caption", "case", "cause", "center",
  "certain", "change", "changes", "chapter", "character", "check",
  "citation", "citations", "cite", "class", "clear", "close", "code",
  "collaboration", "column", "command", "comment", "common", "compile",
  "compiler", "complete", "conclusion", "condition", "content", "context",
  "control", "copy", "correct", "correction", "could", "count", "course",
  "create", "current", "custom", "data", "date", "day", "december",
  "default", "define", "definitely", "definition", "design", "detail",
  "develop", "did", "different", "discussion", "display", "do", "document",
  "does", "dog", "done", "door", "down", "draft", "draw", "during",
  "each", "early", "earth", "edit", "editor", "effect", "eight", "either",
  "element", "else", "email", "enabled", "end", "engine", "english",
  "enough", "enter", "entire", "entry", "environment", "equation",
  "error", "escape", "even", "every", "example", "except", "existing",
  "experiment", "explain", "express", "extension", "extra", "face",
  "fact", "february", "few", "field", "figure", "file", "final", "find",
  "first", "five", "focus", "following", "font", "for", "form", "format",
  "forward", "found", "four", "fox", "friday", "from", "front", "further",
  "future", "general", "get", "given", "go", "good", "grammar", "great",
  "group", "guide", "had", "half", "handle", "has", "have", "he",
  "header", "hello", "help", "her", "here", "high", "him", "his",
  "history", "home", "house", "how", "however", "human", "hundred",
  "image", "important", "include", "including", "index", "inner",
  "input", "insert", "inside", "instead", "introduction", "is", "issue",
  "it", "item", "its", "january", "july", "jump", "jumps", "june",
  "just", "keep", "key", "keyboard", "kind", "know", "known", "label",
  "language", "large", "last", "late", "later", "latex", "lazy", "least",
  "leave", "left", "length", "less", "let", "letter", "level", "light",
  "like", "limit", "line", "link", "list", "little", "local", "long",
  "look", "made", "main", "make", "man", "manual", "many", "march",
  "mark", "match", "material", "math", "may", "maybe", "mean", "means",
  "measure", "menu", "merge", "message", "method", "middle", "might",
  "mode", "model", "monday", "more", "most", "move", "much", "multiple",
  "must", "name", "narrow", "near", "need", "never", "new", "next",
  "night", "no", "node", "none", "normal", "not", "note", "november",
  "now", "number", "object", "occurred", "october", "of", "off",
  "offer", "often", "old", "on", "once", "one", "only", "open",
  "option", "or", "order", "other", "our", "out", "outer", "over",
  "package", "page", "panel", "paper", "paragraph", "part", "patch",
  "path", "pdf", "people", "perform", "place", "point", "position",
  "possible", "power", "preamble", "present", "press", "preview",
  "previous", "primary", "print", "problem", "process", "produce",
  "project", "proof", "prose", "provide", "put", "quick", "quite",
  "range", "rather", "read", "ready", "real", "receive", "recent",
  "redo", "ref", "reference", "references", "release", "remain",
  "remove", "render", "report", "research", "reset", "resource",
  "respect", "rest", "result", "retain", "return", "review", "right",
  "role", "root", "round", "row", "rule", "run", "said", "same",
  "sample", "saturday", "save", "say", "scale", "school", "screen",
  "search", "second", "section", "sections", "see", "select", "separate",
  "september", "server", "set", "setting", "settings", "several",
  "shall", "shape", "share", "she", "short", "should", "show", "shown",
  "side", "simple", "since", "single", "six", "size", "small", "so",
  "some", "source", "space", "spaces", "spell", "spelling", "standalone",
  "start", "state", "still", "structure", "study", "style", "such",
  "suggestion", "sunday", "support", "switch", "sync", "system", "table",
  "take", "template", "ten", "test", "tex", "text", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "thing",
  "think", "third", "this", "those", "though", "thought", "three",
  "through", "thursday", "time", "title", "to", "today", "together",
  "too", "tool", "top", "total", "toward", "track", "tree", "tuesday",
  "turn", "two", "type", "under", "undo", "unique", "unit", "until",
  "up", "update", "upon", "use", "used", "useful", "user", "using",
  "usual", "value", "version", "very", "via", "view", "viewer", "was",
  "water", "way", "we", "wednesday", "week", "well", "went", "were",
  "what", "when", "where", "which", "while", "white", "who", "whole",
  "whose", "wide", "width", "will", "with", "within", "without",
  "word", "words", "work", "world", "would", "wrap", "write", "writer",
  "writing", "wrong", "year", "years", "yes", "yet", "you", "your",
  "zero", "accommodate", "accommodation", "acknowledgment", "across",
  "algorithmic", "appendices", "assumption", "auxiliary", "behavior",
  "behaviour", "brief", "broad", "brown", "captioned", "citations",
  "color", "colour", "column", "comparable", "compatible", "compiler",
  "complement", "composed", "comprehensive", "compute", "conjecture",
  "consider", "consistent", "constant", "constraint", "contains",
  "corresponding", "criteria", "criterion", "customize", "define",
  "defined", "derivation", "describe", "diagram", "dictionary",
  "dimension", "direct", "discuss", "distinct", "divide", "double",
  "draft", "dynamic", "element", "empirical", "enable", "equation",
  "evaluate", "evidence", "example", "exists", "expand", "experiment",
  "explain", "explicit", "explore", "extension", "false", "feature",
  "february", "few", "fiction", "field", "fifth", "filter", "final",
  "focus", "footer", "footnote", "formal", "framework", "front",
  "function", "future", "gather", "global", "glossary", "goal",
  "grant", "graph", "grid", "gutter", "habit", "handle", "header",
  "height", "hence", "heuristic", "hidden", "highlight", "holds",
  "hybrid", "ignore", "illustrate", "implement", "implicit", "import",
  "improve", "inches", "include", "increased", "indent", "index",
  "indicate", "inform", "inline", "inner", "insert", "insight",
  "install", "instance", "instead", "integrate", "intended", "interim",
  "interior", "into", "invoke", "involve", "issue", "italic", "item",
  "joint", "journal", "journey", "judge", "kernel", "keymap",
  "keyword", "label", "landscape", "laser", "latter", "layer",
  "learn", "least", "leave", "legacy", "legal", "lemma", "length",
  "level", "library", "license", "limit", "linear", "linen", "list",
  "local", "locate", "location", "logic", "loose", "macro", "mainly",
  "maintain", "major", "manage", "margin", "marker", "matrix",
  "matter", "maximum", "meaning", "measure", "media", "medium",
  "merge", "metadata", "method", "micro", "middle", "minimal",
  "minimum", "minor", "minus", "minute", "mirror", "missing",
  "mixed", "modal", "model", "modern", "modify", "moment", "month",
  "moral", "motion", "mouse", "mouth", "movie", "music", "naive",
  "narrow", "native", "nearly", "necessary", "neither", "nested",
  "neutral", "never", "night", "ninth", "noble", "noise", "nominal",
  "normalize", "notion", "novel", "number", "numerous", "object",
  "obtain", "obvious", "occur", "occurs", "offer", "office",
  "offline", "often", "older", "omitted", "ongoing", "online",
  "opacity", "operate", "opinion", "opposite", "optical", "optimal",
  "orange", "order", "organize", "origin", "other", "ought", "outer",
  "output", "overall", "owner", "oxide", "paint", "panel", "paper",
  "parallel", "parameter", "parent", "partial", "particular",
  "patch", "pause", "payment", "peace", "pencil", "people", "period",
  "permit", "persist", "phase", "phone", "photo", "phrase", "physical",
  "piece", "pilot", "pitch", "place", "plain", "plane", "plant",
  "plate", "plausible", "please", "plural", "pocket", "poetry",
  "point", "polar", "policy", "polish", "polite", "pool", "popular",
  "portal", "portion", "portrait", "position", "possess", "postal",
  "poster", "potato", "potential", "pound", "powder", "power",
  "practical", "practice", "praise", "predict", "prefer", "prefix",
  "premise", "prepare", "present", "preserve", "press", "pressure",
  "pretty", "prevent", "preview", "price", "pride", "prime", "principal",
  "principle", "print", "prior", "prison", "private", "prize",
  "probably", "probe", "problem", "proceed", "process", "produce",
  "product", "profile", "program", "progress", "project", "promise",
  "promote", "prompt", "proof", "proper", "property", "propose",
  "prose", "protect", "protein", "proud", "prove", "provide",
  "public", "publish", "pulse", "punch", "pupil", "purchase",
  "purple", "purpose", "push", "puzzle", "quantify", "quantity",
  "quarter", "queen", "question", "queue", "quiet", "quit", "quite",
  "quote", "rabbit", "radio", "raise", "random", "range", "rapid",
  "ratio", "reach", "react", "ready", "realm", "reason", "recall",
  "receive", "recent", "recipe", "record", "recover", "redundant",
  "refer", "refine", "reflect", "reform", "refrain", "refresh",
  "regard", "region", "register", "regular", "reject", "relate",
  "relative", "release", "relevant", "reliable", "remain", "remark",
  "remedy", "remember", "remind", "remote", "remove", "render",
  "renew", "repair", "repeat", "replace", "reply", "report", "request",
  "require", "rescue", "research", "resemble", "reserve", "reside",
  "resist", "resolve", "resolve", "resort", "resource", "respond",
  "response", "restore", "result", "retain", "retreat", "return",
  "reveal", "revenue", "review", "revise", "rhythm", "rider",
  "ridge", "rifle", "right", "rigid", "ring", "rinse", "risen",
  "risk", "rival", "river", "roast", "robust", "rocket", "roman",
  "roster", "rough", "round", "route", "routine", "royal", "ruler",
  "rumor", "rural", "salient", "sample", "sanity", "satisfy",
  "sauce", "scale", "scare", "scene", "scheme", "scholar", "science",
  "scope", "score", "screen", "script", "search", "season",
  "second", "secret", "section", "secure", "seen", "segment",
  "select", "semantic", "sends", "sense", "sensitive", "sentence",
  "series", "serve", "server", "service", "settle", "seven",
  "seventh", "severe", "shade", "shadow", "shake", "shall", "shallow",
  "shame", "shape", "share", "sharp", "sheep", "sheet", "shelf",
  "shell", "shift", "shine", "ship", "shirt", "shock", "shore",
  "short", "shout", "shown", "sibling", "sight", "signal", "silent",
  "silly", "silver", "similar", "simple", "since", "sincere",
  "single", "sister", "sixth", "sketch", "skill", "sleep", "slice",
  "slide", "slope", "small", "smart", "smell", "smile", "smoke",
  "smooth", "snake", "snapshot", "snippet", "soccer", "social",
  "socket", "solar", "solid", "solve", "sorted", "sound", "south",
  "space", "spare", "spark", "speak", "speaker", "special", "species",
  "specific", "specify", "speech", "speed", "spell", "spend",
  "sphere", "spice", "spill", "spine", "spiral", "spirit", "splash",
  "spoken", "sponge", "sponsor", "spoon", "sport", "spray", "spread",
  "spring", "square", "stable", "stack", "staff", "stage", "stair",
  "stake", "stamp", "stand", "standard", "staple", "stare", "start",
  "state", "static", "station", "status", "steady", "steal",
  "steam", "steel", "steep", "steer", "stem", "step", "stern",
  "stick", "still", "sting", "stock", "stone", "stood", "store",
  "storm", "story", "stove", "straight", "strange", "strategy",
  "stream", "street", "strength", "stress", "stretch", "strict",
  "stride", "strike", "string", "stripe", "stroke", "strong",
  "struck", "studio", "study", "stuff", "stumble", "style", "subject",
  "submit", "subset", "subtle", "suburb", "succeed", "success",
  "sudden", "suffer", "sugar", "suggest", "suite", "summary",
  "summer", "summit", "superb", "supply", "support", "suppose",
  "supreme", "surface", "surge", "survey", "swallow", "swamp",
  "swap", "swarm", "swear", "sweat", "sweep", "sweet", "swell",
  "swift", "swing", "switch", "sword", "symbol", "symptom",
  "syrup", "system", "table", "tackle", "tactic", "taste", "taught",
  "taxi", "teach", "team", "teeth", "tell", "template", "tempo",
  "tenancy", "tenant", "tend", "tender", "tennis", "tenor",
  "tension", "terminal", "terrain", "test", "tex", "thank",
  "theater", "theatre", "theme", "theory", "therapy", "there",
  "thermal", "thick", "thief", "thigh", "thing", "think", "third",
  "thirst", "thirty", "throne", "throng", "through", "throw",
  "thumb", "thunder", "ticket", "tiger", "tight", "timer", "tired",
  "tissue", "title", "toast", "today", "token", "tolerant", "tomato",
  "tomorrow", "tongue", "tonight", "toolbar", "topic", "torch",
  "torso", "tortoise", "total", "touch", "tough", "tour", "toward",
  "tower", "trace", "track", "trade", "traffic", "tragedy", "trail",
  "train", "trait", "transfer", "transition", "translate", "travel",
  "tray", "tread", "treat", "treaty", "trend", "trial", "tribe",
  "trick", "trigger", "triple", "triumph", "trivial", "trolley",
  "troop", "trouble", "truck", "truly", "trumpet", "trunk",
  "trust", "truth", "trying", "tulip", "tumble", "tumor", "tunnel",
  "turkey", "turn", "turtle", "tutor", "twelve", "twenty", "twice",
  "twin", "twist", "typical", "typo", "uglify", "ulcer", "ultimate",
  "umbrella", "unable", "uncle", "under", "uneven", "unfold",
  "union", "unique", "unite", "unity", "universal", "unknown",
  "unlike", "unlock", "unlucky", "unveil", "unwind", "update",
  "upgrade", "uphold", "upload", "upper", "upright", "upset",
  "urban", "urge", "urgent", "usage", "useful", "usher", "usual",
  "utility", "utilize", "utter", "vacant", "vacuum", "vague",
  "valid", "valley", "valuable", "vanilla", "vanish", "vapor",
  "variable", "variety", "various", "vary", "vast", "vault",
  "vector", "vehicle", "velvet", "vendor", "veneer", "vengeance",
  "venue", "verbal", "verdict", "verify", "verse", "version",
  "versus", "vertical", "vessel", "vested", "viable", "vibrant",
  "victim", "video", "view", "vigil", "vigor", "village",
  "violin", "virtual", "virtue", "virus", "visa", "vision",
  "visit", "visual", "vital", "vivid", "vocal", "voice", "volume",
  "voter", "vowel", "voyage", "wagon", "waist", "waste", "watch",
  "water", "wealth", "weapon", "weary", "weather", "weave",
  "wedge", "weekly", "weigh", "weight", "weird", "welcome",
  "welfare", "whale", "wheat", "wheel", "while", "whisper",
  "white", "whole", "widely", "widen", "widow", "width", "wield",
  "wild", "willing", "wince", "wind", "window", "winner", "winter",
  "wipe", "wired", "wisdom", "withdraw", "withhold", "within",
  "without", "witness", "wizard", "wobble", "woman", "wonder",
  "wooden", "word", "work", "world", "worry", "worth", "worthy",
  "wound", "woven", "wrinkle", "writer", "writing", "written",
  "year", "yellow", "yield", "young", "youth", "zebra",
];

const BASE_SET: Set<string> = new Set(BASE_WORDS.map((w) => w.toLowerCase()));

/**
 * Bundled dictionary. Licensed word lists (e.g. `dictionary-en`, MIT)
 * should replace/extend this set once primary runs
 * `bun add dictionary-en` — see `createDictionary` below.
 */
export function getBaseDictionary(): Set<string> {
  return new Set(BASE_SET);
}

/**
 * Build an active dictionary from the bundled base list plus injected
 * words (e.g. from `dictionary-en` once installed). Pass the imported
 * `dictionary-en` word array as `extraWords` to upgrade coverage
 * without changing call sites.
 */
export function createDictionary(extraWords?: Iterable<string>): Set<string> {
  const dict = getBaseDictionary();
  if (extraWords) {
    for (const w of extraWords) {
      const n = normalizeWord(String(w));
      if (n) dict.add(n);
    }
  }
  return dict;
}
