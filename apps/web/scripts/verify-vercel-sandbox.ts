// Administrative proof, run explicitly in a Vercel build with its OIDC identity.
// Never import this script from a public route or the normal build command.
import assert from "node:assert/strict";
import { Sandbox, Snapshot } from "@vercel/sandbox";
import {
  runVercelCompile,
  vercelCompileSnapshot,
} from "../src/lib/vercelCompile";

let snapshotId = vercelCompileSnapshot();
const source = await Snapshot.get({ snapshotId });
assert.equal(source.status, "created");
if (source.expiresAt) {
  // Clone trusted tools before writing any test files. Snapshotting stops the VM.
  const tools = await Sandbox.create({
    source: { type: "snapshot", snapshotId },
    persistent: true,
    networkPolicy: "deny-all",
    resources: { vcpus: 1 },
    timeout: 180_000,
    snapshotExpiration: 0,
  });
  try {
    const stable = await tools.snapshot({ expiration: 0 });
    assert.equal(stable.expiresAt, undefined);
    snapshotId = stable.snapshotId;
    console.log(`WEFTLY_STABLE_SNAPSHOT_ID=${snapshotId}`);
  } finally {
    await tools.stop();
  }
}
process.env.COMPILE_VERCEL_SNAPSHOT_ID = snapshotId;

const probe = await Sandbox.create({
  source: { type: "snapshot", snapshotId },
  persistent: false,
  networkPolicy: "deny-all",
  resources: { vcpus: 1 },
  timeout: 30_000,
});
try {
  const command = await probe.runCommand("python3", [
    "-c",
    `import os,socket
assert not any(os.environ.get(k) for k in ['CLERK_SECRET_KEY','CONVEX_DEPLOY_KEY','REDIS_URL','VERCEL_OIDC_TOKEN'])
try:
 s=socket.create_connection(('1.1.1.1',443),timeout=3)
except OSError:
 print('isolation: no app credentials; outbound TCP blocked')
else:
 s.close();raise RuntimeError('Outbound network unexpectedly available')
`,
  ]);
  assert.equal(command.exitCode, 0, "VM isolation proof failed");
  console.log((await command.stdout()).trim());
} finally {
  await probe.stop();
}

for (const engine of ["pdflatex", "lualatex", "xelatex"] as const) {
  const result = await runVercelCompile({
    projectId: "deployment-proof",
    mainFile: "manuscript/main.tex",
    engine,
    files: {
      "manuscript/main.tex": String.raw`\documentclass{article}
\usepackage{graphicx,subcaption,multirow,longtable,tabularx,booktabs,amsmath,siunitx,physics,cleveref,csquotes}
\begin{document}
\section{Weftly deployment proof}
\input{chapters/body}
\includegraphics[width=1cm]{pixel.png}
\end{document}`,
      "chapters/body.tex": "Included source text with a separate file.\n",
      "pixel.png":
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    },
  });
  assert.equal(result.phase, "ready", `${engine}: ${result.errorMessage}`);
  assert.equal(
    Buffer.from(result.pdfBase64!, "base64").subarray(0, 5).toString(),
    "%PDF-",
  );
  assert.ok(
    result.synctex?.entries.some((entry) => entry.file === "chapters/body.tex"),
    `${engine}: included source mapping missing`,
  );
  console.log(
    JSON.stringify({
      engine,
      phase: result.phase,
      pdfBytes: Buffer.from(result.pdfBase64!, "base64").length,
      mappedEntries: result.synctex?.entries.length,
    }),
  );
}

const invalid = await runVercelCompile({
  projectId: "deployment-proof",
  mainFile: "main.tex",
  files: {
    "main.tex": String.raw`\documentclass{article}\begin{document}\weftlyUndefinedCommand\end{document}`,
  },
});
assert.equal(invalid.errorCode, "LATEX_ERROR");
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 1000);
try {
  const cancelled = await runVercelCompile(
    {
      projectId: "deployment-proof",
      mainFile: "main.tex",
      files: {
        "main.tex": String.raw`\documentclass{article}\begin{document}\loop\iftrue\repeat\end{document}`,
      },
    },
    controller.signal,
  );
  assert.equal(cancelled.errorCode, "CANCELLED");
} finally {
  clearTimeout(timer);
}
console.log(
  "Sandbox SDK proof passed: three engines, includes, asset, SyncTeX, TeX failure and cancellation.",
);
