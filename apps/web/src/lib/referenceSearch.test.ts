import { describe, it, expect } from "vitest";
import { matchesReference } from "./referenceSearch";
const entry = {
  id: "Bell1964",
  type: "article",
  title: "On the Einstein Podolsky Rosen paradox",
  author: "John Bell",
  year: "1964",
};
describe("reference search modes", () => {
  it("finds titles/authors/years with text tokens", () => {
    expect(matchesReference(entry, "einstein 1964", "default")).toBe(true);
    expect(matchesReference(entry, "Bell missing", "default")).toBe(false);
  });
  it("matches fuzzy subsequences but rejects missing characters", () => {
    expect(matchesReference(entry, "Einstn", "fuzzy")).toBe(true);
    expect(matchesReference(entry, "Einstn", "default")).toBe(false);
    expect(matchesReference(entry, "zzzz", "fuzzy")).toBe(false);
  });
  it("requires the exact case-sensitive citation key in key mode", () => {
    expect(matchesReference(entry, "Bell1964", "bibtex")).toBe(true);
    expect(matchesReference(entry, "bell1964", "bibtex")).toBe(false);
    expect(matchesReference(entry, "Bell", "bibtex")).toBe(false);
    expect(matchesReference(entry, " ", "bibtex")).toBe(true);
  });
});
