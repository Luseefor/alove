# Weftly front page

Initial proposal. The owner rejected its colors and proportions; the
[2026-10-26 color revision](../2026-10-26-color-balance/README.md) contains the
updated result. These original captures are retained as before evidence.

Issue #76 replaces the dashboard-style public home page.

The front page now uses one navigation bar, a clear editor entry point, a sample
entry point and real product captures. The sidebar, fabricated illustration,
workspace-health cards, duplicate launch cards and tip banner are removed.
Saved-project search and deleted-workspace recovery stay in the project
library, linked from both modes.

## Browser evidence

- [Desktop, light](home-light-1440.png) and [desktop, dark](home-dark-1440.png).
- [Phone, light](home-light-390.png) and [phone, dark](home-dark-390.png).

These are captures of the public front page in the production cloud-mode
build. The page renders without a Clerk provider. Sign-in is an ordinary link
to the protected authentication route.

Five standalone production-browser journeys pass: new project creation, the existing
sample, project-library navigation and import access, keyboard skip navigation,
and responsive image/theme checks. The latter covers 360, 390, 768 and 1440 CSS
pixels in both appearances, checks loaded image data and horizontal overflow,
and verifies appearance persistence after reload. Focused lint, separate web and
Convex typechecks, and production builds in both local and cloud modes pass.
A regression test renders the public cloud header without a Clerk provider.
CI initially caught an incorrect useUser dependency on this public route; the
header now avoids auth hooks entirely. Two public cloud-mode browser checks
repeat keyboard, responsive and theme verification with Sign in visible.

## Product image provenance

The two WebP images in `apps/web/public/landing/` are captures of Weftly's actual
editor. [sample.tex](sample.tex) is an original illustrative article. It was
compiled with pdfLaTeX and SyncTeX in the existing Vercel TeX snapshot on
2026-10-25. The generated PDF is one page, 82,467 bytes. Its parsed mapping has
582 entries.

During capture, deterministic local API responses supplied the generated PDF
and mapping to the editor. This capture verifies the displayed product image;
it is not an authenticated browser-to-cloud compilation test. The normal
Visual/Proof controls closed the build-output pane before capture. Only the
Next.js development indicator was suppressed. The images have no added labels,
painted controls or fabricated document contents. Both captures are 1440 x 900;
WebP assets are 95,918 and 90,286 bytes.

The temporary capture VMs were stopped. The public tools snapshot was not
modified. Live account, repository and signed-deletion checks remain tracked
separately in issue #42.
