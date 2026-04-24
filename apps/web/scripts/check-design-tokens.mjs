#!/usr/bin/env node
/**
 * Fail CI if raw Tailwind palette scales (emerald-*, sky-*) appear in app source.
 * Use semantic `alove-*` tokens or CSS variables from `src/theme/palette-definitions.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "src");
const BAD = /\b(emerald|sky)-(?:[0-9]{2,3}|[a-z]+)\b/g;
const ALLOW_DIRS = ["__tests__"];
const SKIP_SUBSTR = [
  "palette-definitions.ts",
  "/_generated/",
  ".test.ts",
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ALLOW_DIRS.includes(ent.name)) continue;
      walk(p, out);
    } else if (/\.(tsx?|jsx?)$/.test(ent.name)) {
      if (SKIP_SUBSTR.some((s) => p.includes(s))) continue;
      out.push(p);
    }
  }
  return out;
}

let failed = false;
for (const file of walk(ROOT)) {
  const src = readFileSync(file, "utf8");
  const matches = [...src.matchAll(BAD)];
  if (matches.length) {
    failed = true;
    const uniq = [...new Set(matches.map((m) => m[0]))];
    console.error(`${file}: forbidden palette classes → ${uniq.join(", ")}`);
  }
}

if (failed) {
  console.error(
    "\nUse `alove-*` theme utilities (see globals.css @theme) or CSS vars from TypeScript palettes.",
  );
  process.exit(1);
}
