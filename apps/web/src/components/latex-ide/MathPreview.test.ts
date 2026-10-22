import { expect, it } from "vitest";
import { renderMathPreview } from "./MathPreview";
it("renders standard math with MathML and discards macro state between expressions", () => {
  const element = document.createElement("div");
  expect(renderMathPreview(element, String.raw`\frac{x^2}{\sqrt{y}}`)).toBe(
    true,
  );
  expect(element.querySelector("math")).not.toBeNull();
  renderMathPreview(element, String.raw`\gdef\persist{x}\persist`);
  expect(renderMathPreview(element, String.raw`\persist`)).toBe(false);
});
it("never enables trusted HTML, remote images, links or recursive macros", () => {
  const e = document.createElement("div");
  for (const tex of [
    String.raw`\includegraphics{https://evil.test/x}`,
    String.raw`\href{javascript:alert(1)}{x}`,
    String.raw`\htmlClass{danger}{x}`,
    String.raw`\def\x{\x}\x`,
    "x".repeat(8193),
    String.raw`\unknown{<img src=x onerror=alert(1)>}`,
  ]) {
    renderMathPreview(e, tex);
    expect(e.querySelector("img,a,script,.danger")).toBeNull();
  }
});
