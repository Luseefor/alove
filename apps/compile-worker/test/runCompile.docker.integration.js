import { beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dockerSandboxArgs, resolveDockerSandboxPolicy } from "../src/dockerSandbox.ts";
import { readDockerArtifact, ArtifactTooLargeError } from "../src/dockerArtifact.ts";
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
  expect(result.errorCode,result.errorMessage+"\n"+result.log).toBe("LATEX_ERROR");
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


test("real sandbox enforces user, network, resources, filesystem and artifact boundaries",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"alove-sandbox-proof-"));
  const source=join(dir,"source");await mkdir(source,{mode:0o755});
  await writeFile(join(source,"input.tex"),"source must remain unchanged");
  const name=`alove-compile-policy-${Date.now()}`;
  const docker=(args)=>spawnSync("docker",args,{encoding:"utf8",timeout:10000});
  const exec=(...command)=>docker(["exec",name,...command]);
  const oldSecret=process.env.ALOVE_SANDBOX_PROBE_SECRET;
  process.env.ALOVE_SANDBOX_PROBE_SECRET="worker-only-probe";
  try {
    const inspected=docker(["image","inspect","--format","{{.Id}}",image]);
    expect(inspected.status,inspected.stderr).toBe(0);
    const policy=resolveDockerSandboxPolicy({COMPILE_SANDBOX_MEMORY_MB:"256",COMPILE_SANDBOX_WORK_MB:"16",COMPILE_SANDBOX_TMP_MB:"16",COMPILE_SANDBOX_PIDS:"16"});
    const started=docker(dockerSandboxArgs({name,sourcePath:await realpath(source),imageId:inspected.stdout.trim(),policy,ttlSeconds:45}));
    expect(started.status,started.stderr).toBe(0);
    const stateResult=docker(["inspect",name]);expect(stateResult.status,stateResult.stderr).toBe(0);
    const state=JSON.parse(stateResult.stdout)[0];
    expect(state.Config.User).toBe("65532:65532");
    expect(state.HostConfig.NetworkMode).toBe("none");
    expect(state.HostConfig.ReadonlyRootfs).toBe(true);
    expect(state.HostConfig.Memory).toBe(256*1024*1024);
    expect(state.HostConfig.MemorySwap).toBe(state.HostConfig.Memory);
    expect(state.HostConfig.NanoCpus).toBe(1_000_000_000);
    expect(state.HostConfig.PidsLimit).toBe(16);
    expect(state.HostConfig.CapDrop).toContain("ALL");
    expect(state.HostConfig.SecurityOpt).toContain("no-new-privileges=true");
    expect(state.Mounts.filter(m=>m.Type==="bind").map(m=>({destination:m.Destination,rw:m.RW}))).toEqual([{destination:"/source",rw:false}]);
    expect(exec("id","-u").stdout.trim()).toBe("65532");
    const status=exec("cat","/proc/self/status").stdout;
    expect(status).toMatch(/CapEff:\s+0+\n/);expect(status).toMatch(/NoNewPrivs:\s+1/);
    const network=exec("perl","-MSocket","-e",'socket(my $s,PF_INET,SOCK_STREAM,0) or die $!; connect($s,sockaddr_in(9,inet_aton("192.0.2.1"))) and die "network escaped"; die "unexpected: $!" unless $!{ENETUNREACH} || $!{EHOSTUNREACH}; print "unreachable";');
    expect(network.status,network.stderr).toBe(0);expect(network.stdout).toBe("unreachable");
    expect(exec("perl","-e",'print $ENV{ALOVE_SANDBOX_PROBE_SECRET} // "absent";').stdout).toBe("absent");
    expect(exec("test","-S","/var/run/docker.sock").status).not.toBe(0);
    expect(exec("touch","/source/new-file").status).not.toBe(0);
    expect(exec("touch","/etc/alove-write-proof").status).not.toBe(0);
    expect(exec("cat","/source/input.tex").stdout).toBe("source must remain unchanged");
    expect(exec("dd","if=/dev/zero","of=/work/full","bs=1048576","count=17").status).not.toBe(0);
    expect(exec("rm","/work/full").status).toBe(0);
    expect(exec("dd","if=/dev/zero","of=/tmp/full","bs=1048576","count=17").status).not.toBe(0);
    expect(exec("rm","/tmp/full").status).toBe(0);
    expect(exec("perl","-e",'open(my $f,">","/work/program") or die $!; print $f "#!/bin/sh\\nexit 0\\n"; close $f; chmod 0755,"/work/program";').status).toBe(0);
    expect(exec("/work/program").status).not.toBe(0);
    // At most 32 short-lived children; the cgroup must refuse before that bound.
    const pids=exec("perl","-e",'my @p; for (1..32) { my $p=fork(); last unless defined $p; if(!$p){sleep 1;exit 0} push @p,$p; } print scalar(@p); waitpid($_,0) for @p;');
    expect(pids.status,pids.stderr).toBe(0);expect(Number(pids.stdout)).toBeGreaterThan(0);expect(Number(pids.stdout)).toBeLessThan(32);
    expect(exec("perl","-e",'open(my $f,">","/work/sample.pdf") or die $!; print $f "%PDF-proof";').status).toBe(0);
    expect((await readDockerArtifact(name,"/work/sample.pdf",128)).data.toString()).toBe("%PDF-proof");
    expect(await readDockerArtifact(name,"/work/missing.pdf",128)).toBeNull();
    expect(exec("ln","-s","/etc/passwd","/work/escape.pdf").status).toBe(0);
    await expect(readDockerArtifact(name,"/work/escape.pdf",128)).rejects.toThrow(/regular artifact/);
    expect(exec("mkfifo","/work/pipe.log").status).toBe(0);
    await expect(readDockerArtifact(name,"/work/pipe.log",128)).rejects.toThrow(/regular artifact/);
    expect(exec("perl","-e",'open(my $f,">","/work/large.log") or die $!; print $f "x" x 2048;').status).toBe(0);
    expect(await readDockerArtifact(name,"/work/large.log",128,true)).toEqual({data:Buffer.alloc(128,120),truncated:true});
    await expect(readDockerArtifact(name,"/work/large.log",128)).rejects.toBeInstanceOf(ArtifactTooLargeError);
  } finally {
    docker(["rm","-f",name]);await rm(dir,{recursive:true,force:true});
    if(oldSecret===undefined)delete process.env.ALOVE_SANDBOX_PROBE_SECRET;else process.env.ALOVE_SANDBOX_PROBE_SECRET=oldSecret;
  }
},45000);

test("a valid build succeeds after timeout and resource-boundary checks",async()=>{
  expectPdf(await runCompileJob({projectId:"post-limit-recovery",mainFile:"main.tex",files:{"main.tex":"\\documentclass{article}\n\\begin{document}After cleanup.\\end{document}"}}));
},120000);


test("restrictive host umask keeps nested inputs readable only through the source mount",async()=>{
  const previous=process.umask(0o077);
  try {
    expectPdf(await runCompileJob({projectId:"umask-proof",mainFile:"chapters/main.tex",files:{"chapters/main.tex":"\\documentclass{article}\n\\begin{document}\\input{sections/text}\\end{document}","sections/text.tex":"Readable with an isolated numeric uid."}}));
  } finally {process.umask(previous);}
},120000);
