// Vitest jsdom environment bindings.
// Node 26 exposes `localStorage` as an unavailable experimental binding, so the
// jsdom window's Storage never reaches the bare global that zustand's persist
// middleware captures (`() => window.localStorage` with window === globalThis).
// Bind the genuine jsdom Storage implementation so production persistence keeps
// using real browser Storage instead of a mock.
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { JSDOM } from "jsdom";

function isUsableStorage(value: unknown): value is Storage {
  return (
    value instanceof Object &&
    typeof (value as Storage).getItem === "function" &&
    typeof (value as Storage).setItem === "function" &&
    typeof (value as Storage).removeItem === "function"
  );
}

function bindRealDomStorage(key: "localStorage" | "sessionStorage"): void {
  const target = globalThis as unknown as Record<string, unknown>;
  if (isUsableStorage(target[key])) {
    return;
  }
  const view = target.window as Window | undefined;
  const existing = view?.[key] as unknown;
  if (isUsableStorage(existing)) {
    target[key] = existing;
    return;
  }
  const url =
    typeof view?.location?.href === "string" && view.location.href !== "about:blank"
      ? view.location.href
      : "http://localhost:3000/";
  const dom = new JSDOM("", { url });
  const storage = dom.window[key] as unknown;
  if (isUsableStorage(storage)) {
    target[key] = storage;
  }
}

bindRealDomStorage("localStorage");
bindRealDomStorage("sessionStorage");
