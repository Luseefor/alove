# Color balance and front-page proportions

Issues #76 and #78. This revision replaces the [initial proposal](../2026-10-25-front-page/README.md),
whose colors and proportions the owner rejected.

## Rendered result

- [Light desktop](home-light-1440.png), [dark desktop](home-dark-1440.png).
- [Light phone](home-light-390.png), [dark phone](home-dark-390.png).

The desktop hero now pairs the text and actual editor in the first screen.
The faded second headline and decorative side note are removed. A neutral
canvas, a quieter content surface and the document preview create separate
visual areas. Only the main actions use filled accent buttons; the navigation
action is outlined. The phone layout keeps the complete product image.

Shared editor and page colors use the same neutral foreground/surface roles.
All six stored profile IDs remain supported. Accent, hover and active colors
are distinct from status colors. Source syntax colors and secondary text have
stronger contrast. Theme preferences and project data are preserved.

## Verification

- 18 standalone production-browser checks pass: five front-page journeys, two
  profile tests covering all twelve light/dark combinations in both the
  landing action and editor Build control, and eleven responsive/editor-history
  checks.
- Two public cloud-mode checks pass with Sign in visible, including keyboard
  navigation, loaded images, appearance persistence and 360/390/768/1440px
  layouts. The desktop product image is checked within the first screen.
- Web and Convex typechecks, focused lint, design-token checks, theme unit tests
  and production builds in both standalone and cloud modes pass.
- [Contrast results](contrast.json) record the profile text/control token pairs
  against the tested surfaces. Their minimum is 4.83:1, above the 4.5:1
  requirement. Browser checks also measure rendered primary controls. This is
  not a complete accessibility audit.

## Product captures

The updated `workspace-light.webp` and `workspace-dark.webp` assets show the
actual editor with the new shared colors. They reuse the original article,
real pdfLaTeX PDF and SyncTeX mapping described in the
[initial capture provenance](../2026-10-25-front-page/README.md#product-image-provenance).
The local transport supplies those existing artifacts during capture; this
does not claim a new authenticated cloud compile. No additional Sandbox was
created for this color revision. Assets are 95,966 and 92,908 bytes.
