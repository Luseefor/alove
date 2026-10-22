import { describe, expect, it } from "vitest";
import { sourceNavigationNeedsSource } from "./sourceNavigation";
const doc = String.raw`\documentclass{article}
\newcommand{\secret}{Hidden}
\begin{document}
Visible prose.
\section{Heading}
\custom{protected}
\end{document}`;
describe("source navigation", () => {
  it("retains Visual for visible prose", () => {
    const at = doc.indexOf("Visible");
    expect(sourceNavigationNeedsSource(doc, at, at + 7)).toBe(false);
  });
  it("reveals hidden setup and custom syntax in Source", () => {
    for (const word of [
      "documentclass",
      "Hidden",
      "section",
      "custom",
      "protected",
      "end{document}",
    ])
      expect(sourceNavigationNeedsSource(doc, doc.indexOf(word))).toBe(true);
  });
  it("reveals ranges spanning protected syntax", () => {
    expect(
      sourceNavigationNeedsSource(
        doc,
        doc.indexOf("Visible"),
        doc.indexOf("Heading"),
      ),
    ).toBe(true);
  });
  it("retains visible fragments and reveals documents beyond projection limits", () => {
    expect(sourceNavigationNeedsSource("Fragment", 0)).toBe(false);
    expect(sourceNavigationNeedsSource("x".repeat(1048577), 0)).toBe(true);
  });
  it("keeps CRLF and UTF16 offsets canonical", () => {
    const source = doc.replace(/\n/g, "\r\n").replace("Visible", "😀 Visible");
    expect(sourceNavigationNeedsSource(source, source.indexOf("Visible"))).toBe(
      false,
    );
    expect(sourceNavigationNeedsSource(source, source.indexOf("custom"))).toBe(
      true,
    );
  });
});
