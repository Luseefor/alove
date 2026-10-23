# Weftly branding

Weftly is the public application name. The selected identity is option 03: square
source brackets surrounding a lowercase w. The mark connects manuscript writing
to the source editor without suggesting a particular document format.

The web UI uses `BrandMark` with the current theme's foreground/primary tokens.
Downloadable masters and exports live in `apps/web/public/brand/weftly`:

- `logo.svg` and `logo.png`: blue mark with a dark wordmark.
- `logo-white` and `logo-black`: single-color wordmarks in SVG and PNG.
- `mark.svg`, `mark-white.svg`, `mark-black.svg`: standalone marks.
- `app-icon.svg` and `icon-{192,512,1024}.png`: application icons.
- `apple-touch-icon.png`: square 180px canvas for platform masking.
- `favicon.svg`, `favicon.ico`, `favicon-{16,32,48}.png`: browser icons.

Wordmark SVGs contain outlines, so they require no installed font. The supplied
wordmark uses Arial Bold letterforms. Cobalt is #1746EB and ink is #111827.
Leave one bracket stroke of clear space around the mark. The favicon uses wider
strokes and retains both brackets at small sizes. Its SVG adapts to dark browser
themes.

Next's file conventions provide `/icon.svg`, `/favicon.ico` and `/apple-icon.png`.
`/manifest.webmanifest` points to the published application icons.

## Compatibility

The public rename does not rename the GitHub repository, packages, deployment
configuration, environment variables, theme token identifiers, IndexedDB databases,
local storage keys, queue keys or archive payload format identifiers. Keeping these
stable preserves existing projects and installations. New source/recovery downloads
use `.weftly.json`; existing `.alove.json` and JSON archive imports remain accepted.
