# vendor/

Locally vendored, prebuilt dependency tarballs consumed via `overrides` in the
root `package.json`.

## kdtree-ts-1.0.0.tgz

`pdf2array` (used by the data-pipeline scripts) depends on `kdtree-ts` as a
**git** dependency (`github:tonyroberts/kdtree-ts`). That package's
`package.json` runs `postinstall: tsc` and pins `typescript@^4.2.4`.

When npm installs a git dependency it prepares it in an *isolated* nested
`npm install` rooted at the dependency's own `package.json` — our root
`overrides` are **not** forwarded into it. That isolated install resolves the
latest `@types/node@22.x`, which now ships `ffi.d.ts` using TypeScript-5-only
syntax. TypeScript 4.x cannot parse it, so `tsc` fails and `npm ci` aborts
(this broke CI on 2026-07-01).

The compiled `.js` is already committed in the upstream repo, so the
`postinstall` recompile is redundant. This tarball is a repack of that source
with the `postinstall` script and `devDependencies` removed, so npm installs
the prebuilt files as-is and never recompiles them against a newer
`@types/node`.

Consumed via `overrides.kdtree-ts` → `file:vendor/kdtree-ts-1.0.0.tgz` in the
root `package.json`.

To refresh: repack from an upstream checkout, delete the `scripts.postinstall`
entry and `devDependencies` from its `package.json`, `npm pack` into this
folder, then `npm install` to update the lockfile integrity.
