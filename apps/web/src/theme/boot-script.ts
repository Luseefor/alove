import {
  DEFAULT_PALETTE_ID,
  PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  FONT_SIZE_STORAGE_KEY,
  PREVIEW_BG_STORAGE_KEY,
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
  return `(function(){try{var P=${paletteJson};var pk=${JSON.stringify(PALETTE_STORAGE_KEY)};var pid=localStorage.getItem(pk)||${JSON.stringify(DEFAULT_PALETTE_ID)};if(!P[pid])pid=${JSON.stringify(DEFAULT_PALETTE_ID)};var k=${JSON.stringify(THEME_STORAGE_KEY)};var v=localStorage.getItem(k);var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var dark=v==="dark"||(v!=="light"&&(!v||v==="system")&&d);document.documentElement.classList.toggle("dark",dark);document.documentElement.dataset.theme=dark?"dark":"light";var vars=P[pid][dark?"dark":"light"];for(var key in vars)document.documentElement.style.setProperty(key,vars[key]);document.documentElement.style.setProperty("--primary",vars["--alove-accent"]);document.documentElement.style.setProperty("--primary-foreground",vars["--alove-on-accent"]);document.documentElement.style.setProperty("--ring",vars["--alove-focus-ring"]);document.documentElement.setAttribute("data-alove-palette",pid);var dk=${JSON.stringify(DENSITY_STORAGE_KEY)};document.documentElement.dataset.density=localStorage.getItem(dk)||"comfortable";var fk=${JSON.stringify(FONT_SIZE_STORAGE_KEY)};document.documentElement.dataset.fontSize=localStorage.getItem(fk)||"medium";var bk=${JSON.stringify(PREVIEW_BG_STORAGE_KEY)};document.documentElement.dataset.previewBg=localStorage.getItem(bk)||"charcoal";}catch(e){}})();`;
}
