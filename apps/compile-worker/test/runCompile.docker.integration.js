import { beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { runCompileJob } from "../src/runCompile.ts";

// Explicit opt-in script: these tests use a real, already-installed TeX image.
const image = process.env.COMPILE_DOCKER_IMAGE ?? "ghcr.io/xu-cheng/texlive-full:latest";
process.env.COMPILE_USE_DOCKER = "true";
beforeAll(() => {
  const check = spawnSync("docker", ["image", "inspect", image], { encoding: "utf8", timeout: 10000 });
  if (check.status !== 0) throw new Error("Docker and the configured TeX image must be ready before test:docker. " + check.stderr);
});

function expectPdf(result) {
  expect(result.phase, result.errorMessage + "\n" + result.log).toBe("ready");
  const data = Buffer.from(result.pdfBase64, "base64");
  expect(data.subarray(0, 5).toString()).toBe("%PDF-");
  expect(data.length).toBeGreaterThan(1000);
}

for (const engine of ["pdflatex", "lualatex", "xelatex"]) {
  test("real Docker compile using " + engine, async () => {
    const result = await runCompileJob({ projectId: "docker-smoke-" + engine, mainFile: "main.tex", engine, files: { "main.tex": String.raw`\documentclass{article}
\begin{document}
Real Docker compile with ` + engine + String.raw`.
\end{document}
` } });
    expectPdf(result);
  }, 120000);
}

test("real nested main, include, binary image and bibliography", async () => {
  const result = await runCompileJob({
    projectId: "docker-smoke-nested", mainFile: "chapters/paper.tex", cleanAux: true,
    files: {
      "chapters/paper.tex": String.raw`\documentclass{article}
\usepackage{graphicx}
\begin{document}
\input{sections/chapter}
\includegraphics[width=1cm]{assets/pixel.png}
\cite{proof}
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`,
      "sections/chapter.tex": "Nested chapter reached the real TeX engine.",
      "assets/pixel.png": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "refs.bib": "@article{proof,title={Real bibliography proof},author={Reader, A.},journal={Local verification},year={2026}}",
    },
  });
  expectPdf(result);
  expect(result.mainPdfRelPath).toBe("chapters/paper.pdf");
  expect(result.log).toContain("sections/chapter.tex");
  expect(result.log).toContain("assets/pixel.png");
  expect(result.log).toContain("paper.bbl");
  expect(result.log).not.toContain("undefined citations");
}, 120000);

test("real TeX error is returned as a compilation failure", async () => {
  const result = await runCompileJob({ projectId: "docker-smoke-error", mainFile: "main.tex", files: { "main.tex": String.raw`\documentclass{article}
\begin{document}
\UndefinedSmokeCommand
\end{document}
` } });
  expect(result.phase).toBe("failed");
  expect(result.errorCode).toBe("LATEX_ERROR");
  expect(result.log).toContain("Undefined control sequence");
  expect(result.pdfBase64).toBeUndefined();
}, 120000);

test("real timeout removes the container and temporary workspace", async () => {
  const previous = new Set((await readdir(tmpdir())).filter((path) => path.startsWith("alove-tex-")));
  const started = performance.now();
  const result = await runCompileJob({ projectId: "docker-smoke-timeout", mainFile: "main.tex", timeoutMs: 1000, files: { "main.tex": String.raw`\documentclass{article}
\begin{document}
\loop\iftrue\repeat
\end{document}
` } });
  expect(result.errorCode, result.errorMessage + "\n" + result.log).toBe("TIMEOUT");
  expect(result.timedOut).toBe(true);
  expect(performance.now() - started).toBeLessThan(10000);
  expect((await readdir(tmpdir())).filter((path) => path.startsWith("alove-tex-") && !previous.has(path))).toEqual([]);
  const containers = spawnSync("docker", ["ps", "-aq", "--filter", "name=alove-compile-"], { encoding: "utf8", timeout: 10000 });
  expect(containers.status).toBe(0);
  expect(containers.stdout.trim()).toBe("");
}, 15000);
