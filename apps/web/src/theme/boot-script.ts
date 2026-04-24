import {
  DEFAULT_PALETTE_ID,
  PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./constants";
import { SITE_PALETTES } from "./palette-definitions";

/** Serialized for the inline boot script (must stay JSON-safe). */
function paletteMapJson(): Record<
  string,
  { light: Record<string, string>; dark: Record<string, string> }
> {
  return Object.fromEntries(
    SITE_PALETTES.map((p) => [
      p.id,
      { light: { ...p.light }, dark: { ...p.dark } },
    ]),
  );
}

/**
 * Runs before React: restores `.dark` and accent CSS variables from
 * `localStorage` so the first paint matches saved preferences.
 */
export function buildBootInlineScript(): string {
  const paletteJson = JSON.stringify(paletteMapJson());
  return `(function(){try{var P=${paletteJson};var pk=${JSON.stringify(PALETTE_STORAGE_KEY)};var pid=localStorage.getItem(pk)||${JSON.stringify(DEFAULT_PALETTE_ID)};if(!P[pid])pid=${JSON.stringify(DEFAULT_PALETTE_ID)};var k=${JSON.stringify(THEME_STORAGE_KEY)};var v=localStorage.getItem(k);var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var dark=v==="dark"||(v!=="light"&&(!v||v==="system")&&d);document.documentElement.classList.toggle("dark",dark);var vars=P[pid][dark?"dark":"light"];for(var key in vars)document.documentElement.style.setProperty(key,vars[key]);document.documentElement.setAttribute("data-alove-palette",pid);}catch(e){}})();`;
}
