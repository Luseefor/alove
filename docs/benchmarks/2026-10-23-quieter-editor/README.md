# Professional editor workspace (#63)

Final production screenshots:

- Dark: [phone](after-dark-390.png), [desktop](after-dark-1440.png).
- Light: [phone](after-light-390.png), [desktop](after-light-1440.png).

## Design

The workspace has distinct chrome, panel headers and editor surfaces. Desktop
panes use a restrained frame; phones keep the full available editing width.
The header places identity and Build together, with utilities on a second phone
row. Desktop uses one header and one command/mode row. File tabs attach to their
editor; navigation, selection, status and focus use consistent visual states.
Accent profiles share neutral surfaces and reserve color for emphasis.

The original [dark phone view](before-dark-390.png) mixed navy chrome, a separate
charcoal editor and many dividers. An initial flat treatment was rejected by the
user because it resembled paper rather than an application. Files prefixed
`rejected-flat-` record that discarded direction. They are not final screenshots.
The final layout restores purposeful panel hierarchy without the original
collection of group separators, glowing rules and outlined utility buttons.

## Validation

The production build, workspace tests/lint/typecheck and 1,076 web unit tests pass.
The complete local production-browser suite passed 95 tests with 12 explicit
skips, including persistence, undo, responsive layouts, keyboard focus, dialogs,
mode switching and object controls. Real compiler journeys remain in Docker CI.

[Contrast calculations](contrast.json) cover normal text and button labels for
all six profiles in both modes. The minimum calculated ratio is 5.02:1.
[Rendered profile checks](rendered-profiles.json) confirm stored preference
restoration, distinct chrome/editor/workspace surfaces and actual Build-button
contrast across all 12 combinations. Keyboard Tab inspection confirms a visible
focus ring. CodeMirror uses the shared surface/syntax variables, including the
legacy LaTeX stream's tag-name and bracket tokens.

The initial focused browser run failed three save-state waits after the display
text changed from `Project Saved` to `Project saved`; the exact-text locators were
updated. One subsequent command used an older preview URL and was stopped; final
checks use port 30138. Assertion deadlines and persistence behavior are unchanged.
Local checks select the installed Chromium revision through a temporary config.
Docker and live deployed providers are unavailable locally; CI retains the real
compile/recovery checks, and live deployment remains deferred in #42.
