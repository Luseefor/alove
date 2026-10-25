# Personal cloud runtime proof

On 2026-10-24, the administrative proof in
`apps/web/scripts/verify-vercel-sandbox.ts` ran inside Vercel deployment
`dpl_EuC2FtJ5Vh9qSX7F9GPbuMhUbQKb`, built from commit `1dd338a`.

The real Sandbox SDK produced a valid PDF and included-file SyncTeX mapping
with each engine. The fixture used a nested main file, a separate included file,
a PNG image and the packages used by manuscript object controls.

| Engine | PDF bytes | Mapping entries |
| --- | ---: | ---: |
| pdfLaTeX | 25,955 | 57 |
| LuaLaTeX | 7,568 | 66 |
| XeLaTeX | 6,995 | 30 |

A TeX error returned `LATEX_ERROR`; cancellation returned `CANCELLED`. A separate
VM confirmed that application credentials were absent and outbound TCP failed
under the deny-all policy. The Vercel sessions API confirmed that all seven
proof/snapshot VMs were stopped. Their combined active CPU usage was 61,263 ms.

The clean tools clone created nonexpiring snapshot
`snap_Rukyo4DH49lQwBoJx4e4QFl2lxUy`, 1,406,127,817 bytes. The snapshot API returned
status `created` and no expiry. It contains tools only; fixtures were written
after capture into separate ephemeral VMs. The deployment proof flag was then
disabled and the new snapshot configured for Weftly.

This proves the adapter against the real SDK and TeX runtime. It does not yet
prove the complete authenticated browser → API → Redis → Sandbox → PDF flow,
GitHub repository sync or signed account deletion. Those remain release checks.

Local validation at this point: 1,150 web tests pass with two workers, four
dedicated real-Redis queue integration tests pass, workspace typecheck and the
Sandbox-mode production build pass. The default-concurrency unit run timed out
two existing editor-retention cases; both passed in the bounded full run. Initial
CI caught omitted worker helper files in the web Docker build; the fix is in
`1dd338a` and its CI must pass before merge.
