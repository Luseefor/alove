# Closed test run — 2026-10-20

The run covers the local application from a fresh browser context through project deletion, using the production web build, dedicated Redis, actual worker and Docker TeX. It uses no compile API mocks for the author journey. The production provider keys were not supplied.

## Findings and fixes

| Issue | Reproduction | Result |
| --- | --- | --- |
| [#16](https://github.com/Luseefor/alove/issues/16) | Worker heartbeat stays fresh when its configured Docker image cannot be inspected | Bounded runtime probes gate heartbeat publication; expiry, recovery and shutdown are tested |
| [#17](https://github.com/Luseefor/alove/issues/17) | A damaged PNG makes the PDF driver fail after TeX writes its log | Failed builds retain capped driver output, useful diagnostics and no PDF; duplicated messages are removed |
| [#18](https://github.com/Luseefor/alove/issues/18) | Tall status/statistics cards are cropped by the build panel; project-wide citations get false unused/missing notices | Compact status header, scrollable full-width output, no unknown page stats, project-wide citation checks |

## Final checks

- Complete production Chromium suite: **55 passed, 2 cloud-only skipped**, 1.8 minutes, one worker, no retries.
- Four targeted actual-worker checks: **4 passed**, 1.1 minutes. This includes the complete author journey and malformed-image failure.
- Web unit suite: **480 passed**, including six new citation regressions.
- Complete worker unit suite: **71 passed**. All-package typecheck and lint passed; the standalone production build passed.
- Focused worker process/safety regressions: **19 passed**, including bounded driver output and duplicate diagnostics.
- Runtime probe units: **17 passed**. Actual worker/Redis readiness cycle: **39 assertions passed**, 40.80 seconds, including the local readiness API and shutdown during a probe.
- Build panel captured and checked at **390, 768 and 1440 CSS pixels**, light and dark. Source, log/problemlist scrolling, status placement and page overflow were checked. Ace also displayed the replacement panel after a real compile.

The continuous journey creates a project from Home, renames its root, adds a preamble and bibliography, uploads a binary image, downloads a genuine PDF, preserves the successful preview after an intentional failure, finds and applies a tested file recovery, retains unrelated prose, saves while offline, reloads after reconnecting, exports/imports the source unchanged, compiles the independent copy, deletes both projects and verifies an empty library. It asserts no page errors.

## Earlier attempts and limits

An unavailable local image first caused runtime-dependent failures despite the old readiness endpoint saying Ready. Rebuilding/loading the pinned image repaired the local environment; the runtime probe fixes the misleading readiness signal. No daemon reset or reinstall was used.

A success fixture initially contained a PNG with an invalid IDAT CRC. It rendered in Chromium but failed in XeTeX. The successful journey now uses a CRC-valid fixture; the malformed image remains an intentional negative case.

A run while the Mac load average exceeded 60 had 52 passes, three failures and two skips. Two bounded recovery trials timed out and correctly remained unresolved; one duplicate-diagnostic regression was fixed. Those failures are retained in the logs. The interruption then stopped the test services. The targeted and complete reruns above used the same assertions and deadlines after restarting services from the normal Terminal. These timings are test durations, not a processing-speed benchmark.

Live Clerk/Convex login, real account switching/deletion, DNS and production HTTPS still require the configuration and two-account checklist in [release-runbook.md](release-runbook.md). Unit identities and signed test events do not establish live provider behavior. No Overleaf comparison is claimed.
