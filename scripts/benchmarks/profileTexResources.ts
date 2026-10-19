import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

const output = resolve(
  process.argv[2] ?? "benchmark-results/tex-resources.json",
);
const image = process.env.COMPILE_DOCKER_IMAGE ?? "alove-tex:local";
const inspect = spawnSync(
  "docker",
  ["image", "inspect", "--format", "{{.Id}}", image],
  { encoding: "utf8", timeout: 10000 },
);
if (inspect.status !== 0)
  throw new Error("Configured Docker image unavailable");
const imageId = inspect.stdout.trim();
const samples = [];
for (const engine of ["pdflatex", "lualatex", "xelatex"]) {
  for (let repeat = 1; repeat <= 3; repeat++) {
    const directory = await mkdtemp(join(tmpdir(), "alove-resource-bench-"));
    const name = `alove-resource-bench-${Date.now()}-${repeat}`;
    try {
      await writeFile(
        join(directory, "main.tex"),
        String.raw`\documentclass{article}
\begin{document}
\newcount\pagecounter\pagecounter=0
\loop\advance\pagecounter by1
Synthetic resource benchmark page \the\pagecounter.\newpage
\ifnum\pagecounter<500\repeat
\end{document}
`,
      );
      const flag = engine === "pdflatex" ? "-pdf" : `-${engine}`;
      const started = performance.now();
      const result = spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "--name",
          name,
          "--platform",
          "linux/amd64",
          "-v",
          `${directory}:/work`,
          "-w",
          "/work",
          imageId,
          "/usr/bin/time",
          "-v",
          "-o",
          "/work/resources.txt",
          "latexmk",
          "-norc",
          flag,
          "-no-shell-escape",
          "-outdir=./.",
          "-interaction=nonstopmode",
          "-halt-on-error",
          "./main.tex",
        ],
        { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      const wallMs = performance.now() - started;
      const resourceText = await readFile(
        join(directory, "resources.txt"),
        "utf8",
      ).catch(() => "");
      const pdf = await readFile(join(directory, "main.pdf")).catch(() =>
        Buffer.alloc(0),
      );
      samples.push({
        engine,
        repeat,
        status: result.status,
        wallMs,
        resourceText,
        pdfBytes: pdf.length,
        pdfSignature: pdf.subarray(0, 5).toString(),
        error: result.error?.message,
        stderr: result.status ? result.stderr.slice(-2000) : undefined,
      });
      console.log(
        `Resource profile ${engine} ${repeat}: ${Math.round(wallMs)}ms`,
      );
    } finally {
      spawnSync("docker", ["rm", "-f", name], {
        timeout: 10000,
        stdio: "ignore",
      });
      await rm(directory, { recursive: true, force: true });
    }
  }
}
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      schema: 1,
      imageId,
      measuredAt: new Date().toISOString(),
      methodology:
        "Separate direct Docker profiling with BusyBox time -v around latexmk, 500 synthetic pages. Same flags/image as worker; bypasses HTTP/Redis/polling and is NOT an API latency sample. User/system time and max resident size come from the timed process group/descendants per BusyBox time; not total Docker VM or deployment RAM. Emulation can distort CPU accounting.",
      samples,
    },
    null,
    2,
  ) + "\n",
);
if (samples.some((s) => s.status !== 0 || s.pdfSignature !== "%PDF-"))
  process.exitCode = 1;
