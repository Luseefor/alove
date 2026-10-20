# TeX job sandbox

Each Docker job runs as UID/GID 65532 with no network, Linux capabilities or privilege escalation. Its root filesystem and source mount are read-only. The worker does not pass its application environment or Docker socket into the TeX container. The host source directory stays inside a private 0700 parent; only its readable child is mounted.

The container copies those inputs into `/work`, an isolated tmpfs. `/work` and `/tmp` have byte and inode limits plus `nosuid,nodev,noexec`. A 16 MiB shared-memory mount, 256 file descriptors and a 64 MiB per-file write limit also apply. Memory swap is capped at the memory limit, so no additional swap allowance is requested. Fonts and packages must be installed in the image; runtime package downloads are unavailable.

| Server variable | Default | Accepted range |
| --- | --- | --- |
| `COMPILE_SANDBOX_MEMORY_MB` | 1024 | 256–4096, integer MiB |
| `COMPILE_SANDBOX_CPUS` | 1 | 0.25–4 |
| `COMPILE_SANDBOX_PIDS` | 64 | 16–256, integer |
| `COMPILE_SANDBOX_WORK_MB` | 128 | 16–512, integer MiB |
| `COMPILE_SANDBOX_TMP_MB` | 128 | 16–256, integer MiB |

Writable mounts plus shared memory must leave at least 128 MiB of the memory budget for processes. Malformed settings fail the job as a configuration error rather than removing a bound. Existing request/file/artifact/deadline caps continue to apply. Mount sizes also count against the memory limit; this is not a memory allocation guarantee.

The image is resolved to an immutable ID before execution. A versioned `policyId` hashes the effective resource settings and identifies the fixed restrictions above. Build records store both identities. Recovery compares them for the last good build, failing build and every trial; a legacy or changed policy cannot silently receive a verified patch from a new runtime. Changes to fixed restrictions must bump the policy version.

A finite-lived `sleep` keeps the container available after `latexmk` exits because Docker removes tmpfs data on container stop. The worker reads only regular log/PDF files through a fixed Perl program, with path checks, no-follow/nonblocking opens, bounded binary output and a 10-second retrieval timeout. It does not extract a tar archive or expose a writable host output directory. Oversized PDFs fail; log tails may be truncated. A missing PDF remains a normal compilation failure.

The job deadline covers startup, source copy and compiler commands. A timeout force-removes the container before returning. `finally` removes it after artifact retrieval and deletes the host inputs. `--rm` and a PID1 lifetime of the compile deadline plus 60 seconds bound an orphan's lifetime if the worker dies; this is not durable cancellation or queue-restart recovery. Host compilation remains an explicitly trusted local option outside production.

Validation commands, from the repository root:

```sh
bun run --filter compile-worker test
COMPILE_DOCKER_IMAGE=alove-tex:local bun run --filter compile-worker test:docker
bun run --filter web test
bun run typecheck
```

The Docker suite checks all three engines, nested roots/includes/PNG/BibTeX, TeX errors, timeout cleanup and a later successful build. It inspects real container settings, tests blocked outgoing connections and filesystem writes, exhausts small tmpfs mounts and a bounded process budget, rejects artifact links/FIFOs, and checks operation under host umask 077. Run it without concurrent compile jobs because the cleanup test inspects job containers and temporary directories.

This improves the local runner boundary. Shared public hosting still requires a dedicated isolated runner/daemon, project/job authorization, quotas and operational cancellation/restart checks. The Compose worker's host bind arrangement and live cloud deployment remain unverified. Docker alone is not a complete hostile-code isolation guarantee.

References: [Docker run options](https://docs.docker.com/reference/cli/docker/container/run/) and [tmpfs behavior and memory accounting](https://docs.docker.com/engine/storage/tmpfs/).
